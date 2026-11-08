import type { Currency } from './constants';

/** Money is held as integer minor units (bigint) - never floating point. */
export interface Money {
  readonly minor: bigint;
  readonly currency: Currency;
}

/** Decimal places per currency. LBP is treated as whole units. */
export const MINOR_DIGITS: Record<Currency, number> = { USD: 2, LBP: 0 };

export function money(minor: bigint | number, currency: Currency): Money {
  if (typeof minor === 'number' && !Number.isInteger(minor)) {
    throw new RangeError('Money minor units must be an integer');
  }
  return { minor: BigInt(minor), currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function subMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor - b.minor, currency: a.currency };
}

/** Apply a basis-point rate (e.g. 700 = 7%) with half-up rounding on non-negative amounts. */
export function applyBps(a: Money, bps: number): Money {
  if (!Number.isInteger(bps) || bps < 0) throw new RangeError('bps must be a non-negative integer');
  if (a.minor < 0n) throw new RangeError('applyBps requires a non-negative amount');
  return { minor: (a.minor * BigInt(bps) + 5000n) / 10000n, currency: a.currency };
}
