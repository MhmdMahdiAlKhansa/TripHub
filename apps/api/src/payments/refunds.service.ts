import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { notify, Prisma, type PrismaClient } from '@triphub/database';
import { CANCELLATION_POLICIES, DEFAULT_CANCELLATION_POLICY, refundableMinor, refundApprovalPostings, refundPaidPostings, type CancellationPolicy } from '@triphub/shared';
import { FEATURES, type Features } from '../config/features';
import { PRISMA } from '../database/database.module';
import { LedgerService } from '../ledger/ledger.service';

const include = { payment: { include: { booking: true } } } satisfies Prisma.RefundInclude;
type RefundFull = Prisma.RefundGetPayload<{ include: typeof include }>;

/**
 * Full refunds of verified payments. Three distinct people are needed to complete one
 * (requester, approver, payer); the database also enforces that. "Paid" is an attestation by
 * finance that they made the manual transfer: this system does not move money.
 */
@Injectable()
export class RefundsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(FEATURES) private readonly features: Features,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  private requirePayments() {
    if (!this.features.payments) throw new ConflictException({ code: 'payments_not_available_yet' });
  }

  private async load(id: string): Promise<RefundFull> {
    const r = await this.db.refund.findUnique({ where: { id }, include });
    if (!r) throw new NotFoundException();
    return r;
  }

  /** A refund can be asked for only when the money is verified AND no live booking holds it. */
  private async open(actorId: string, paymentId: string, reason: string, scope: { companyId?: string }) {
    this.requirePayments();
    const p = await this.db.payment.findFirst({
      where: { id: paymentId, ...(scope.companyId ? { booking: { companyId: scope.companyId } } : {}) },
      include: { booking: { include: { slot: true } } },
    });
    if (!p) throw new NotFoundException();
    if (p.customerId === actorId) throw new ForbiddenException({ code: 'cannot_refund_own_payment' });
    const refundable =
      (p.status === 'VERIFIED' && p.booking.status === 'CANCELLED') ||
      (p.status === 'VERIFIED_UNALLOCATED' && !scope.companyId);
    if (!refundable) throw new ConflictException({ code: 'payment_not_refundable', status: p.status, bookingStatus: p.booking.status });
    if (!scope.companyId) {
      const member = await this.db.membership.count({ where: { companyId: p.booking.companyId, userId: actorId, status: 'ACTIVE' } });
      if (member) throw new ForbiddenException({ code: 'conflict_of_interest' });
    }
    // Unallocated money is always returned in full. For a cancelled booking the policy the customer
    // agreed to decides, unless the business itself cancelled (always a full refund).
    let amount = p.amountMinor;
    if (p.status === 'VERIFIED') {
      const code = (p.booking.snapshot as { cancellationPolicy?: { code?: string } | null }).cancellationPolicy?.code;
      const policy: CancellationPolicy = (CANCELLATION_POLICIES as readonly string[]).includes(code ?? '') ? (code as CancellationPolicy) : DEFAULT_CANCELLATION_POLICY;
      amount = refundableMinor({
        paidMinor: p.amountMinor,
        policy,
        startsAt: p.booking.slot.startsAt,
        cancelledAt: p.booking.cancelledAt ?? new Date(),
        by: p.booking.cancelledBy === 'BUSINESS' ? 'BUSINESS' : 'CUSTOMER',
      });
      if (amount <= 0n) throw new ConflictException({ code: 'no_refund_due', policy });
    }
    try {
      return await this.db.$transaction(async (tx) => {
        const refund = await tx.refund.create({
          data: { paymentId, bookingId: p.bookingId, amountMinor: amount, currency: p.currency, reason, requestedBy: actorId },
        });
        await tx.auditEvent.create({
          data: { action: 'refund.requested', actorId, companyId: p.booking.companyId, entityType: 'refund', entityId: refund.id, meta: { paymentId } },
        });
        return refund;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException({ code: 'refund_already_exists' });
      throw e;
    }
  }

  /** Business asks for the refund of a cancelled booking's payment. */
  requestForBooking = async (actorId: string, companyId: string, bookingId: string, reason: string) => {
    const payment = await this.db.payment.findFirst({ where: { bookingId, status: 'VERIFIED', booking: { companyId } } });
    if (!payment) throw new NotFoundException();
    return this.open(actorId, payment.id, reason, { companyId });
  };

  /** Finance opens a refund directly (e.g. money verified but not allocated to a live booking). */
  requestForPayment(actorId: string, paymentId: string, reason: string) {
    return this.open(actorId, paymentId, reason, {});
  }

  list(status?: string) {
    return this.db.refund.findMany({
      where: status ? { status: status as never } : {},
      include,
      orderBy: { requestedAt: 'asc' },
      take: 200,
    });
  }

  forBooking(customerId: string, bookingId: string) {
    return this.db.refund.findFirst({ where: { bookingId, payment: { customerId } }, include });
  }

  async approve(staffId: string, id: string) {
    this.requirePayments();
    const r = await this.load(id);
    if (r.requestedBy === staffId) throw new ForbiddenException({ code: 'separation_of_duties' });
    await this.guardActor(staffId, r);
    await this.db.$transaction(async (tx) => {
      const gate = await tx.refund.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: 'APPROVED', decidedBy: staffId, decidedAt: new Date() },
      });
      if (gate.count !== 1) throw new ConflictException({ code: 'refund_not_pending' });
      if (r.payment.status === 'VERIFIED') {
        const bps = (r.payment.booking.snapshot as { commissionBps?: number }).commissionBps ?? 0;
        await this.ledger.post(tx, {
          kind: 'REFUND_APPROVED',
          idempotencyKey: `refund:${id}:approved`,
          description: `Refund approved for booking ${r.payment.booking.reference}`,
          currency: r.currency as 'USD' | 'LBP',
          lines: refundApprovalPostings(r.amountMinor, bps),
          companyId: r.payment.booking.companyId,
          bookingId: r.bookingId,
          paymentId: r.paymentId,
          postedBy: staffId,
        });
      }
      await tx.auditEvent.create({
        data: { action: 'refund.approved', actorId: staffId, companyId: r.payment.booking.companyId, entityType: 'refund', entityId: id, meta: {} },
      });
      await notify(tx, r.payment.customerId, 'refund.approved', { bookingId: r.bookingId });
    });
    return this.load(id);
  }

  async reject(staffId: string, id: string, reason: string) {
    this.requirePayments();
    const r = await this.load(id);
    if (r.requestedBy === staffId) throw new ForbiddenException({ code: 'separation_of_duties' });
    await this.guardActor(staffId, r);
    await this.db.$transaction(async (tx) => {
      const gate = await tx.refund.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: 'REJECTED', decidedBy: staffId, decidedAt: new Date(), decisionReason: reason },
      });
      if (gate.count !== 1) throw new ConflictException({ code: 'refund_not_pending' });
      await tx.auditEvent.create({
        data: { action: 'refund.rejected', actorId: staffId, companyId: r.payment.booking.companyId, entityType: 'refund', entityId: id, meta: { reason } },
      });
      await notify(tx, r.payment.customerId, 'refund.rejected', { bookingId: r.bookingId });
    });
    return this.load(id);
  }

  /** Finance attests that the manual transfer to the customer was made, with its reference. */
  async markPaid(staffId: string, id: string, payoutReference: string) {
    this.requirePayments();
    const r = await this.load(id);
    if (r.requestedBy === staffId || r.decidedBy === staffId) throw new ForbiddenException({ code: 'separation_of_duties' });
    await this.guardActor(staffId, r);
    await this.db.$transaction(async (tx) => {
      const gate = await tx.refund.updateMany({
        where: { id, status: 'APPROVED' },
        data: { status: 'PAID', paidBy: staffId, paidAt: new Date(), payoutReference },
      });
      if (gate.count !== 1) throw new ConflictException({ code: 'refund_not_approved' });
      await this.ledger.post(tx, {
        kind: 'REFUND_PAID',
        idempotencyKey: `refund:${id}:paid`,
        description: `Refund paid out for booking ${r.payment.booking.reference}`,
        currency: r.currency as 'USD' | 'LBP',
        lines: refundPaidPostings(r.amountMinor),
        bookingId: r.bookingId,
        paymentId: r.paymentId,
        postedBy: staffId,
      });
      await tx.auditEvent.create({
        data: { action: 'refund.paid', actorId: staffId, companyId: r.payment.booking.companyId, entityType: 'refund', entityId: id, meta: { payoutReference } },
      });
      await notify(tx, r.payment.customerId, 'refund.paid', { bookingId: r.bookingId });
    });
    return this.load(id);
  }

  private async guardActor(staffId: string, r: RefundFull) {
    if (r.payment.customerId === staffId) throw new ForbiddenException({ code: 'cannot_decide_own_refund' });
    const member = await this.db.membership.count({ where: { companyId: r.payment.booking.companyId, userId: staffId, status: 'ACTIVE' } });
    if (member) throw new ForbiddenException({ code: 'conflict_of_interest' });
  }
}

export const refundView = (r: {
  id: string;
  status: string;
  amountMinor: bigint;
  currency: string;
  reason: string;
  requestedAt: Date;
  decidedAt: Date | null;
  paidAt: Date | null;
  payoutReference?: string | null;
}) => ({
  id: r.id,
  status: r.status,
  amountMinor: r.amountMinor.toString(),
  currency: r.currency,
  reason: r.reason,
  // Never says "refunded" until finance has attested the transfer.
  state: r.status === 'PAID' ? 'refunded' : r.status === 'APPROVED' ? 'approved_awaiting_transfer' : r.status === 'REJECTED' ? 'rejected' : 'under_review',
  requestedAt: r.requestedAt,
  decidedAt: r.decidedAt,
  paidAt: r.paidAt,
});
