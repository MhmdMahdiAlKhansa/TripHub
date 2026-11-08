import { z } from 'zod';
import type { Category } from './constants';

// ---------------------------------------------------------------- lifecycle

export const LISTING_STATUSES = ['DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** Allowed transitions. Anything not listed is rejected. ARCHIVED is terminal. */
export const LISTING_TRANSITIONS: Record<ListingStatus, readonly ListingStatus[]> = {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['PAUSED', 'ARCHIVED'],
  PAUSED: ['PUBLISHED', 'ARCHIVED'],
  ARCHIVED: [],
};

export const canTransitionListing = (from: ListingStatus, to: ListingStatus): boolean =>
  LISTING_TRANSITIONS[from]?.includes(to) ?? false;

export const BOOKING_MODES = ['DISCOVERY_ONLY', 'FIXED_DATE', 'TIME_SLOT', 'REQUEST_TO_BOOK'] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

// ---------------------------------------------------------------- category-specific attributes

const str = (max = 120) => z.string().trim().min(1).max(max);

/** Strict per-category attribute schemas ("smart forms" enforced server-side). */
export const ATTRIBUTE_SCHEMAS: Record<Category, z.ZodType<Record<string, unknown>>> = {
  hiking: z
    .object({
      difficulty: z.enum(['easy', 'moderate', 'hard']),
      durationMinutes: z.number().int().min(15).max(7 * 24 * 60),
      distanceKm: z.number().min(0.1).max(500),
      elevationGainM: z.number().int().min(0).max(9000),
      guideIncluded: z.boolean(),
    })
    .partial()
    .strict(),
  tours: z
    .object({
      durationMinutes: z.number().int().min(15).max(7 * 24 * 60),
      tourLanguages: z.array(z.enum(['en', 'ar', 'fr'])).max(3),
      maxGroupSize: z.number().int().min(1).max(200),
      transportIncluded: z.boolean(),
    })
    .partial()
    .strict(),
  restaurants: z
    .object({
      cuisines: z.array(str(40)).max(8),
      priceLevel: z.number().int().min(1).max(4),
      reservationsRecommended: z.boolean(),
      outdoorSeating: z.boolean(),
    })
    .partial()
    .strict(),
  museums: z
    .object({
      openingNote: str(200),
      wheelchairAccessible: z.boolean(),
      guidedVisitsAvailable: z.boolean(),
    })
    .partial()
    .strict(),
  workshops: z
    .object({
      durationMinutes: z.number().int().min(15).max(24 * 60),
      skillLevel: z.enum(['beginner', 'intermediate', 'advanced']),
      materialsIncluded: z.boolean(),
      maxParticipants: z.number().int().min(1).max(200),
    })
    .partial()
    .strict(),
  historical: z
    .object({
      era: str(80),
      entryFeeNote: str(200),
      wheelchairAccessible: z.boolean(),
    })
    .partial()
    .strict(),
};

export function validateAttributes(category: Category, attributes: unknown) {
  return ATTRIBUTE_SCHEMAS[category].safeParse(attributes);
}

// ---------------------------------------------------------------- publish readiness

export interface PublishCheckInput {
  bookingMode: BookingMode;
  city: string | null;
  meetingPoint: string | null;
  translations: Array<{ title: string; description: string | null }>;
}

export const MIN_LISTING_DESCRIPTION = 30;

/** What is missing before a listing may go public. Pure; the service adds company/feature checks. */
export function missingForPublish(l: PublishCheckInput): string[] {
  const missing: string[] = [];
  const complete = l.translations.some(
    (t) => t.title.trim().length >= 3 && (t.description ?? '').trim().length >= MIN_LISTING_DESCRIPTION,
  );
  if (!complete) missing.push('translation');
  if (!l.city) missing.push('city');
  // A bookable listing needs a distinct meeting point (meeting location vs activity location).
  if (l.bookingMode !== 'DISCOVERY_ONLY' && !l.meetingPoint) missing.push('meetingPoint');
  return missing;
}
