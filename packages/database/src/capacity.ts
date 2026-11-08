import type { Prisma, PrismaClient } from './generated/client';
import { releasePromoForBooking } from './promo';

type Tx = Prisma.TransactionClient;

/**
 * Atomically reserves `qty` seats. A single conditional UPDATE takes the row lock and checks
 * capacity in the same statement, so concurrent reservations cannot overbook; the table CHECK
 * constraint is a second line of defence. Returns false when the seats are not available.
 */
export async function reserveSeats(tx: Tx, slotId: string, qty: number): Promise<boolean> {
  const n = await tx.$executeRaw`
    UPDATE "slot"
       SET "reserved" = "reserved" + ${qty}, "updatedAt" = now()
     WHERE "id" = ${slotId}::uuid
       AND "status" = 'OPEN'
       AND "startsAt" > now()
       AND "reserved" + ${qty} <= "capacity"`;
  return n === 1;
}

/** Releases seats. Callers must only call this after winning a booking status transition. */
export async function releaseSeats(tx: Tx, slotId: string, qty: number): Promise<void> {
  const n = await tx.$executeRaw`
    UPDATE "slot" SET "reserved" = "reserved" - ${qty}, "updatedAt" = now() WHERE "id" = ${slotId}::uuid`;
  if (n !== 1) throw new Error(`slot ${slotId} not found while releasing seats`);
}

/**
 * Releases holds whose time has run out. Idempotent and safe to run concurrently from several
 * workers: the HELD -> EXPIRED booking transition is the single gate, so seats are released once.
 * Returns the number of holds expired by this call.
 */
export async function expireDueHolds(
  db: PrismaClient,
  opts: { slotId?: string; limit?: number; now?: Date } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  const due = await db.hold.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: now }, ...(opts.slotId ? { slotId: opts.slotId } : {}) },
    orderBy: { expiresAt: 'asc' },
    take: opts.limit ?? 200,
  });

  let expired = 0;
  for (const hold of due) {
    const won = await db.$transaction(async (tx) => {
      const b = await tx.booking.updateMany({
        where: { id: hold.bookingId, status: 'HELD' },
        data: { status: 'EXPIRED', version: { increment: 1 } },
      });
      if (b.count !== 1) return false; // confirmed, cancelled or expired by someone else first
      await tx.hold.updateMany({
        where: { id: hold.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED', resolvedAt: now },
      });
      await releaseSeats(tx, hold.slotId, hold.quantity);
      await releasePromoForBooking(tx, hold.bookingId);
      return true;
    });
    if (won) expired++;
  }
  return expired;
}

/** Unanswered booking requests lapse. They never held seats, so there is nothing to release. */
export async function expireDueRequests(db: PrismaClient, now = new Date()): Promise<number> {
  const due = await db.booking.findMany({ where: { status: 'REQUESTED', requestExpiresAt: { lte: now } }, select: { id: true }, take: 500 });
  let n = 0;
  for (const b of due) {
    await db.$transaction(async (tx) => {
      const r = await tx.booking.updateMany({ where: { id: b.id, status: 'REQUESTED' }, data: { status: 'EXPIRED', version: { increment: 1 } } });
      if (r.count === 1) {
        await releasePromoForBooking(tx, b.id);
        n++;
      }
    });
  }
  return n;
}
