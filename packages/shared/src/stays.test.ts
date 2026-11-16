import { describe, expect, it } from 'vitest';
import { shiftDay, beirutInstant, beirutToday, isWeekendNight, nightsBetween, quoteStay, StayError } from './stays';

const pricing = { currency: 'USD' as const, nightMinor: 8000n, weekendNightMinor: 11000n, cleaningMinor: 2500n };
const rules = { minNights: 2, maxGuests: 4 };
const today = '2026-12-01'; // a Tuesday

describe('stay dates', () => {
  it('counts nights and adds days across month and year ends', () => {
    expect(nightsBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('treats Friday and Saturday nights as weekend nights', () => {
    expect(isWeekendNight('2026-12-04')).toBe(true); // Friday
    expect(isWeekendNight('2026-12-05')).toBe(true); // Saturday
    expect(isWeekendNight('2026-12-06')).toBe(false); // Sunday
  });
  it('converts Beirut wall-clock times to the right instant in winter and summer', () => {
    expect(beirutInstant('2026-12-24', '14:00').toISOString()).toBe('2026-12-24T12:00:00.000Z'); // UTC+2
    expect(beirutInstant('2026-07-15', '14:00').toISOString()).toBe('2026-07-15T11:00:00.000Z'); // UTC+3
    expect(beirutToday(new Date('2026-12-24T22:30:00Z'))).toBe('2026-12-25'); // already the 25th in Beirut
  });
  it('rejects impossible dates', () => {
    expect(() => nightsBetween('2026-02-30', '2026-03-02')).toThrow(StayError);
    expect(() => beirutInstant('2026-12-24', '25:00')).toThrow(StayError);
  });
});

describe('quoteStay', () => {
  it('prices weekday and weekend nights separately, plus the cleaning fee, in integers', () => {
    const q = quoteStay(pricing, rules, { checkIn: '2026-12-03', checkOut: '2026-12-06', guests: 2 }, today); // Thu, Fri, Sat nights
    expect(q).toMatchObject({ nights: 3, weekendNights: 2, nightsMinor: 30000n, cleaningMinor: 2500n, totalMinor: 32500n });
    expect(q.perNight.map((n) => n.minor)).toEqual([8000n, 11000n, 11000n]);
  });
  it('uses the normal price on weekends when no weekend price is set', () => {
    const q = quoteStay({ ...pricing, weekendNightMinor: null, cleaningMinor: null }, rules, { checkIn: '2026-12-04', checkOut: '2026-12-06', guests: 1 }, today);
    expect(q.totalMinor).toBe(16000n);
  });
  it.each([
    [{ checkIn: '2026-12-05', checkOut: '2026-12-05', guests: 2 }, 'check_out_before_check_in'],
    [{ checkIn: '2026-11-30', checkOut: '2026-12-03', guests: 2 }, 'check_in_in_past'],
    [{ checkIn: '2026-12-05', checkOut: '2026-12-06', guests: 2 }, 'below_min_nights'],
    [{ checkIn: '2026-12-05', checkOut: '2026-12-08', guests: 5 }, 'too_many_guests'],
    [{ checkIn: '2026-12-05', checkOut: '2027-01-10', guests: 2 }, 'too_many_nights'],
    [{ checkIn: '2028-01-05', checkOut: '2028-01-08', guests: 2 }, 'too_far_ahead'],
    [{ checkIn: '2026-12-05', checkOut: '2026-12-08', guests: 0 }, 'invalid_guests'],
  ])('refuses %j with %s', (req, code) => {
    try {
      quoteStay(pricing, rules, req, today);
      throw new Error('expected a StayError');
    } catch (e) {
      expect((e as StayError).code).toBe(code);
    }
  });
});
