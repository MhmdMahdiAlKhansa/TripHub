import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { notify, Prisma, reserveSeats, type PrismaClient } from '@triphub/database';
import { allocatedPaymentPostings, MAX_HOLD_MINUTES, unallocatedPaymentPostings } from '@triphub/shared';
import { FEATURES, type Features } from '../config/features';
import { PRISMA } from '../database/database.module';
import { LedgerService } from '../ledger/ledger.service';

export interface SubmitProofInput {
  method: 'WHISH' | 'OMT';
  reference?: string;
  note?: string;
}

const paymentInclude = { booking: { include: { hold: true } } } satisfies Prisma.PaymentInclude;

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(FEATURES) private readonly features: Features,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  private requirePayments() {
    if (!this.features.payments) throw new ConflictException({ code: 'payments_not_available_yet' });
  }

  /**
   * Records a customer's claim of payment. This is UNVERIFIED evidence: the booking stays HELD
   * ("awaiting verification") and nothing is posted to the ledger until a finance actor verifies settlement.
   */
  async submitProof(customerId: string, bookingId: string, input: SubmitProofInput) {
    this.requirePayments();
    const booking = await this.db.booking.findFirst({ where: { id: bookingId, customerId }, include: { hold: true } });
    if (!booking) throw new NotFoundException();
    if (booking.totalMinor <= 0n) throw new ConflictException({ code: 'nothing_to_pay' });
    const now = new Date();
    if (booking.status !== 'HELD' || !booking.hold || booking.hold.status !== 'ACTIVE' || booking.hold.expiresAt <= now) {
      throw new ConflictException({ code: 'booking_not_awaiting_payment', status: booking.status });
    }

    try {
      return await this.db.$transaction(async (tx) => {
        const first = (await tx.payment.count({ where: { bookingId } })) === 0;
        const payment = await tx.payment.create({
          data: {
            bookingId,
            customerId,
            method: input.method,
            amountMinor: booking.totalMinor, // full upfront: the amount is always the server-side total
            currency: booking.currency,
            reference: input.reference ?? null,
            note: input.note ?? null,
          },
        });
        if (first) {
          // One extension, never beyond the platform cap, so a human can verify the transfer.
          const until = new Date(now.getTime() + MAX_HOLD_MINUTES * 60_000);
          await tx.hold.updateMany({
            where: { bookingId, status: 'ACTIVE', expiresAt: { lt: until } },
            data: { expiresAt: until },
          });
        }
        await tx.auditEvent.create({
          data: {
            action: 'payment.proof_submitted',
            actorId: customerId,
            companyId: booking.companyId,
            entityType: 'payment',
            entityId: payment.id,
            meta: { method: input.method, bookingId },
          },
        });
        return payment;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Driver-adapter errors do not reliably name the violated index, so decide from the data.
        if (input.reference) {
          const used = await this.db.payment.count({ where: { method: input.method, reference: input.reference } });
          if (used > 0) throw new ConflictException({ code: 'reference_already_used' });
        }
        throw new ConflictException({ code: 'payment_already_pending' });
      }
      throw e;
    }
  }

  list(status?: string) {
    return this.db.payment.findMany({
      where: status ? { status: status as never } : {},
      include: { booking: { select: { reference: true, companyId: true, status: true } }, customer: { select: { email: true } } },
      orderBy: { submittedAt: 'asc' },
      take: 200,
    });
  }

  private async load(paymentId: string) {
    const p = await this.db.payment.findUnique({ where: { id: paymentId }, include: paymentInclude });
    if (!p) throw new NotFoundException();
    return p;
  }

  private async guardActor(staffId: string, p: Awaited<ReturnType<PaymentsService['load']>>) {
    if (p.customerId === staffId) throw new ForbiddenException({ code: 'cannot_verify_own_payment' });
    const member = await this.db.membership.count({ where: { companyId: p.booking.companyId, userId: staffId, status: 'ACTIVE' } });
    if (member) throw new ForbiddenException({ code: 'conflict_of_interest' });
  }

  /**
   * Finance confirms the money actually arrived. Exactly one caller can win. The booking is
   * confirmed if its seats are (still) obtainable; otherwise the money is parked as owed back to
   * the customer. Either way the ledger entry is posted in the same transaction.
   */
  async verify(staffId: string, paymentId: string) {
    this.requirePayments();
    const p = await this.load(paymentId);
    await this.guardActor(staffId, p);
    const now = new Date();

    await this.db.$transaction(async (tx) => {
      // Gate: only one decision can ever be made on a payment.
      const gate = await tx.payment.updateMany({
        where: { id: paymentId, status: 'PROOF_SUBMITTED', decidedAt: null },
        data: { decidedAt: now, decidedBy: staffId },
      });
      if (gate.count !== 1) throw new ConflictException({ code: 'payment_not_pending' });

      const booking = await tx.booking.findUniqueOrThrow({ where: { id: p.bookingId } });
      let allocated = false;
      if (booking.status === 'HELD') {
        const r = await tx.booking.updateMany({ where: { id: booking.id, status: 'HELD' }, data: { status: 'CONFIRMED', version: { increment: 1 } } });
        if (r.count === 1) {
          await tx.hold.updateMany({ where: { bookingId: booking.id, status: 'ACTIVE' }, data: { status: 'CONSUMED', resolvedAt: now } });
          allocated = true;
        }
      } else if (booking.status === 'EXPIRED') {
        // The hold lapsed while the transfer was being verified: revive only if the seats are still free.
        if (await reserveSeats(tx, booking.slotId, booking.quantity)) {
          const r = await tx.booking.updateMany({ where: { id: booking.id, status: 'EXPIRED' }, data: { status: 'CONFIRMED', version: { increment: 1 } } });
          if (r.count !== 1) throw new Error('booking changed while reinstating');
          allocated = true;
        }
      }

      const snapshot = booking.snapshot as { commissionBps?: number };
      const total = p.amountMinor;
      const lines = allocated
        ? allocatedPaymentPostings(total, snapshot.commissionBps ?? 0)
        : unallocatedPaymentPostings(total);
      await this.ledger.post(tx, {
        kind: allocated ? 'PAYMENT_VERIFIED' : 'PAYMENT_UNALLOCATED',
        idempotencyKey: `payment:${paymentId}:verified`,
        description: allocated ? `Payment verified for booking ${booking.reference}` : `Verified payment not allocated (booking ${booking.reference} ${booking.status})`,
        currency: p.currency as 'USD' | 'LBP',
        lines,
        companyId: booking.companyId,
        bookingId: booking.id,
        paymentId,
        postedBy: staffId,
      });
      await tx.payment.update({ where: { id: paymentId }, data: { status: allocated ? 'VERIFIED' : 'VERIFIED_UNALLOCATED' } });
      await tx.auditEvent.create({
        data: {
          action: allocated ? 'payment.verified' : 'payment.verified_unallocated',
          actorId: staffId,
          companyId: booking.companyId,
          entityType: 'payment',
          entityId: paymentId,
          meta: { bookingId: booking.id, bookingStatus: booking.status },
        },
      });
      await notify(tx, p.customerId, allocated ? 'payment.verified' : 'payment.verified_unallocated', { bookingId: booking.id });
    });
    return this.load(paymentId);
  }

  async reject(staffId: string, paymentId: string, reason: string) {
    this.requirePayments();
    const p = await this.load(paymentId);
    await this.guardActor(staffId, p);
    await this.db.$transaction(async (tx) => {
      const r = await tx.payment.updateMany({
        where: { id: paymentId, status: 'PROOF_SUBMITTED', decidedAt: null },
        data: { status: 'REJECTED', decidedAt: new Date(), decidedBy: staffId, decisionReason: reason },
      });
      if (r.count !== 1) throw new ConflictException({ code: 'payment_not_pending' });
      await tx.auditEvent.create({
        data: {
          action: 'payment.rejected',
          actorId: staffId,
          companyId: p.booking.companyId,
          entityType: 'payment',
          entityId: paymentId,
          meta: { reason },
        },
      });
      await notify(tx, p.customerId, 'payment.rejected', { bookingId: p.bookingId });
    });
    return this.load(paymentId);
  }
}

export const paymentView = (p: { id: string; method: string; status: string; amountMinor: bigint; currency: string; reference: string | null; submittedAt: Date; decidedAt: Date | null }) => ({
  id: p.id,
  method: p.method,
  amountMinor: p.amountMinor.toString(),
  currency: p.currency,
  reference: p.reference,
  status: p.status,
  // Plain-language status that never overstates what is known.
  state:
    p.status === 'PROOF_SUBMITTED'
      ? 'awaiting_verification'
      : p.status === 'REJECTED'
        ? 'rejected'
        : p.status === 'VERIFIED_UNALLOCATED'
          ? 'verified_refund_due'
          : 'verified',
  submittedAt: p.submittedAt,
  decidedAt: p.decidedAt,
});
