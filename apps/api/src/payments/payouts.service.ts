import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@triphub/database';
import { PAYOUT_HOLD_HOURS, payoutPaidPostings } from '@triphub/shared';
import { FEATURES, type Features } from '../config/features';
import { PRISMA } from '../database/database.module';
import { LedgerService } from '../ledger/ledger.service';

const include = { company: { select: { id: true, name: true, slug: true } } } satisfies Prisma.PayoutInclude;
type Tx = Prisma.TransactionClient;
export type PayoutRow = Prisma.PayoutGetPayload<{ include: typeof include }>;

/**
 * Payouts of the amounts the platform owes businesses (COMPANY_PAYABLE). A payout needs three
 * different finance people (request, approve, attest the manual transfer); the ledger moves only
 * when the transfer is attested. Earnings from a trip become payable PAYOUT_HOLD_HOURS after it starts.
 */
@Injectable()
export class PayoutsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(FEATURES) private readonly features: Features,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  private requirePayments() {
    if (!this.features.payments) throw new ConflictException({ code: 'payments_not_available_yet' });
  }

  /** What the platform owes the business, what is still inside the hold window, and what is already earmarked. */
  async payable(companyId: string, currency: 'USD' | 'LBP', db: PrismaClient | Tx = this.db) {
    const [owed] = await db.$queryRaw<Array<{ total: bigint | null }>>`
      SELECT COALESCE(-SUM(l."amountMinor"), 0)::bigint AS total
        FROM "ledger_line" l JOIN "ledger_account" a ON a.id = l."accountId"
       WHERE a."type" = 'COMPANY_PAYABLE' AND a."companyId" = ${companyId}::uuid AND a."currency" = ${currency}`;
    const [held] = await db.$queryRaw<Array<{ total: bigint | null }>>`
      SELECT COALESCE(-SUM(l."amountMinor"), 0)::bigint AS total
        FROM "ledger_line" l
        JOIN "ledger_account" a ON a.id = l."accountId"
        JOIN "journal_entry" e ON e.id = l."entryId"
        JOIN "booking" b ON b.id = e."bookingId"
        JOIN "slot" s ON s.id = b."slotId"
       WHERE a."type" = 'COMPANY_PAYABLE' AND a."companyId" = ${companyId}::uuid AND a."currency" = ${currency}
         AND s."startsAt" > now() - make_interval(hours => ${PAYOUT_HOLD_HOURS}::int)`;
    const earmarked = await db.payout.aggregate({
      where: { companyId, currency, status: { in: ['REQUESTED', 'APPROVED'] } },
      _sum: { amountMinor: true },
    });
    const owedMinor = owed?.total ?? 0n;
    const heldMinor = held?.total ?? 0n;
    const earmarkedMinor = earmarked._sum.amountMinor ?? 0n;
    const eligible = owedMinor - heldMinor - earmarkedMinor;
    return { owedMinor, heldMinor, earmarkedMinor, eligibleMinor: eligible > 0n ? eligible : 0n };
  }

  /** Request a payout. Serialised per business so two requests can never earmark the same money. */
  async request(staffId: string, companyId: string, input: { amountMinor: bigint; currency: 'USD' | 'LBP'; note?: string }) {
    this.requirePayments();
    const company = await this.db.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException();
    if (await this.db.membership.count({ where: { companyId, userId: staffId, status: 'ACTIVE' } })) {
      throw new ForbiddenException({ code: 'conflict_of_interest' });
    }
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "company" WHERE "id" = ${companyId}::uuid FOR UPDATE`;
      const p = await this.payable(companyId, input.currency, tx);
      if (input.amountMinor > p.eligibleMinor) {
        throw new ConflictException({ code: 'exceeds_eligible_balance', eligibleMinor: p.eligibleMinor.toString() });
      }
      const row = await tx.payout.create({
        data: { companyId, amountMinor: input.amountMinor, currency: input.currency, note: input.note ?? null, requestedBy: staffId },
        include,
      });
      await tx.auditEvent.create({
        data: { action: 'payout.requested', actorId: staffId, companyId, entityType: 'payout', entityId: row.id, meta: { amountMinor: input.amountMinor.toString(), currency: input.currency } },
      });
      return row;
    });
  }

  private async load(id: string) {
    const r = await this.db.payout.findUnique({ where: { id }, include });
    if (!r) throw new NotFoundException();
    return r;
  }

  private async guard(staffId: string, r: PayoutRow) {
    if (await this.db.membership.count({ where: { companyId: r.companyId, userId: staffId, status: 'ACTIVE' } })) {
      throw new ForbiddenException({ code: 'conflict_of_interest' });
    }
  }

  async approve(staffId: string, id: string) {
    this.requirePayments();
    const r = await this.load(id);
    if (r.requestedBy === staffId) throw new ForbiddenException({ code: 'separation_of_duties' });
    await this.guard(staffId, r);
    const gate = await this.db.payout.updateMany({ where: { id, status: 'REQUESTED' }, data: { status: 'APPROVED', decidedBy: staffId, decidedAt: new Date() } });
    if (gate.count !== 1) throw new ConflictException({ code: 'payout_not_pending' });
    await this.db.auditEvent.create({ data: { action: 'payout.approved', actorId: staffId, companyId: r.companyId, entityType: 'payout', entityId: id, meta: {} } });
    return this.load(id);
  }

  async reject(staffId: string, id: string, reason: string) {
    this.requirePayments();
    const r = await this.load(id);
    if (r.requestedBy === staffId) throw new ForbiddenException({ code: 'separation_of_duties' });
    await this.guard(staffId, r);
    const gate = await this.db.payout.updateMany({
      where: { id, status: 'REQUESTED' },
      data: { status: 'REJECTED', decidedBy: staffId, decidedAt: new Date(), decisionReason: reason },
    });
    if (gate.count !== 1) throw new ConflictException({ code: 'payout_not_pending' });
    await this.db.auditEvent.create({ data: { action: 'payout.rejected', actorId: staffId, companyId: r.companyId, entityType: 'payout', entityId: id, meta: { reason } } });
    return this.load(id);
  }

  /** Attests that the transfer was made. Only now does the ledger move. */
  async markPaid(staffId: string, id: string, payoutReference: string) {
    this.requirePayments();
    const r = await this.load(id);
    if (r.requestedBy === staffId || r.decidedBy === staffId) throw new ForbiddenException({ code: 'separation_of_duties' });
    await this.guard(staffId, r);
    try {
      await this.db.$transaction(async (tx) => {
        const gate = await tx.payout.updateMany({
          where: { id, status: 'APPROVED' },
          data: { status: 'PAID', paidBy: staffId, paidAt: new Date(), payoutReference },
        });
        if (gate.count !== 1) throw new ConflictException({ code: 'payout_not_approved' });
        await this.ledger.post(tx, {
          kind: 'PAYOUT_PAID',
          idempotencyKey: `payout:${id}:paid`,
          description: `Payout to ${r.company.name}`,
          currency: r.currency as 'USD' | 'LBP',
          lines: payoutPaidPostings(r.amountMinor),
          companyId: r.companyId,
          postedBy: staffId,
        });
        await tx.auditEvent.create({
          data: { action: 'payout.paid', actorId: staffId, companyId: r.companyId, entityType: 'payout', entityId: id, meta: { payoutReference } },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException({ code: 'reference_already_used' });
      throw e;
    }
    return this.load(id);
  }

  list(status?: string) {
    return this.db.payout.findMany({ where: status ? { status: status as never } : {}, include, orderBy: { requestedAt: 'asc' }, take: 200 });
  }

  forCompany(companyId: string) {
    return this.db.payout.findMany({ where: { companyId }, include, orderBy: { requestedAt: 'desc' }, take: 100 });
  }
}

export const payoutView = (p: PayoutRow) => ({
  id: p.id,
  company: p.company,
  amountMinor: p.amountMinor.toString(),
  currency: p.currency,
  status: p.status,
  // "paid" is said only after finance attested the transfer with a reference.
  state: p.status === 'PAID' ? 'paid' : p.status === 'APPROVED' ? 'approved_awaiting_transfer' : p.status === 'REJECTED' ? 'rejected' : 'under_review',
  note: p.note,
  payoutReference: p.payoutReference,
  requestedAt: p.requestedAt,
  decidedAt: p.decidedAt,
  paidAt: p.paidAt,
});
