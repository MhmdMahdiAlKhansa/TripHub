import { expireDueHolds, expireDueRequests, releaseSeats, reserveSeats } from './capacity';
import type { PrismaClient } from './generated/client';
import { notify } from './notify';

/** How long a waitlisted customer has to act on an offer (product assumption, see docs/DECISIONS). */
export const OFFER_MINUTES = 60;

/**
 * Strict first-come-first-served promotion for one slot, in a single transaction that holds the
 * slot row lock:
 *  1. lapsed offers expire and give their seats back;
 *  2. the oldest WAITING entry is offered its seats if (and only if) they fit right now.
 * If the head does not fit, nobody behind it is offered anything (no queue jumping).
 * An offered entry's seats are already counted in slot.reserved, so nobody else can take them.
 * Idempotent and safe to run concurrently. Returns how many offers were made.
 */
export async function promoteWaitlist(db: PrismaClient, slotId: string, now = new Date()): Promise<number> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ startsAt: Date }>>`
      SELECT "startsAt" FROM "slot" WHERE "id" = ${slotId}::uuid FOR UPDATE`;
    if (rows.length !== 1) return 0;
    const startsAt = rows[0]!.startsAt;

    const lapsed = await tx.waitlistEntry.findMany({ where: { slotId, status: 'OFFERED', offerExpiresAt: { lte: now } } });
    for (const e of lapsed) {
      const gate = await tx.waitlistEntry.updateMany({ where: { id: e.id, status: 'OFFERED' }, data: { status: 'EXPIRED', resolvedAt: now } });
      if (gate.count === 1) await releaseSeats(tx, slotId, e.seats);
    }

    let offers = 0;
    for (;;) {
      const head = await tx.waitlistEntry.findFirst({ where: { slotId, status: 'WAITING' }, orderBy: { seq: 'asc' } });
      if (!head) break;
      if (!(await reserveSeats(tx, slotId, head.seats))) break; // strict FIFO: do not skip the head
      const expires = new Date(Math.min(now.getTime() + OFFER_MINUTES * 60_000, startsAt.getTime()));
      await tx.waitlistEntry.update({ where: { id: head.id }, data: { status: 'OFFERED', offeredAt: now, offerExpiresAt: expires } });
      await notify(tx, head.customerId, 'waitlist.offer', { entryId: head.id, slotId, seats: head.seats, expiresAt: expires.toISOString() });
      offers++;
    }
    return offers;
  });
}

/** Promotes every slot that has a lapsed offer (used by the worker). */
export async function sweepWaitlists(db: PrismaClient, now = new Date()): Promise<number> {
  const due = await db.waitlistEntry.findMany({
    where: { status: 'OFFERED', offerExpiresAt: { lte: now } },
    distinct: ['slotId'],
    select: { slotId: true },
    take: 200,
  });
  let n = 0;
  for (const d of due) n += await promoteWaitlist(db, d.slotId, now);
  return n;
}

/** Cancels a customer's own active entry; gives back offered seats and lets the next in line proceed. */
export async function leaveWaitlist(db: PrismaClient, entryId: string, customerId: string): Promise<boolean> {
  const first = await db.waitlistEntry.findFirst({ where: { id: entryId, customerId, status: { in: ['WAITING', 'OFFERED'] } } });
  if (!first) return false;
  const left = await db.$transaction(async (tx) => {
    // Same lock order as promoteWaitlist (slot first) so the two can never deadlock.
    await tx.$queryRaw`SELECT 1 FROM "slot" WHERE "id" = ${first.slotId}::uuid FOR UPDATE`;
    const e = await tx.waitlistEntry.findFirst({ where: { id: entryId, customerId, status: { in: ['WAITING', 'OFFERED'] } } });
    if (!e) return false;
    const gate = await tx.waitlistEntry.updateMany({ where: { id: e.id, status: e.status }, data: { status: 'CANCELLED', resolvedAt: new Date() } });
    if (gate.count !== 1) return false;
    if (e.status === 'OFFERED') await releaseSeats(tx, e.slotId, e.seats);
    return true;
  });
  if (left) await promoteWaitlist(db, first.slotId);
  return left;
}

/**
 * Expires lapsed holds, then lets queued customers take any seats that freed up.
 * With `slotId` only that slot is handled (used lazily on the booking path); without it, every slot
 * that has anyone waiting or a lapsed offer is processed (used by the worker).
 */
export async function expireHoldsAndPromote(
  db: PrismaClient,
  opts: { slotId?: string; limit?: number; now?: Date } = {},
): Promise<{ expired: number; offers: number }> {
  const expired = (await expireDueHolds(db, opts)) + (await expireDueRequests(db, opts.now));
  const now = opts.now ?? new Date();
  let offers = 0;
  if (opts.slotId) {
    offers = await promoteWaitlist(db, opts.slotId, now);
  } else {
    const slots = await db.waitlistEntry.findMany({
      where: { OR: [{ status: 'WAITING' }, { status: 'OFFERED', offerExpiresAt: { lte: now } }] },
      distinct: ['slotId'],
      select: { slotId: true },
      take: 200,
    });
    for (const s of slots) offers += await promoteWaitlist(db, s.slotId, now);
  }
  return { expired, offers };
}
