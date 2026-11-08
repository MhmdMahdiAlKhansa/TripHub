import { describe, expect, it } from 'vitest';
import { CATEGORIES } from './constants';
import {
  ATTRIBUTE_SCHEMAS,
  canTransitionListing,
  LISTING_STATUSES,
  LISTING_TRANSITIONS,
  missingForPublish,
  validateAttributes,
} from './listing';

describe('listing state machine (exhaustive)', () => {
  const allowed = new Set(
    Object.entries(LISTING_TRANSITIONS).flatMap(([from, tos]) => tos.map((to) => `${from}->${to}`)),
  );
  for (const from of LISTING_STATUSES) {
    for (const to of LISTING_STATUSES) {
      const expected = allowed.has(`${from}->${to}`);
      it(`${from} -> ${to} is ${expected ? 'allowed' : 'denied'}`, () => {
        expect(canTransitionListing(from, to)).toBe(expected);
      });
    }
  }
  it('ARCHIVED is terminal and nothing transitions to itself', () => {
    expect(LISTING_TRANSITIONS.ARCHIVED).toEqual([]);
    for (const s of LISTING_STATUSES) expect(canTransitionListing(s, s)).toBe(false);
  });
  it('a draft cannot be paused (must be published first)', () => {
    expect(canTransitionListing('DRAFT', 'PAUSED')).toBe(false);
  });
});

describe('category attributes', () => {
  it('every category has a schema', () => {
    for (const c of CATEGORIES) expect(ATTRIBUTE_SCHEMAS[c]).toBeDefined();
  });
  it('accepts valid attributes and an empty object', () => {
    expect(validateAttributes('hiking', { difficulty: 'moderate', distanceKm: 12.5, guideIncluded: true }).success).toBe(true);
    expect(validateAttributes('museums', {}).success).toBe(true);
  });
  it('rejects attributes that belong to another category or are out of range', () => {
    expect(validateAttributes('hiking', { priceLevel: 2 }).success).toBe(false);
    expect(validateAttributes('hiking', { difficulty: 'extreme' }).success).toBe(false);
    expect(validateAttributes('restaurants', { priceLevel: 9 }).success).toBe(false);
    expect(validateAttributes('workshops', { maxParticipants: 0 }).success).toBe(false);
  });
});

describe('publish readiness', () => {
  const ok = {
    bookingMode: 'DISCOVERY_ONLY' as const,
    city: 'Beirut',
    meetingPoint: null,
    translations: [{ title: 'National Museum', description: 'x'.repeat(30) }],
  };
  it('passes when complete', () => expect(missingForPublish(ok)).toEqual([]));
  it('needs a titled, described translation in at least one locale', () => {
    expect(missingForPublish({ ...ok, translations: [] })).toEqual(['translation']);
    expect(missingForPublish({ ...ok, translations: [{ title: 'ab', description: 'x'.repeat(40) }] })).toEqual(['translation']);
    expect(missingForPublish({ ...ok, translations: [{ title: 'Good title', description: 'short' }] })).toEqual(['translation']);
  });
  it('bookable listings also need a meeting point', () => {
    expect(missingForPublish({ ...ok, bookingMode: 'FIXED_DATE' })).toEqual(['meetingPoint']);
    expect(missingForPublish({ ...ok, bookingMode: 'FIXED_DATE', meetingPoint: 'Car park' })).toEqual([]);
  });
});
