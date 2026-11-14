import { BOOKING_MODES, CANCELLATION_POLICIES, CATEGORIES, DEFAULT_CANCELLATION_POLICY, LOCALES } from '@triphub/shared';
import { z } from 'zod';

const nullableText = (max: number) => z.union([z.literal('').transform(() => null), z.string().trim().max(max).nullable()]);

export const TranslationDto = z
  .object({
    title: z.string().trim().min(3).max(120),
    summary: nullableText(240).optional(),
    description: nullableText(5000).optional(),
  })
  .strict();

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

const base = {
  city: nullableText(80),
  address: nullableText(200),
  latitude: lat.nullable(),
  longitude: lng.nullable(),
  meetingPoint: nullableText(200),
  /** Pickup points offered to participants (chosen per booking). */
  pickupPoints: z.array(z.string().trim().min(2).max(120)).max(10),
  /** Deposit required before a seat is secured, as a percentage of the price (100 = full amount). */
  depositPercent: z.number().int().min(1).max(100),
  meetingLatitude: lat.nullable(),
  meetingLongitude: lng.nullable(),
  attributes: z.record(z.string().max(40), z.unknown()),
  translations: z.partialRecord(z.enum(LOCALES), TranslationDto),
};

const pairs = (v: {
  latitude?: number | null;
  longitude?: number | null;
  meetingLatitude?: number | null;
  meetingLongitude?: number | null;
}) => (v.latitude == null) === (v.longitude == null) && (v.meetingLatitude == null) === (v.meetingLongitude == null);
const pairsMsg = { message: 'latitude and longitude must be set together', path: ['latitude'] };

export const CreateListingDto = z
  .object({
    category: z.enum(CATEGORIES),
    bookingMode: z.enum(BOOKING_MODES).default('DISCOVERY_ONLY'),
    cancellationPolicy: z.enum(CANCELLATION_POLICIES).default(DEFAULT_CANCELLATION_POLICY),
    ...base,
    translations: base.translations.refine((t) => Object.keys(t).length > 0, 'at least one translation is required'),
  })
  .partial({ city: true, address: true, latitude: true, longitude: true, meetingPoint: true, meetingLatitude: true, meetingLongitude: true, attributes: true, pickupPoints: true, depositPercent: true })
  .strict()
  .refine(pairs, pairsMsg);

/** category is immutable after creation, so attribute validation always has a fixed schema. */
export const UpdateListingDto = z
  .object({ bookingMode: z.enum(BOOKING_MODES), cancellationPolicy: z.enum(CANCELLATION_POLICIES), ...base })
  .partial()
  .strict()
  .refine(pairs, pairsMsg);

export type CreateListingInput = z.infer<typeof CreateListingDto>;
export type UpdateListingInput = z.infer<typeof UpdateListingDto>;
