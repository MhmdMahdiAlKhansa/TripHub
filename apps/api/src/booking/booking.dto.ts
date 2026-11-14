import { DEPOSIT_METHODS, RATE_KINDS } from '@triphub/shared';
import { z } from 'zod';

const amount = z
  .union([z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^\d{1,15}$/)])
  .transform((v) => BigInt(v));

export const RatesDto = z
  .object({
    rates: z
      .array(
        z
          .object({
            kind: z.enum(RATE_KINDS),
            amount,
            currency: z.enum(['USD', 'LBP']),
            groupSize: z.number().int().min(1).max(50).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict()
  .superRefine((v, ctx) => {
    const kinds = new Set<string>();
    for (const [i, r] of v.rates.entries()) {
      if (kinds.has(r.kind)) ctx.addIssue({ code: 'custom', path: ['rates', i, 'kind'], message: 'duplicate rate kind' });
      kinds.add(r.kind);
      if (r.kind === 'GROUP' && r.groupSize === undefined) {
        ctx.addIssue({ code: 'custom', path: ['rates', i, 'groupSize'], message: 'groupSize is required for GROUP rates' });
      }
      if (r.kind !== 'GROUP' && r.groupSize !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['rates', i, 'groupSize'], message: 'groupSize only applies to GROUP rates' });
      }
    }
    if (new Set(v.rates.map((r) => r.currency)).size > 1) {
      ctx.addIssue({ code: 'custom', path: ['rates'], message: 'all rates of a listing must use one currency' });
    }
  });

export const SlotDto = z
  .object({
    startsAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
    endsAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)).optional(),
    capacity: z.number().int().min(1).max(1000),
  })
  .strict()
  .refine((v) => !v.endsAt || v.endsAt > v.startsAt, { message: 'endsAt must be after startsAt', path: ['endsAt'] });

export const SlotPatchDto = z
  .object({ capacity: z.number().int().min(0).max(1000), status: z.enum(['OPEN', 'CLOSED']) })
  .partial()
  .strict();

const lines = z
  .array(z.object({ kind: z.enum(RATE_KINDS), qty: z.number().int().min(1).max(50) }).strict())
  .min(1)
  .max(3);

export const QuoteDto = z.object({ slotId: z.uuid().optional(), lines, promoCode: z.string().trim().max(40).optional() }).strict();

export const CreateBookingDto = z
  .object({
    listingId: z.uuid(),
    slotId: z.uuid(),
    lines,
    /** Set when converting an accepted waitlist offer into a booking. */
    waitlistEntryId: z.uuid().optional(),
    promoCode: z.string().trim().max(40).optional(),
    contactName: z.string().trim().min(2).max(80).optional(),
    contactPhone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/).optional(),
    /** One of the listing's pickup points (required when the listing offers any). */
    pickupPoint: z.string().trim().min(1).max(120).optional(),
    emergencyContactName: z.string().trim().min(2).max(80).optional(),
    emergencyContactPhone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/).optional(),
  })
  .strict();

export const RecordDepositDto = z
  .object({
    method: z.enum(DEPOSIT_METHODS),
    amount,
    currency: z.enum(['USD', 'LBP']),
    reference: z.string().trim().min(2).max(64).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine((v) => v.amount > 0n, { message: 'amount must be positive', path: ['amount'] });

export const IdempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);

export const CancelDto = z.object({ reason: z.string().trim().max(500).optional() }).strict();

export const JoinWaitlistDto = z.object({ slotId: z.uuid(), seats: z.number().int().min(1).max(20) }).strict();

export const DeclineDto = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
