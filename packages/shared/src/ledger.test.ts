import { describe, expect, it } from 'vitest';
import { allocatedPaymentPostings, splitPayment, sumLines, unallocatedPaymentPostings } from './ledger';

describe('splitPayment', () => {
  it('splits exactly and rounds the commission half-up', () => {
    expect(splitPayment(10_000n, 1000)).toEqual({ commissionMinor: 1000n, payableMinor: 9000n });
    expect(splitPayment(105n, 1000)).toEqual({ commissionMinor: 11n, payableMinor: 94n }); // 10.5 -> 11
    expect(splitPayment(104n, 1000)).toEqual({ commissionMinor: 10n, payableMinor: 94n });
  });
  it('handles the extremes', () => {
    expect(splitPayment(500n, 0)).toEqual({ commissionMinor: 0n, payableMinor: 500n });
    expect(splitPayment(500n, 10_000)).toEqual({ commissionMinor: 500n, payableMinor: 0n });
    expect(splitPayment(0n, 700)).toEqual({ commissionMinor: 0n, payableMinor: 0n });
  });
  it('rejects invalid input', () => {
    expect(() => splitPayment(-1n, 100)).toThrow();
    expect(() => splitPayment(100n, -1)).toThrow();
    expect(() => splitPayment(100n, 10_001)).toThrow();
    expect(() => splitPayment(100n, 12.5)).toThrow();
  });
  it('property: parts always add up to the total and the commission never exceeds it', () => {
    let seed = 99;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let i = 0; i < 2000; i++) {
      const total = BigInt(rnd(1_000_000)) * BigInt(rnd(1_000_000) + 1);
      const bps = rnd(10_001);
      const { commissionMinor, payableMinor } = splitPayment(total, bps);
      expect(commissionMinor + payableMinor).toBe(total);
      expect(commissionMinor).toBeGreaterThanOrEqual(0n);
      expect(payableMinor).toBeGreaterThanOrEqual(0n);
    }
  });
});

describe('postings always balance', () => {
  it('allocated payments sum to zero for any commission', () => {
    for (const bps of [0, 1, 400, 700, 1000, 9999, 10_000]) {
      for (const total of [1n, 7n, 105n, 2500n, 123_456_789n]) {
        const lines = allocatedPaymentPostings(total, bps);
        expect(sumLines(lines)).toBe(0n);
        expect(lines.every((l) => l.amountMinor !== 0n)).toBe(true); // DB forbids zero lines
        expect(lines.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
  it('unallocated payments sum to zero and owe the customer the full amount', () => {
    const lines = unallocatedPaymentPostings(2500n);
    expect(sumLines(lines)).toBe(0n);
    expect(lines.find((l) => l.account === 'REFUND_PAYABLE')?.amountMinor).toBe(-2500n);
  });
});

import { refundApprovalPostings, refundPaidPostings } from './ledger';
describe('refund postings', () => {
  it('approval exactly reverses the original split and balances', () => {
    for (const total of [1n, 999n, 5000n, 123457n]) {
      for (const bps of [0, 1000, 1234, 10000]) {
        const orig = allocatedPaymentPostings(total, bps);
        const rev = refundApprovalPostings(total, bps);
        expect(sumLines(rev)).toBe(0n);
        for (const l of orig.filter((x) => x.account !== 'PLATFORM_CASH')) {
          expect(rev.find((r) => r.account === l.account)?.amountMinor).toBe(-l.amountMinor);
        }
      }
    }
  });
  it('payout settles the liability against cash', () => {
    expect(sumLines(refundPaidPostings(700n))).toBe(0n);
  });
});
