import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@triphub/database';
import { PLANS, promoCodeLimit, promoDiscountMinor, type AddOns, type Currency, type PlanCode, type PromoRule } from '@triphub/shared';
import { PRISMA } from '../database/database.module';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

export type PromoFailure = 'not_found' | 'inactive' | 'not_started' | 'expired' | 'wrong_listing' | 'exhausted' | 'already_used' | 'no_discount';

export interface CreatePromoInput {
  code: string;
  kind: 'PERCENT' | 'FIXED';
  percentBps?: number;
  amountMinor?: bigint;
  currency?: 'USD' | 'LBP';
  listingId?: string;
  validFrom?: Date;
  validTo?: Date;
  maxRedemptions?: number;
}

@Injectable()
export class PromoService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(SubscriptionsService) private readonly subs: SubscriptionsService,
  ) {}

  /** null = unlimited. A business without an entitled subscription has no marketing tools. */
  private async limit(companyId: string): Promise<number | null> {
    const sub = await this.db.subscription.findUnique({ where: { companyId } });
    const e = await this.subs.entitlements(companyId);
    if (!sub || !e.canPublish) return 0;
    const addOns = (sub.addOns ?? {}) as AddOns;
    return promoCodeLimit(PLANS[sub.planCode as PlanCode].capabilities, (addOns.MARKETING ?? 0) > 0);
  }

  async create(companyId: string, actorId: string, input: CreatePromoInput) {
    const limit = await this.limit(companyId);
    if (limit === 0) throw new ConflictException({ code: 'marketing_not_included' });
    if (limit !== null && (await this.db.promoCode.count({ where: { companyId, active: true } })) >= limit) {
      throw new ConflictException({ code: 'plan_limit_reached', limit: 'promo_codes', max: limit });
    }
    if (input.listingId && !(await this.db.listing.count({ where: { id: input.listingId, companyId } }))) throw new NotFoundException();
    try {
      const row = await this.db.promoCode.create({
        data: {
          companyId,
          code: input.code,
          kind: input.kind,
          percentBps: input.kind === 'PERCENT' ? input.percentBps : null,
          amountMinor: input.kind === 'FIXED' ? input.amountMinor : null,
          currency: input.kind === 'FIXED' ? input.currency : null,
          listingId: input.listingId ?? null,
          validFrom: input.validFrom ?? null,
          validTo: input.validTo ?? null,
          maxRedemptions: input.maxRedemptions ?? null,
          createdBy: actorId,
        },
      });
      await this.db.auditEvent.create({ data: { action: 'promo.created', actorId, companyId, entityType: 'promo_code', entityId: row.id, meta: { code: input.code } } });
      return row;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException({ code: 'code_already_exists' });
      throw e;
    }
  }

  list(companyId: string) {
    return this.db.promoCode.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async setActive(companyId: string, actorId: string, id: string, active: boolean) {
    const r = await this.db.promoCode.updateMany({ where: { id, companyId }, data: { active } });
    if (r.count !== 1) throw new NotFoundException();
    await this.db.auditEvent.create({ data: { action: active ? 'promo.enabled' : 'promo.disabled', actorId, companyId, entityType: 'promo_code', entityId: id, meta: {} } });
    return this.db.promoCode.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Validates a code for a booking and computes the discount. `customerId` is null for a public price
   * preview (the per-customer check then happens at booking time).
   */
  async resolve(input: { companyId: string; listingId: string; code: string; customerId: string | null; totalMinor: bigint; currency: Currency }) {
    const fail = (reason: PromoFailure): never => {
      throw new UnprocessableEntityException({ code: 'promo_invalid', reason });
    };
    const promo = await this.db.promoCode.findUnique({ where: { companyId_code: { companyId: input.companyId, code: input.code } } });
    if (!promo) return fail('not_found');
    if (!promo.active) return fail('inactive');
    const now = new Date();
    if (promo.validFrom && promo.validFrom > now) return fail('not_started');
    if (promo.validTo && promo.validTo <= now) return fail('expired');
    if (promo.listingId && promo.listingId !== input.listingId) return fail('wrong_listing');
    if (promo.maxRedemptions !== null && promo.redeemed >= promo.maxRedemptions) return fail('exhausted');
    if (input.customerId && (await this.db.promoRedemption.count({ where: { promoId: promo.id, customerId: input.customerId } }))) return fail('already_used');
    const rule: PromoRule =
      promo.kind === 'PERCENT'
        ? { kind: 'PERCENT', percentBps: promo.percentBps! }
        : { kind: 'FIXED', amountMinor: promo.amountMinor!, currency: promo.currency as Currency };
    const discountMinor = promoDiscountMinor(input.totalMinor, input.currency, rule);
    if (discountMinor <= 0n) return fail('no_discount');
    return { promo, discountMinor };
  }
}

export const promoView = (p: {
  id: string; code: string; kind: string; percentBps: number | null; amountMinor: bigint | null; currency: string | null;
  listingId: string | null; validFrom: Date | null; validTo: Date | null; maxRedemptions: number | null; redeemed: number; active: boolean; createdAt: Date;
}) => ({
  id: p.id,
  code: p.code,
  kind: p.kind,
  percentBps: p.percentBps,
  amountMinor: p.amountMinor === null ? null : p.amountMinor.toString(),
  currency: p.currency,
  listingId: p.listingId,
  validFrom: p.validFrom,
  validTo: p.validTo,
  maxRedemptions: p.maxRedemptions,
  redeemed: p.redeemed,
  active: p.active,
  createdAt: p.createdAt,
});
