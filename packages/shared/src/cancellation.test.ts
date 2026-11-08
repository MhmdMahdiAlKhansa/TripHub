import { describe, expect, it } from 'vitest';
import { refundableMinor, refundBpsFor, type CancellationPolicy } from './cancellation';

const start = new Date('2027-06-10T09:00:00Z');
const before = (h: number) => new Date(start.getTime() - h * 3_600_000);
const refund = (policy: CancellationPolicy, hours: number, by: 'CUSTOMER' | 'BUSINESS' = 'CUSTOMER', paid = 10_001n) =>
  refundableMinor({ paidMinor: paid, policy, startsAt: start, cancelledAt: before(hours), by });

describe('cancellation policies', () => {
  it('flexible: full refund until 24 h before', () => {
    expect(refund('FLEXIBLE', 24)).toBe(10_001n);
    expect(refund('FLEXIBLE', 23.9)).toBe(0n);
  });
  it('moderate: full >= 72 h, half >= 24 h, then nothing', () => {
    expect(refund('MODERATE', 100)).toBe(10_001n);
    expect(refund('MODERATE', 72)).toBe(10_001n);
    expect(refund('MODERATE', 71.9)).toBe(5_000n); // floor of half, never more than allowed
    expect(refund('MODERATE', 24)).toBe(5_000n);
    expect(refund('MODERATE', 2)).toBe(0n);
  });
  it('strict: half only a week or more ahead', () => {
    expect(refund('STRICT', 168)).toBe(5_000n);
    expect(refund('STRICT', 167)).toBe(0n);
  });
  it('non-refundable never refunds a customer cancellation', () => {
    expect(refund('NON_REFUNDABLE', 1000)).toBe(0n);
  });
  it('a business cancellation is always a full refund, whatever the policy or timing', () => {
    for (const p of ['FLEXIBLE', 'MODERATE', 'STRICT', 'NON_REFUNDABLE'] as const) {
      expect(refund(p, 0.5, 'BUSINESS')).toBe(10_001n);
    }
  });
  it('cancelling after the start is never refundable by policy; nothing paid means nothing to refund', () => {
    expect(refund('FLEXIBLE', -3)).toBe(0n);
    expect(refund('FLEXIBLE', 100, 'CUSTOMER', 0n)).toBe(0n);
    expect(refundBpsFor('MODERATE', 1e6)).toBe(10_000);
  });
});
