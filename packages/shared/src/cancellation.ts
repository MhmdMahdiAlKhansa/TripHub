/**
 * Cancellation policies. The DEFAULT percentages are initial product assumptions awaiting owner
 * confirmation (see docs/DECISIONS.md D-31); a booking snapshots the policy code at purchase time so
 * later changes never alter what a customer agreed to.
 */
export const CANCELLATION_POLICIES = ['FLEXIBLE', 'MODERATE', 'STRICT', 'NON_REFUNDABLE'] as const;
export type CancellationPolicy = (typeof CANCELLATION_POLICIES)[number];

interface Tier {
  /** Applies when the customer cancels at least this many hours before the start. */
  minHoursBefore: number;
  /** Share of the paid amount that is refundable, in basis points. */
  refundBps: number;
}

/** Tiers are checked from the most generous down; below the last tier nothing is refundable. */
export const POLICY_TIERS: Record<CancellationPolicy, readonly Tier[]> = {
  FLEXIBLE: [{ minHoursBefore: 24, refundBps: 10_000 }],
  MODERATE: [
    { minHoursBefore: 72, refundBps: 10_000 },
    { minHoursBefore: 24, refundBps: 5_000 },
  ],
  STRICT: [
    { minHoursBefore: 168, refundBps: 5_000 },
  ],
  NON_REFUNDABLE: [],
};

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = 'MODERATE';

export function refundBpsFor(policy: CancellationPolicy, hoursBeforeStart: number): number {
  for (const t of POLICY_TIERS[policy]) if (hoursBeforeStart >= t.minHoursBefore) return t.refundBps;
  return 0;
}

/**
 * Amount refundable to the customer when THEY cancel. A cancellation by the business is always a
 * full refund, so callers pass `by: 'BUSINESS'`.
 */
export function refundableMinor(input: {
  paidMinor: bigint;
  policy: CancellationPolicy;
  startsAt: Date;
  cancelledAt: Date;
  by: 'CUSTOMER' | 'BUSINESS';
}): bigint {
  if (input.paidMinor <= 0n) return 0n;
  if (input.by === 'BUSINESS') return input.paidMinor;
  const hours = (input.startsAt.getTime() - input.cancelledAt.getTime()) / 3_600_000;
  const bps = refundBpsFor(input.policy, hours);
  return (input.paidMinor * BigInt(bps)) / 10_000n; // floor: never refund more than the policy allows
}
