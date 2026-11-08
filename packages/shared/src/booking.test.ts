import { describe, expect, it } from 'vitest';
import {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  canTransitionBooking,
  canTransitionHold,
  computeQuote,
  HOLD_STATUSES,
  HOLD_TRANSITIONS,
  QuoteError,
  type RateInput,
} from './booking';

describe('booking state machine (exhaustive)', () => {
  const allowed = new Set(Object.entries(BOOKING_TRANSITIONS).flatMap(([f, ts]) => ts.map((t) => `${f}->${t}`)));
  for (const from of BOOKING_STATUSES) {
    for (const to of BOOKING_STATUSES) {
      const expected = allowed.has(`${from}->${to}`);
      it(`${from} -> ${to} is ${expected ? 'allowed' : 'denied'}`, () => {
        expect(canTransitionBooking(from, to)).toBe(expected);
      });
    }
  }
  it('terminal states have no exits (except EXPIRED -> CONFIRMED reinstatement) and a cancelled booking never revives', () => {
    for (const s of ['CANCELLED', 'COMPLETED'] as const) expect(BOOKING_TRANSITIONS[s]).toEqual([]);
    expect(BOOKING_TRANSITIONS.EXPIRED).toEqual(['CONFIRMED']);
    expect(canTransitionBooking('CANCELLED', 'CONFIRMED')).toBe(false);
  });
});

describe('hold state machine (exhaustive)', () => {
  for (const from of HOLD_STATUSES) {
    for (const to of HOLD_STATUSES) {
      const expected = HOLD_TRANSITIONS[from].includes(to);
      it(`${from} -> ${to} is ${expected ? 'allowed' : 'denied'}`, () => {
        expect(canTransitionHold(from, to)).toBe(expected);
      });
    }
  }
});

const rates: RateInput[] = [
  { kind: 'ADULT', amountMinor: 2500n, currency: 'USD', groupSize: null },
  { kind: 'CHILD', amountMinor: 1200n, currency: 'USD', groupSize: null },
  { kind: 'GROUP', amountMinor: 9000n, currency: 'USD', groupSize: 4 },
];

describe('computeQuote', () => {
  it('prices per person lines and sums exactly', () => {
    const q = computeQuote(rates, [{ kind: 'ADULT', qty: 2 }, { kind: 'CHILD', qty: 1 }]);
    expect(q.totalMinor).toBe(2n * 2500n + 1200n);
    expect(q.seats).toBe(3);
    expect(q.currency).toBe('USD');
    expect(q.free).toBe(false);
  });
  it('a GROUP unit covers groupSize seats at one flat price', () => {
    const q = computeQuote(rates, [{ kind: 'GROUP', qty: 2 }]);
    expect(q.seats).toBe(8);
    expect(q.totalMinor).toBe(18000n);
  });
  it('free rates produce a free quote', () => {
    const q = computeQuote([{ kind: 'ADULT', amountMinor: 0n, currency: 'LBP', groupSize: null }], [{ kind: 'ADULT', qty: 3 }]);
    expect(q.free).toBe(true);
    expect(q.totalMinor).toBe(0n);
  });
  it('is exact for very large LBP amounts (no floating point)', () => {
    const q = computeQuote([{ kind: 'ADULT', amountMinor: 4_500_000_000_001n, currency: 'LBP', groupSize: null }], [{ kind: 'ADULT', qty: 7 }]);
    expect(q.totalMinor).toBe(31_500_000_000_007n);
  });
  const fails = (fn: () => unknown, code: string) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(QuoteError);
      expect((e as QuoteError).code).toBe(code);
      return;
    }
    throw new Error('expected QuoteError ' + code);
  };
  it('rejects bad input', () => {
    fails(() => computeQuote(rates, []), 'no_lines');
    fails(() => computeQuote(rates, [{ kind: 'ADULT', qty: 0 }]), 'invalid_quantity');
    fails(() => computeQuote(rates, [{ kind: 'ADULT', qty: 1.5 }]), 'invalid_quantity');
    fails(() => computeQuote(rates, [{ kind: 'ADULT', qty: -1 }]), 'invalid_quantity');
    fails(() => computeQuote(rates, [{ kind: 'ADULT', qty: 1 }, { kind: 'ADULT', qty: 1 }]), 'duplicate_line');
    fails(() => computeQuote([rates[0]!], [{ kind: 'CHILD', qty: 1 }]), 'unknown_rate');
    fails(() => computeQuote(rates, [{ kind: 'ADULT', qty: 21 }]), 'too_many_seats');
    fails(() => computeQuote(rates, [{ kind: 'GROUP', qty: 6 }]), 'too_many_seats'); // 24 seats
    fails(
      () => computeQuote([rates[0]!, { kind: 'CHILD', amountMinor: 1n, currency: 'LBP', groupSize: null }], [{ kind: 'ADULT', qty: 1 }, { kind: 'CHILD', qty: 1 }]),
      'mixed_currency',
    );
  });
  it('property: total always equals the sum of unit*qty over random valid requests', () => {
    let seed = 12345;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let i = 0; i < 500; i++) {
      const a = rnd(6);
      const c = rnd(6);
      const lines = [
        ...(a ? [{ kind: 'ADULT' as const, qty: a }] : []),
        ...(c ? [{ kind: 'CHILD' as const, qty: c }] : []),
      ];
      if (!lines.length) continue;
      const q = computeQuote(rates, lines);
      expect(q.totalMinor).toBe(BigInt(a) * 2500n + BigInt(c) * 1200n);
      expect(q.lines.reduce((s, l) => s + l.subtotalMinor, 0n)).toBe(q.totalMinor);
      expect(q.seats).toBe(a + c);
    }
  });
});
