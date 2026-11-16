import type { Currency } from './constants';

/**
 * Nightly stays at a property (chalet, guesthouse, cabin). A stay is booked as a range of nights:
 * check-in date (first night) to check-out date (morning after the last night). Dates are calendar
 * dates in Lebanon (Asia/Beirut); times of day come from the property's check-in / check-out times.
 */

export const STAY_RATE_KINDS = ['NIGHT', 'WEEKEND_NIGHT', 'CLEANING'] as const;
export type StayRateKind = (typeof STAY_RATE_KINDS)[number];
export const PROPERTY_TYPES = ['chalet', 'guesthouse', 'cabin', 'villa', 'apartment', 'room', 'campsite'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export const AMENITIES = [
  'wifi', 'parking', 'heating', 'fireplace', 'air_conditioning', 'kitchen', 'bbq', 'garden', 'pool',
  'mountain_view', 'sea_view', 'hot_water_24h', 'generator', 'pets_allowed', 'breakfast', 'hiking_trail_access',
] as const;
export type Amenity = (typeof AMENITIES)[number];

/** Longest stay we accept in one booking. */
export const MAX_STAY_NIGHTS = 30;
/** How far ahead a stay can be booked. */
export const MAX_STAY_AHEAD_DAYS = 365;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DAY = 86_400_000;
/** Parses YYYY-MM-DD as a calendar day (UTC midnight, used only for day arithmetic). */
export function parseDay(d: string): Date {
  if (!DATE_RE.test(d)) throw new StayError('invalid_date', `invalid date ${d}`);
  const t = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) throw new StayError('invalid_date', `invalid date ${d}`);
  return new Date(t);
}
export const formatDay = (d: Date) => d.toISOString().slice(0, 10);
export const shiftDay = (d: string, n: number) => formatDay(new Date(parseDay(d).getTime() + n * DAY));
export const nightsBetween = (checkIn: string, checkOut: string) => Math.round((parseDay(checkOut).getTime() - parseDay(checkIn).getTime()) / DAY);

/** Offset of Asia/Beirut from UTC (minutes) at a given instant; Lebanon switches between UTC+2 and UTC+3. */
function beirutOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Beirut', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}
/** The instant a Beirut wall-clock date and time ("2026-12-24", "14:00") refers to. */
export function beirutInstant(day: string, time: string): Date {
  if (!TIME_RE.test(time)) throw new StayError('invalid_time', `invalid time ${time}`);
  const [h, m] = time.split(':').map(Number) as [number, number];
  const naive = parseDay(day).getTime() + (h * 60 + m) * 60_000;
  // Two passes handle the hour around a daylight-saving change.
  let guess = naive - beirutOffsetMinutes(new Date(naive)) * 60_000;
  guess = naive - beirutOffsetMinutes(new Date(guess)) * 60_000;
  return new Date(guess);
}
/** Today's date in Beirut. */
export const beirutToday = (now = new Date()) => formatDay(new Date(now.getTime() + beirutOffsetMinutes(now) * 60_000));

/** Friday and Saturday nights are weekend nights in Lebanon (the night that starts on that day). */
export const isWeekendNight = (day: string) => {
  const dow = parseDay(day).getUTCDay();
  return dow === 5 || dow === 6;
};

export class StayError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

export interface StayPricing {
  currency: Currency;
  nightMinor: bigint;
  weekendNightMinor: bigint | null;
  cleaningMinor: bigint | null;
}
export interface StayRules {
  minNights: number;
  maxGuests: number;
}
export interface StayQuote {
  nights: number;
  weekendNights: number;
  currency: Currency;
  nightsMinor: bigint;
  cleaningMinor: bigint;
  totalMinor: bigint;
  /** One entry per night, in order. */
  perNight: Array<{ date: string; minor: bigint; weekend: boolean }>;
}

/** Pure, integer-only stay pricing. Throws StayError with a stable code for any rule the request breaks. */
export function quoteStay(p: StayPricing, rules: StayRules, req: { checkIn: string; checkOut: string; guests: number }, today: string): StayQuote {
  const nights = nightsBetween(req.checkIn, req.checkOut);
  if (nights < 1) throw new StayError('check_out_before_check_in', 'check-out must be after check-in');
  if (req.checkIn < today) throw new StayError('check_in_in_past', 'check-in is in the past');
  if (nightsBetween(today, req.checkIn) > MAX_STAY_AHEAD_DAYS) throw new StayError('too_far_ahead', `bookable up to ${MAX_STAY_AHEAD_DAYS} days ahead`);
  if (nights > MAX_STAY_NIGHTS) throw new StayError('too_many_nights', `at most ${MAX_STAY_NIGHTS} nights`);
  if (nights < rules.minNights) throw new StayError('below_min_nights', `minimum ${rules.minNights} nights`);
  if (!Number.isInteger(req.guests) || req.guests < 1) throw new StayError('invalid_guests', 'at least one guest');
  if (req.guests > rules.maxGuests) throw new StayError('too_many_guests', `sleeps at most ${rules.maxGuests}`);
  const perNight: StayQuote['perNight'] = [];
  for (let i = 0; i < nights; i++) {
    const date = shiftDay(req.checkIn, i);
    const weekend = isWeekendNight(date);
    perNight.push({ date, weekend, minor: weekend && p.weekendNightMinor !== null ? p.weekendNightMinor : p.nightMinor });
  }
  const nightsMinor = perNight.reduce((s, n) => s + n.minor, 0n);
  const cleaningMinor = p.cleaningMinor ?? 0n;
  return { nights, weekendNights: perNight.filter((n) => n.weekend).length, currency: p.currency, nightsMinor, cleaningMinor, totalMinor: nightsMinor + cleaningMinor, perNight };
}
