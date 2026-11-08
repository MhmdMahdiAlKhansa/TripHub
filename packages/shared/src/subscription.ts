/**
 * Plans, add-ons and the subscription lifecycle (pure rules; the API persists and enforces them).
 * Prices here are the INITIAL defaults. Live prices are effective-dated rows in the database and a
 * subscription snapshots the price and commission it was sold at, so later changes never alter it.
 */
export const PLAN_CODES = ['TRIAL', 'STARTER', 'GROWTH', 'PRO', 'ENTERPRISE'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export interface PlanDef {
  name: string;
  /** null = unlimited (subject to fair use). */
  listingLimit: number | null;
  teamLimit: number | null;
  defaultMonthlyMinor: bigint | null; // USD cents; null = negotiated
  defaultCommissionBps: number | null; // null = negotiated
  capabilities: readonly string[];
}

export const PLANS: Record<PlanCode, PlanDef> = {
  TRIAL: {
    name: 'Free Trial',
    listingLimit: 10,
    teamLimit: 3,
    defaultMonthlyMinor: 0n,
    defaultCommissionBps: 1000,
    capabilities: ['analytics.advanced', 'ai.trial_credits', 'marketing.limited_campaigns', 'onboarding.guided'],
  },
  STARTER: {
    name: 'Starter',
    listingLimit: 5,
    teamLimit: 2,
    defaultMonthlyMinor: 1900n,
    defaultCommissionBps: 1000,
    capabilities: ['analytics.basic', 'marketing.basic', 'ai.limited'],
  },
  GROWTH: {
    name: 'Growth',
    listingLimit: 25,
    teamLimit: 10,
    defaultMonthlyMinor: 4900n,
    defaultCommissionBps: 700,
    capabilities: ['analytics.advanced', 'marketing.campaigns', 'ai.standard'],
  },
  PRO: {
    name: 'Pro',
    listingLimit: null,
    teamLimit: null,
    defaultMonthlyMinor: 9900n,
    defaultCommissionBps: 400,
    capabilities: ['analytics.full', 'marketing.full', 'ai.advanced'],
  },
  ENTERPRISE: {
    name: 'Enterprise',
    listingLimit: null,
    teamLimit: null,
    defaultMonthlyMinor: null,
    defaultCommissionBps: null,
    capabilities: ['negotiated'],
  },
};

export const TRIAL_DAYS = 30;
export const TRIAL_ACTIVATION_WINDOW_DAYS = 14;
export const GRACE_DAYS = 7;
/** Initial configurable value, pending business confirmation: not an existing commitment. */
export const DEFAULT_ANNUAL_DISCOUNT_BPS = 1500;

export const ADD_ON_KINDS = ['EXTRA_LISTING_PACK', 'EXTRA_TEAM_MEMBER', 'MARKETING'] as const;
export type AddOnKind = (typeof ADD_ON_KINDS)[number];
export const ADD_ON_DEFS: Record<AddOnKind, { monthlyMinor: bigint; listings?: number; members?: number }> = {
  EXTRA_LISTING_PACK: { monthlyMinor: 500n, listings: 5 }, // 5 extra active listings
  EXTRA_TEAM_MEMBER: { monthlyMinor: 400n, members: 1 },
  MARKETING: { monthlyMinor: 1200n },
};
export type AddOns = Partial<Record<AddOnKind, number>>;

export const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

const DAY = 86_400_000;
export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

/** Adds calendar months in UTC, clamping to the end of shorter months (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}

/** Last day a business may still activate its trial. */
export const trialActivationDeadline = (approvedAt: Date) => addDays(approvedAt, TRIAL_ACTIVATION_WINDOW_DAYS);

export type Cycle = 'MONTHLY' | 'ANNUAL';

export function addOnMonthlyMinor(addOns: AddOns): bigint {
  let total = 0n;
  for (const kind of ADD_ON_KINDS) {
    const q = addOns[kind] ?? 0;
    if (!Number.isInteger(q) || q < 0 || q > 100) throw new RangeError(`invalid quantity for ${kind}`);
    total += ADD_ON_DEFS[kind].monthlyMinor * BigInt(q);
  }
  return total;
}

/** Amount for one billing cycle, integer minor units, annual discount rounded half-up. */
export function cycleAmountMinor(monthlyMinor: bigint, addOnsMonthlyMinor: bigint, cycle: Cycle, annualDiscountBps = DEFAULT_ANNUAL_DISCOUNT_BPS): bigint {
  const monthly = monthlyMinor + addOnsMonthlyMinor;
  if (cycle === 'MONTHLY') return monthly;
  const gross = monthly * 12n;
  return (gross * BigInt(10_000 - annualDiscountBps) + 5000n) / 10_000n;
}

export interface SubscriptionState {
  planCode: PlanCode;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  addOns: AddOns;
}

export interface Entitlements {
  /** The real, date-derived status (the stored one is only a hint refreshed by the worker). */
  status: SubscriptionStatus;
  canPublish: boolean;
  canAcceptNewBookings: boolean;
  /** Existing bookings and data always stay manageable, whatever the status. */
  canManageExisting: true;
  listingLimit: number | null;
  teamLimit: number | null;
  graceEndsAt: Date | null;
}

export function limitsFor(planCode: PlanCode, addOns: AddOns) {
  const plan = PLANS[planCode];
  const extraListings = (addOns.EXTRA_LISTING_PACK ?? 0) * (ADD_ON_DEFS.EXTRA_LISTING_PACK.listings ?? 0);
  const extraMembers = (addOns.EXTRA_TEAM_MEMBER ?? 0) * (ADD_ON_DEFS.EXTRA_TEAM_MEMBER.members ?? 0);
  return {
    listingLimit: plan.listingLimit === null ? null : plan.listingLimit + extraListings,
    teamLimit: plan.teamLimit === null ? null : plan.teamLimit + extraMembers,
  };
}

/** Derives what a business may do right now. Pure: the same inputs always give the same answer. */
export function entitlementsFor(s: SubscriptionState | null, now: Date): Entitlements {
  const none = (status: SubscriptionStatus, grace: Date | null = null): Entitlements => ({
    status,
    canPublish: false,
    canAcceptNewBookings: false,
    canManageExisting: true,
    listingLimit: s ? limitsFor(s.planCode, s.addOns).listingLimit : 0,
    teamLimit: s ? limitsFor(s.planCode, s.addOns).teamLimit : 0,
    graceEndsAt: grace,
  });
  const entitled = (status: SubscriptionStatus, grace: Date | null = null): Entitlements => ({
    ...none(status, grace),
    canPublish: true,
    canAcceptNewBookings: true,
  });

  if (!s) return { ...none('EXPIRED'), listingLimit: 0, teamLimit: 0 };

  switch (s.status) {
    case 'TRIALING':
      return s.trialEndsAt && now < s.trialEndsAt ? entitled('TRIALING') : none('EXPIRED');
    case 'EXPIRED':
    case 'CANCELLED':
      return none(s.status);
    case 'ACTIVE':
    case 'PAST_DUE':
    case 'SUSPENDED': {
      const end = s.currentPeriodEnd;
      if (!end) return none('SUSPENDED');
      if (now < end) return entitled('ACTIVE');
      if (s.cancelAtPeriodEnd) return none('CANCELLED');
      const graceEnd = addDays(end, GRACE_DAYS);
      // Overdue: grace keeps selling for 7 days; after that new bookings stop but nothing is deleted.
      return now < graceEnd ? entitled('PAST_DUE', graceEnd) : none('SUSPENDED', graceEnd);
    }
  }
}

/** Who may sell which plan without an explicit negotiated price. */
export const SELF_SERVE_PLANS: readonly PlanCode[] = ['STARTER', 'GROWTH', 'PRO'];
