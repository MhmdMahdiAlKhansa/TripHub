import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { notify, Prisma, type PrismaClient } from '@triphub/database';
import { requiredDepositMinor, type DepositMethod } from '@triphub/shared';
import { PRISMA } from '../database/database.module';

export interface RecordDepositInput {
  method: DepositMethod;
  amountMinor: bigint;
  currency: string;
  reference?: string;
  note?: string;
}

/**
 * Deposits a participant pays the OPERATOR directly (Whish, OMT or cash). The business records them; the platform
 * never touches the money, so nothing is posted to the ledger. Recording enough deposit turns a held seat into a
 * confirmed one; a seat whose deposit never arrives is released by the normal hold expiry (and offered to the waitlist).
 */
@Injectable()
export class DepositsService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  static summary(b: { totalMinor: bigint; deposits: Array<{ amountMinor: bigint }> }, depositPercent: number) {
    const received = b.deposits.reduce((s, d) => s + d.amountMinor, 0n);
    const required = requiredDepositMinor(b.totalMinor, depositPercent);
    return {
      requiredMinor: required.toString(),
      receivedMinor: received.toString(),
      remainingMinor: (b.totalMinor > received ? b.totalMinor - received : 0n).toString(),
      depositPercent,
      depositMet: received >= required,
    };
  }

  async record(companyId: string, actorId: string, bookingId: string, input: RecordDepositInput) {
    return this.db.$transaction(async (tx) => {
      // Lock the booking so two staff recording at once cannot both "confirm" or double count.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "booking" WHERE "id" = ${bookingId}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`;
      if (locked.length !== 1) throw new NotFoundException();
      const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { hold: true, deposits: true, listing: { select: { depositPercent: true } } } });
      if (!['HELD', 'CONFIRMED', 'COMPLETED'].includes(b.status)) throw new ConflictException({ code: 'booking_not_open', status: b.status });
      if (b.currency !== input.currency) throw new ConflictException({ code: 'currency_mismatch', expected: b.currency });
      if (b.totalMinor === 0n) throw new ConflictException({ code: 'nothing_to_pay' });
      const deposit = await tx.deposit.create({
        data: { bookingId, companyId, method: input.method, amountMinor: input.amountMinor, currency: input.currency, reference: input.reference ?? null, note: input.note ?? null, recordedBy: actorId },
      });
      const s = DepositsService.summary({ totalMinor: b.totalMinor, deposits: [...b.deposits, deposit] }, b.listing.depositPercent);
      let confirmed = false;
      if (b.status === 'HELD' && s.depositMet) {
        if (!b.hold || b.hold.status !== 'ACTIVE' || b.hold.expiresAt <= new Date()) throw new ConflictException({ code: 'hold_expired' });
        const now = new Date();
        const gate = await tx.booking.updateMany({ where: { id: bookingId, status: 'HELD' }, data: { status: 'CONFIRMED', version: { increment: 1 } } });
        if (gate.count !== 1) throw new ConflictException({ code: 'invalid_transition' });
        await tx.hold.update({ where: { id: b.hold.id }, data: { status: 'CONSUMED', resolvedAt: now } });
        confirmed = true;
      }
      await tx.auditEvent.create({
        data: {
          action: 'deposit.recorded',
          actorId,
          companyId,
          entityType: 'booking',
          entityId: bookingId,
          meta: { method: input.method, amountMinor: input.amountMinor.toString(), currency: input.currency, confirmed } as Prisma.InputJsonValue,
        },
      });
      await notify(tx, b.customerId, confirmed ? 'booking.confirmed' : 'deposit.received', { bookingId, reference: b.reference, amountMinor: input.amountMinor.toString(), currency: input.currency });
      return { deposit: depositView(deposit), summary: s, confirmed };
    });
  }

  async list(companyId: string, bookingId: string) {
    const b = await this.db.booking.findFirst({ where: { id: bookingId, companyId }, include: { deposits: { orderBy: { recordedAt: 'asc' } }, listing: { select: { depositPercent: true } } } });
    if (!b) throw new NotFoundException();
    return { deposits: b.deposits.map(depositView), summary: DepositsService.summary(b, b.listing.depositPercent) };
  }
}

export const depositView = (d: { id: string; method: string; amountMinor: bigint; currency: string; reference: string | null; note: string | null; recordedAt: Date }) => ({
  id: d.id,
  method: d.method,
  amountMinor: d.amountMinor.toString(),
  currency: d.currency,
  reference: d.reference,
  note: d.note,
  recordedAt: d.recordedAt,
});
