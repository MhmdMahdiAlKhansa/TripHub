import { describe, expect, it } from 'vitest';
import {
  ADD_ON_KINDS,
  addMonths,
  addOnMonthlyMinor,
  cycleAmountMinor,
  entitlementsFor,
  limitsFor,
  trialActivationDeadline,
  type SubscriptionState,
} from './subscription';

const d = (s: string) => new Date(s);
const base: SubscriptionState = {
  planCode: 'GROWTH',
  status: 'ACTIVE',
  trialEndsAt: null,
  currentPeriodEnd: d('2027-01-31T00:00:00Z'),
  cancelAtPeriodEnd: false,
  addOns: {},
};

describe('billing arithmetic', () => {
  it('adds calendar months and clamps short months', () => {
    expect(addMonths(d('2027-01-31T10:00:00Z'), 1).toISOString()).toBe('2027-02-28T10:00:00.000Z');
    expect(addMonths(d('2028-01-31T10:00:00Z'), 1).toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addMonths(d('2027-11-15T00:00:00Z'), 3).toISOString()).toBe('2028-02-15T00:00:00.000Z');
  });

  it('prices add-ons and the annual discount in integer minor units', () => {
    expect(addOnMonthlyMinor({ EXTRA_LISTING_PACK: 2, EXTRA_TEAM_MEMBER: 3, MARKETING: 1 })).toBe(1000n + 1200n + 1200n);
    expect(cycleAmountMinor(4900n, 0n, 'MONTHLY')).toBe(4900n);
    // 4900 * 12 = 58800, 15% off = 49980
    expect(cycleAmountMinor(4900n, 0n, 'ANNUAL')).toBe(49980n);
    expect(() => addOnMonthlyMinor({ MARKETING: -1 })).toThrow();
    expect(() => addOnMonthlyMinor({ MARKETING: 1.5 })).toThrow();
    for (const k of ADD_ON_KINDS) expect(addOnMonthlyMinor({ [k]: 1 })).toBeGreaterThan(0n);
  });

  it('trial activation closes 14 days after approval', () => {
    expect(trialActivationDeadline(d('2027-03-01T00:00:00Z')).toISOString()).toBe('2027-03-15T00:00:00.000Z');
  });
});

describe('limits', () => {
  it('adds add-on capacity to the plan; unlimited stays unlimited', () => {
    expect(limitsFor('STARTER', { EXTRA_LISTING_PACK: 2, EXTRA_TEAM_MEMBER: 1 })).toEqual({ listingLimit: 15, teamLimit: 3 });
    expect(limitsFor('PRO', { EXTRA_LISTING_PACK: 4 })).toEqual({ listingLimit: null, teamLimit: null });
  });
});

describe('entitlements', () => {
  it('has none without a subscription, but existing data stays manageable', () => {
    const e = entitlementsFor(null, d('2027-01-01T00:00:00Z'));
    expect(e).toMatchObject({ canPublish: false, canAcceptNewBookings: false, canManageExisting: true });
  });

  it('a trial is entitled until it ends and never converts by itself', () => {
    const t: SubscriptionState = { ...base, planCode: 'TRIAL', status: 'TRIALING', trialEndsAt: d('2027-02-01T00:00:00Z'), currentPeriodEnd: null };
    expect(entitlementsFor(t, d('2027-01-31T23:59:59Z'))).toMatchObject({ status: 'TRIALING', canAcceptNewBookings: true });
    expect(entitlementsFor(t, d('2027-02-01T00:00:00Z'))).toMatchObject({ status: 'EXPIRED', canAcceptNewBookings: false, canPublish: false });
  });

  it('paid: active, then 7-day grace that still sells, then suspended for new bookings only', () => {
    expect(entitlementsFor(base, d('2027-01-30T00:00:00Z')).status).toBe('ACTIVE');
    const grace = entitlementsFor(base, d('2027-02-05T00:00:00Z'));
    expect(grace).toMatchObject({ status: 'PAST_DUE', canAcceptNewBookings: true });
    expect(grace.graceEndsAt?.toISOString()).toBe('2027-02-07T00:00:00.000Z');
    const sus = entitlementsFor(base, d('2027-02-07T00:00:00Z'));
    expect(sus).toMatchObject({ status: 'SUSPENDED', canAcceptNewBookings: false, canPublish: false, canManageExisting: true });
  });

  it('a stored PAST_DUE/SUSPENDED status is overridden by a renewed period', () => {
    const renewed: SubscriptionState = { ...base, status: 'SUSPENDED', currentPeriodEnd: d('2027-03-31T00:00:00Z') };
    expect(entitlementsFor(renewed, d('2027-02-20T00:00:00Z')).status).toBe('ACTIVE');
  });

  it('cancellation at period end keeps access until then, then stops without any grace', () => {
    const c: SubscriptionState = { ...base, cancelAtPeriodEnd: true };
    expect(entitlementsFor(c, d('2027-01-30T00:00:00Z')).canAcceptNewBookings).toBe(true);
    expect(entitlementsFor(c, d('2027-02-01T00:00:00Z'))).toMatchObject({ status: 'CANCELLED', canAcceptNewBookings: false });
  });

  it('expired and cancelled states never sell', () => {
    for (const status of ['EXPIRED', 'CANCELLED'] as const) {
      expect(entitlementsFor({ ...base, status }, d('2027-01-01T00:00:00Z')).canAcceptNewBookings).toBe(false);
    }
  });
});
