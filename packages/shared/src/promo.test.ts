import { describe, expect, it } from 'vitest';
import { normalizePromoCode, PROMO_CODE_RE, promoCodeLimit, promoDiscountMinor } from './promo';

describe('promo discount', () => {
  it('percent rounds down and never exceeds the total', () => {
    expect(promoDiscountMinor(5000n, 'USD', { kind: 'PERCENT', percentBps: 1000 })).toBe(500n);
    expect(promoDiscountMinor(999n, 'USD', { kind: 'PERCENT', percentBps: 3333 })).toBe(332n);
    expect(promoDiscountMinor(5000n, 'USD', { kind: 'PERCENT', percentBps: 10_000 })).toBe(5000n);
    expect(promoDiscountMinor(5000n, 'USD', { kind: 'PERCENT', percentBps: 10_001 })).toBe(0n);
    expect(promoDiscountMinor(5000n, 'USD', { kind: 'PERCENT', percentBps: 0 })).toBe(0n);
  });
  it('fixed amounts are capped at the total and only apply in their own currency', () => {
    expect(promoDiscountMinor(5000n, 'USD', { kind: 'FIXED', amountMinor: 700n, currency: 'USD' })).toBe(700n);
    expect(promoDiscountMinor(500n, 'USD', { kind: 'FIXED', amountMinor: 700n, currency: 'USD' })).toBe(500n);
    expect(promoDiscountMinor(5000n, 'LBP', { kind: 'FIXED', amountMinor: 700n, currency: 'USD' })).toBe(0n);
    expect(promoDiscountMinor(0n, 'USD', { kind: 'PERCENT', percentBps: 5000 })).toBe(0n);
  });
  it('codes are normalised and validated', () => {
    expect(normalizePromoCode(' summer-10 ')).toBe('SUMMER-10');
    expect(PROMO_CODE_RE.test('SUMMER-10')).toBe(true);
    expect(PROMO_CODE_RE.test('a')).toBe(false);
    expect(PROMO_CODE_RE.test('HAS SPACE')).toBe(false);
  });
  it('limits follow the plan and the marketing add-on', () => {
    expect(promoCodeLimit(['marketing.limited_campaigns'], false)).toBe(3);
    expect(promoCodeLimit(['marketing.basic'], false)).toBe(3);
    expect(promoCodeLimit(['marketing.campaigns'], false)).toBeNull();
    expect(promoCodeLimit(['marketing.basic'], true)).toBeNull();
    expect(promoCodeLimit([], false)).toBe(0);
  });
});
