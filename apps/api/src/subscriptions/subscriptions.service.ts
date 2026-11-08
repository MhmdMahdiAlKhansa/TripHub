import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@triphub/database';
import {
  addDays,
  addMonths,
  addOnMonthlyMinor,
  cycleAmountMinor,
  entitlementsFor,
  limitsFor,
  PLANS,
  SELF_SERVE_PLANS,
  TRIAL_DAYS,
  trialActivationDeadline,
  type AddOns,
  type Cycle,
  type Entitlements,
  type PlanCode,
  type SubscriptionState,
} from '@triphub/shared';
import { randomBytes } from 'node:crypto';
import { PRISMA } from '../database/database.module';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const invoiceNumber = () => 'INV-' + Array.from(randomBytes(8), (b) => ALPHABET[b % 32]).join('');

export const toState = (s: { planCode: string; status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; addOns: unknown }): SubscriptionState => ({
  planCode: s.planCode as PlanCode,
  status: s.status as SubscriptionState['status'],
  trialEndsAt: s.trialEndsAt,
  currentPeriodEnd: s.currentPeriodEnd,
  cancelAtPeriodEnd: s.cancelAtPeriodEnd,
  addOns: (s.addOns ?? {}) as AddOns,
});

@Injectable()
export class SubscriptionsService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /** Price in force at `at` for each plan (latest effective row not in the future). */
  async currentPrices(at = new Date()) {
    const rows = await this.db.planPrice.findMany({ where: { effectiveFrom: { lte: at } }, orderBy: { effectiveFrom: 'desc' } });
    const out = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!out.has(r.planCode)) out.set(r.planCode, r);
    return out;
  }

  async catalog() {
    const prices = await this.currentPrices();
    return (['TRIAL', 'STARTER', 'GROWTH', 'PRO', 'ENTERPRISE'] as const).map((code) => {
      const p = PLANS[code];
      const price = prices.get(code);
      return {
        code,
        name: p.name,
        listingLimit: p.listingLimit,
        teamLimit: p.teamLimit,
        capabilities: p.capabilities,
        monthlyMinor: price ? price.monthlyMinor.toString() : null, // null = negotiated
        commissionBps: price ? price.commissionBps : null,
        currency: 'USD',
      };
    });
  }

  async entitlements(companyId: string, now = new Date()): Promise<Entitlements> {
    const s = await this.db.subscription.findUnique({ where: { companyId } });
    return entitlementsFor(s ? toState(s) : null, now);
  }

  async overview(companyId: string) {
    const [sub, company, openRequest, listings, members] = await Promise.all([
      this.db.subscription.findUnique({ where: { companyId } }),
      this.db.company.findUniqueOrThrow({ where: { id: companyId }, select: { status: true, approvedAt: true } }),
      this.db.subscriptionRequest.findFirst({ where: { companyId, status: 'OPEN' } }),
      this.db.listing.count({ where: { companyId, status: 'PUBLISHED' } }),
      this.usedSeats(companyId),
    ]);
    const now = new Date();
    const e = entitlementsFor(sub ? toState(sub) : null, now);
    const deadline = company.approvedAt ? trialActivationDeadline(company.approvedAt) : null;
    return {
      subscription: sub && {
        plan: sub.planCode,
        storedStatus: sub.status,
        status: e.status,
        cycle: sub.cycle,
        trialEndsAt: sub.trialEndsAt,
        currentPeriodEnd: sub.currentPeriodEnd,
        graceEndsAt: e.graceEndsAt,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        addOns: sub.addOns,
        monthlyMinor: sub.monthlyMinor.toString(),
        commissionBps: sub.commissionBps,
      },
      entitlements: { canPublish: e.canPublish, canAcceptNewBookings: e.canAcceptNewBookings, listingLimit: e.listingLimit, teamLimit: e.teamLimit },
      usage: { activeListings: listings, teamSeats: members },
      trial: {
        eligible: !sub && company.status === 'APPROVED' && !!deadline && now <= deadline,
        activateBy: !sub ? deadline : null,
        used: !!sub?.trialStartedAt,
      },
      openRequest: openRequest && { id: openRequest.id, plan: openRequest.planCode, cycle: openRequest.cycle, addOns: openRequest.addOns, createdAt: openRequest.createdAt },
    };
  }

  /** Seats in use: active members plus invitations still pending. */
  async usedSeats(companyId: string): Promise<number> {
    const [m, i] = await Promise.all([
      this.db.membership.count({ where: { companyId, status: 'ACTIVE' } }),
      this.db.invitation.count({ where: { companyId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    return m + i;
  }

  // ------------------------------------------------------------------ enforcement (used by other modules)

  async assertCanPublish(companyId: string) {
    const e = await this.entitlements(companyId);
    if (!e.canPublish) throw new ConflictException({ code: 'subscription_required', status: e.status });
    if (e.listingLimit !== null) {
      const n = await this.db.listing.count({ where: { companyId, status: 'PUBLISHED' } });
      if (n >= e.listingLimit) throw new ConflictException({ code: 'plan_limit_reached', limit: 'listings', max: e.listingLimit });
    }
  }

  async assertCanAcceptBookings(companyId: string) {
    const e = await this.entitlements(companyId);
    if (!e.canAcceptNewBookings) throw new ConflictException({ code: 'business_not_accepting_bookings', status: e.status });
  }

  async assertCanAddTeamMember(companyId: string) {
    const has = await this.db.subscription.count({ where: { companyId } });
    // Before activation a business may still set up a small team (the trial's size); afterwards its plan decides.
    const max = has ? (await this.entitlements(companyId)).teamLimit : PLANS.TRIAL.teamLimit;
    if (max === null) return;
    if ((await this.usedSeats(companyId)) >= max) throw new ConflictException({ code: 'plan_limit_reached', limit: 'team', max });
  }

  /** The commission rate a new booking is sold at: the contract's, or the company default with no plan. */
  async commissionBpsFor(companyId: string, fallback: number): Promise<number> {
    const s = await this.db.subscription.findUnique({ where: { companyId }, select: { commissionBps: true } });
    return s?.commissionBps ?? fallback;
  }

  // ------------------------------------------------------------------ business actions

  /**
   * Starts the free trial. Requires an approved business inside its activation window, one trial per
   * business ever, and an explicit acknowledgement of the commission rate that applies during it.
   */
  async startTrial(companyId: string, userId: string, acknowledgedCommissionBps: number) {
    const company = await this.db.company.findUniqueOrThrow({ where: { id: companyId } });
    if (company.status !== 'APPROVED' || !company.approvedAt) throw new ConflictException({ code: 'company_not_verified' });
    const now = new Date();
    if (now > trialActivationDeadline(company.approvedAt)) throw new ConflictException({ code: 'trial_window_closed' });
    const price = (await this.currentPrices(now)).get('TRIAL');
    const commissionBps = price?.commissionBps ?? PLANS.TRIAL.defaultCommissionBps!;
    if (acknowledgedCommissionBps !== commissionBps) {
      throw new UnprocessableEntityException({ code: 'commission_not_acknowledged', commissionBps });
    }
    try {
      await this.db.$transaction(async (tx) => {
        await tx.subscription.create({
          data: {
            companyId,
            planCode: 'TRIAL',
            status: 'TRIALING',
            trialStartedAt: now,
            trialEndsAt: addDays(now, TRIAL_DAYS),
            trialConsentBy: userId,
            commissionBps,
          },
        });
        await tx.auditEvent.create({
          data: { action: 'subscription.trial_started', actorId: userId, companyId, entityType: 'company', entityId: companyId, meta: { commissionBps } },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException({ code: 'trial_already_used' });
      throw e;
    }
    return this.overview(companyId);
  }

  /** The business's affirmative request for a paid plan (or renewal). Nothing is charged by this. */
  async requestPlan(companyId: string, userId: string, input: { plan: PlanCode; cycle: Cycle; addOns: AddOns }) {
    if (!(SELF_SERVE_PLANS as readonly string[]).includes(input.plan)) throw new UnprocessableEntityException({ code: 'plan_not_self_serve' });
    addOnMonthlyMinor(input.addOns); // validates quantities
    await this.db.subscriptionRequest.updateMany({ where: { companyId, status: 'OPEN' }, data: { status: 'CANCELLED', resolvedAt: new Date() } });
    const r = await this.db.subscriptionRequest.create({
      data: { companyId, planCode: input.plan, cycle: input.cycle, addOns: input.addOns as Prisma.InputJsonValue, requestedBy: userId },
    });
    await this.db.auditEvent.create({
      data: { action: 'subscription.requested', actorId: userId, companyId, entityType: 'subscription_request', entityId: r.id, meta: { plan: input.plan, cycle: input.cycle } },
    });
    return this.overview(companyId);
  }

  async cancel(companyId: string, userId: string) {
    const s = await this.db.subscription.findUnique({ where: { companyId } });
    if (!s) throw new NotFoundException();
    const e = entitlementsFor(toState(s), new Date());
    if (s.status === 'TRIALING') {
      // Ending a trial early forfeits the remainder; existing bookings and data are untouched.
      await this.db.subscription.update({ where: { companyId }, data: { status: 'CANCELLED' } });
    } else if (e.status === 'ACTIVE' || e.status === 'PAST_DUE') {
      await this.db.subscription.update({ where: { companyId }, data: { cancelAtPeriodEnd: true } });
    } else {
      throw new ConflictException({ code: 'nothing_to_cancel', status: e.status });
    }
    await this.db.subscriptionRequest.updateMany({ where: { companyId, status: 'OPEN' }, data: { status: 'CANCELLED', resolvedAt: new Date() } });
    await this.db.auditEvent.create({ data: { action: 'subscription.cancelled', actorId: userId, companyId, entityType: 'company', entityId: companyId, meta: {} } });
    return this.overview(companyId);
  }

  // ------------------------------------------------------------------ platform finance

  listOpenRequests() {
    return this.db.subscriptionRequest.findMany({
      where: { status: 'OPEN' },
      include: { company: { select: { name: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  /** Amount the request will cost, computed server-side from the price in force now. */
  async quoteRequest(requestId: string) {
    const r = await this.db.subscriptionRequest.findUnique({ where: { id: requestId } });
    if (!r) throw new NotFoundException();
    const price = (await this.currentPrices()).get(r.planCode);
    if (!price) throw new ConflictException({ code: 'no_price' });
    const addOns = r.addOns as AddOns;
    const amountMinor = cycleAmountMinor(price.monthlyMinor, addOnMonthlyMinor(addOns), r.cycle as Cycle);
    return { r, price, addOns, amountMinor };
  }

  /**
   * Finance records a verified manual payment and fulfils the business's request. The price and
   * commission are snapshotted on the subscription so later price changes never alter this contract.
   */
  async fulfil(staffId: string, requestId: string, payment: { method: 'WHISH' | 'OMT' | 'BANK'; reference: string }) {
    const { r, price, addOns, amountMinor } = await this.quoteRequest(requestId);
    if (r.status !== 'OPEN') throw new ConflictException({ code: 'request_not_open' });
    const member = await this.db.membership.count({ where: { companyId: r.companyId, userId: staffId, status: 'ACTIVE' } });
    if (member) throw new ForbiddenException({ code: 'conflict_of_interest' });
    if (r.requestedBy === staffId) throw new ForbiddenException({ code: 'separation_of_duties' });

    const now = new Date();
    const cycle = r.cycle as Cycle;
    const months = cycle === 'ANNUAL' ? 12 : 1;
    try {
      const invoice = await this.db.$transaction(async (tx) => {
        const gate = await tx.subscriptionRequest.updateMany({ where: { id: requestId, status: 'OPEN' }, data: { status: 'FULFILLED', resolvedAt: now } });
        if (gate.count !== 1) throw new ConflictException({ code: 'request_not_open' });

        const existing = await tx.subscription.findUnique({ where: { companyId: r.companyId } });
        // Renewing the same plan while still covered extends from the current end; otherwise it starts now.
        const extend = existing && existing.planCode === r.planCode && existing.currentPeriodEnd && existing.currentPeriodEnd > now;
        const periodStart = extend ? existing.currentPeriodEnd! : now;
        const periodEnd = addMonths(periodStart, months);
        const data = {
          planCode: r.planCode,
          status: 'ACTIVE' as const,
          cycle: r.cycle,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          addOns: addOns as Prisma.InputJsonValue,
          monthlyMinor: price.monthlyMinor + addOnMonthlyMinor(addOns),
          commissionBps: price.commissionBps,
        };
        const sub = existing
          ? await tx.subscription.update({ where: { companyId: r.companyId }, data })
          : await tx.subscription.create({ data: { companyId: r.companyId, ...data } });
        const inv = await tx.invoice.create({
          data: {
            number: invoiceNumber(),
            companyId: r.companyId,
            subscriptionId: sub.id,
            requestId,
            planCode: r.planCode,
            cycle: r.cycle,
            periodStart,
            periodEnd,
            lines: {
              plan: r.planCode,
              monthlyMinor: price.monthlyMinor.toString(),
              addOns,
              addOnsMonthlyMinor: addOnMonthlyMinor(addOns).toString(),
              cycle,
              annualDiscountApplied: cycle === 'ANNUAL',
            } as Prisma.InputJsonValue,
            amountMinor,
            paymentMethod: payment.method,
            paymentReference: payment.reference,
            recordedBy: staffId,
          },
        });
        await tx.auditEvent.create({
          data: {
            action: 'subscription.activated',
            actorId: staffId,
            companyId: r.companyId,
            entityType: 'invoice',
            entityId: inv.id,
            meta: { plan: r.planCode, cycle, amountMinor: amountMinor.toString(), reference: payment.reference },
          },
        });
        return inv;
      });
      return invoice;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException({ code: 'reference_already_used' });
      throw e;
    }
  }

  async invoices(companyId: string) {
    return this.db.invoice.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

}

export { limitsFor };
