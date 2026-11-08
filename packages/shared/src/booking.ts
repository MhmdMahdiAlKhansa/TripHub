import type { Currency } from './constants';

// ---------------------------------------------------------------- state machines

export const BOOKING_STATUSES = ['REQUESTED', 'DECLINED', 'HELD', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'COMPLETED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * HELD means seats are reserved but nothing is confirmed (e.g. awaiting payment). It must never be
 * presented to a customer as a confirmed booking.
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  // Request-to-book: no seats are held while a request is pending (D-28); approval reserves them atomically.
  REQUESTED: ['HELD', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'EXPIRED'],
  DECLINED: [],
  HELD: ['CONFIRMED', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: ['CANCELLED', 'COMPLETED'],
  CANCELLED: [],
  // Reinstatement: a payment verified after the hold lapsed may revive the booking if seats are still free.
  EXPIRED: ['CONFIRMED'],
  COMPLETED: [],
};
export const canTransitionBooking = (from: BookingStatus, to: BookingStatus) =>
  BOOKING_TRANSITIONS[from]?.includes(to) ?? false;

export const HOLD_STATUSES = ['ACTIVE', 'CONSUMED', 'EXPIRED', 'RELEASED'] as const;
export type HoldStatus = (typeof HOLD_STATUSES)[number];
export const HOLD_TRANSITIONS: Record<HoldStatus, readonly HoldStatus[]> = {
  ACTIVE: ['CONSUMED', 'EXPIRED', 'RELEASED'],
  CONSUMED: [],
  EXPIRED: [],
  RELEASED: [],
};
export const canTransitionHold = (from: HoldStatus, to: HoldStatus) =>
  HOLD_TRANSITIONS[from]?.includes(to) ?? false;

/** Seats stay reserved for these bookings; cancelling/expiring one releases its seats. */
export const SEAT_HOLDING_STATUSES: readonly BookingStatus[] = ['HELD', 'CONFIRMED'];

// ---------------------------------------------------------------- pricing / quotes

export const RATE_KINDS = ['ADULT', 'CHILD', 'GROUP'] as const;
export type RateKind = (typeof RATE_KINDS)[number];

export interface RateInput {
  kind: RateKind;
  amountMinor: bigint;
  currency: Currency;
  /** Participants covered by one GROUP unit. */
  groupSize: number | null;
}
export interface LineRequest {
  kind: RateKind;
  qty: number;
}
export interface QuoteLine {
  kind: RateKind;
  unitMinor: bigint;
  qty: number;
  seats: number;
  subtotalMinor: bigint;
}
export interface Quote {
  currency: Currency;
  lines: QuoteLine[];
  seats: number;
  totalMinor: bigint;
  /** True when nothing is payable. */
  free: boolean;
}

export type QuoteErrorCode =
  | 'no_lines'
  | 'duplicate_line'
  | 'invalid_quantity'
  | 'unknown_rate'
  | 'mixed_currency'
  | 'too_many_seats';

export class QuoteError extends Error {
  constructor(
    public readonly code: QuoteErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_SEATS_PER_BOOKING = 20;

/**
 * The only place a booking total is calculated. Frontend totals are never trusted: the client sends
 * quantities only, and the server prices them from stored rates.
 */
export function computeQuote(
  rates: readonly RateInput[],
  requested: readonly LineRequest[],
  maxSeats = MAX_SEATS_PER_BOOKING,
): Quote {
  if (requested.length === 0) throw new QuoteError('no_lines', 'at least one line is required');
  const byKind = new Map(rates.map((r) => [r.kind, r]));
  const seen = new Set<RateKind>();
  const lines: QuoteLine[] = [];
  let currency: Currency | null = null;
  let seats = 0;
  let total = 0n;

  for (const req of requested) {
    if (seen.has(req.kind)) throw new QuoteError('duplicate_line', `duplicate line ${req.kind}`);
    seen.add(req.kind);
    if (!Number.isInteger(req.qty) || req.qty < 1) throw new QuoteError('invalid_quantity', 'quantity must be a positive integer');
    const rate = byKind.get(req.kind);
    if (!rate) throw new QuoteError('unknown_rate', `no ${req.kind} rate for this listing`);
    if (currency && rate.currency !== currency) throw new QuoteError('mixed_currency', 'rates use different currencies');
    currency = rate.currency;

    const lineSeats = rate.kind === 'GROUP' ? req.qty * (rate.groupSize ?? 1) : req.qty;
    const subtotal = rate.amountMinor * BigInt(req.qty);
    seats += lineSeats;
    total += subtotal;
    lines.push({ kind: rate.kind, unitMinor: rate.amountMinor, qty: req.qty, seats: lineSeats, subtotalMinor: subtotal });
  }
  if (seats > maxSeats) throw new QuoteError('too_many_seats', `at most ${maxSeats} participants per booking`);
  return { currency: currency as Currency, lines, seats, totalMinor: total, free: total === 0n };
}
