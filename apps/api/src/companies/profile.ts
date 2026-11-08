import { CATEGORIES, COMPANY_LANGUAGES, SOCIAL_KEYS } from '@triphub/shared';
import { z } from 'zod';

const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an https URL');

const emptyToNull = <T extends z.ZodType>(schema: T) =>
  z.union([z.literal('').transform(() => null), schema.nullable()]);

/** Fields a company may edit. Every field is optional (PATCH semantics). */
export const ProfileDto = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: emptyToNull(z.string().trim().max(2000)),
    contactEmail: emptyToNull(z.string().trim().toLowerCase().max(254).pipe(z.email())),
    phone: emptyToNull(z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'invalid phone number')),
    website: emptyToNull(httpsUrl),
    city: emptyToNull(z.string().trim().max(80)),
    address: emptyToNull(z.string().trim().max(200)),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    socials: z.partialRecord(z.enum(SOCIAL_KEYS), httpsUrl),
    categories: z.array(z.enum(CATEGORIES)).max(6),
    languages: z.array(z.enum(COMPANY_LANGUAGES)).max(3),
    onboardingStep: z.number().int().min(1).max(7),
  })
  .partial()
  .strict()
  .refine((v) => (v.latitude == null) === (v.longitude == null), {
    message: 'latitude and longitude must be set together',
    path: ['latitude'],
  });
export type ProfileInput = z.infer<typeof ProfileDto>;

export interface ProfileShape {
  name: string;
  description: string | null;
  contactEmail: string | null;
  phone: string | null;
  city: string | null;
  categories: string[];
  languages: string[];
}

export const MIN_DESCRIPTION = 30;

/** What must be filled in before a company may be submitted for verification. */
export function missingForSubmission(c: ProfileShape): string[] {
  const missing: string[] = [];
  if (c.name.trim().length < 2) missing.push('name');
  if ((c.description ?? '').trim().length < MIN_DESCRIPTION) missing.push('description');
  if (!c.contactEmail) missing.push('contactEmail');
  if (!c.phone) missing.push('phone');
  if (!c.city) missing.push('city');
  if (c.categories.length === 0) missing.push('categories');
  if (c.languages.length === 0) missing.push('languages');
  return missing;
}

export type EditableStatus = 'DRAFT' | 'CHANGES_REQUESTED' | 'APPROVED';
export const EDITABLE_STATUSES: readonly string[] = ['DRAFT', 'CHANGES_REQUESTED', 'APPROVED'];
