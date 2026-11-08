import type { Currency } from './constants';

export type PromoRule =
  | { kind: 'PERCENT'; percentBps: number }
  | { kind: 'FIXED'; amountMinor: bigint; currency: Currency };

/**
 * Discount for a promo code. Never negative, never more than the total, integer minor units, and a
 * fixed-amount code only applies in its own currency. Percentages round down in the customer's
 * disfavour only by less than one minor unit.
 */
export function promoDiscountMinor(totalMinor: bigint, currency: Currency, rule: PromoRule): bigint {
  if (totalMinor <= 0n) return 0n;
  if (rule.kind === 'PERCENT') {
    if (!Number.isInteger(rule.percentBps) || rule.percentBps < 1 || rule.percentBps > 10_000) return 0n;
    return (totalMinor * BigInt(rule.percentBps)) / 10_000n;
  }
  if (rule.currency !== currency || rule.amountMinor <= 0n) return 0n;
  return rule.amountMinor < totalMinor ? rule.amountMinor : totalMinor;
}

export const PROMO_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;
export const normalizePromoCode = (raw: string) => raw.trim().toUpperCase();

/** How many promo codes a business may keep active, from its plan capabilities and add-ons (null = unlimited). */
export function promoCodeLimit(capabilities: readonly string[], hasMarketingAddOn: boolean): number | null {
  if (hasMarketingAddOn) return null;
  if (capabilities.includes('marketing.full') || capabilities.includes('marketing.campaigns')) return null;
  if (capabilities.includes('marketing.limited_campaigns') || capabilities.includes('marketing.basic')) return 3;
  return 0;
}
