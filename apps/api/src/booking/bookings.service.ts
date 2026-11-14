import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { notify, expireHoldsAndPromote, promoteWaitlist, releasePromoForBooking, Prisma, releaseSeats, reserveSeats, type PrismaClient } from '@triphub/database';
import {
  CANCELLATION_POLICIES,
  normalizePromoCode,
  DEFAULT_CANCELLATION_POLICY,
  refundableMinor,
  type CancellationPolicy,
  computeQuote,
  QuoteError,
  type Currency,
  type LineRequest,
  type Quote,
  type RateInput,
  OPERATOR_DEPOSIT_HOURS,
} from '@triphub/shared';
import { createHash, randomBytes } from 'node:crypto';
import { PromoService } from '../marketing/promo.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { FEATURES, type Features } from '../config/features';
import { PRISMA } from '../database/database.module';
import { DepositsService, depositView } from './deposits.service';
import { paymentView } from '../payments/payments.service';


const BOOKABLE_MODES = ['FIXED_DATE', 'TIME_SLOT', 'REQUEST_TO_BOOK'] as const;
/** How long a business has to answer a booking request (product assumption). */
export const REQUEST_TTL_HOURS = 48;

export interface CreateBookingInput {
  listingId: string;
  slotId: string;
  lines: LineRequest[];
  waitlistEntryId?: string;
  promoCode?: string;
  contactName?: string;
  contactPhone?: string;
  pickupPoint?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

export const toRateInputs = (rates: Array<{ kind: string; amountMinor: bigint; currency: string; groupSize: number | null }>): RateInput[] =>
  rates.map((r) => ({ kind: r.kind as RateInput['kind'], amountMinor: r.amountMinor, currency: r.currency as Currency, groupSize: r.groupSize }));

export function quoteOrThrow(rates: RateInput[], lines: LineRequest[]): Quote {
  try {
    return computeQuote(rates, lines);
  } catch (e) {
    if (e instanceof QuoteError) throw new UnprocessableEntityException({ code: `quote_${e.code}`, message: e.message });
    throw e;
  }
}

/** Order-independent fingerprint of the request, used to detect key reuse with a different payload. */
export function requestHash(input: CreateBookingInput): string {
  const canonical = JSON.stringify({
    l: input.listingId,
    s: input.slotId,
    lines: [...input.lines].sort((a, b) => a.kind.localeCompare(b.kind)).map((x) => [x.kind, x.qty]),
    w: input.waitlistEntryId ?? null,
    c: input.promoCode ? input.promoCode.trim().toUpperCase() : null,
    n: input.contactName ?? null,
    p: input.contactPhone ?? null,
    pk: input.pickupPoint ?? null,
    en: input.emergencyContactName ?? null,
    ep: input.emergencyContactPhone ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Operator-collected deposits: hold the seat for OPERATOR_DEPOSIT_HOURS, never past the trip start. */
export const depositHoldUntil = (now: Date, startsAt: Date) => new Date(Math.min(now.getTime() + OPERATOR_DEPOSIT_HOURS * 3_600_000, startsAt.getTime()));

const REF_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
const newReference = () => {
  const bytes = randomBytes(8);
  return 'TH-' + Array.from(bytes, (b) => REF_ALPHABET[b % 32]).join('');
};

const bookingInclude = {
  hold: true,
  deposits: { orderBy: { recordedAt: 'asc' } },
  listing: { select: { depositPercent: true, pickupPoints: true } },
  payments: { orderBy: { submittedAt: 'desc' } },
  slot: { select: { startsAt: true, endsAt: true } },
} satisfies Prisma.BookingInclude;
type BookingFull = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

@Injectable()
export class BookingsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(FEATURES) private readonly features: Features,
    @Inject(SubscriptionsService) private readonly subs: SubscriptionsService,
    @Inject(PromoService) private readonly promos: PromoService,
  ) {}

  private async existingForKey(customerId: string, key: string, hash: string): Promise<BookingFull | null> {
    const existing = await this.db.booking.findUnique({
      where: { customerId_idempotencyKey: { customerId, idempotencyKey: key } },
      include: bookingInclude,
    });
    if (!existing) return null;
    if (existing.requestHash !== hash) throw new ConflictException({ code: 'idempotency_key_reuse' });
    return existing;
  }

  async create(customerId: string, key: string, input: CreateBookingInput): Promise<{ booking: BookingFull; replay: boolean }> {
    const hash = requestHash(input);
    const prior = await this.existingForKey(customerId, key, hash);
    if (prior) return { booking: prior, replay: true };

    const listing = await this.db.listing.findFirst({
      where: { id: input.listingId, status: 'PUBLISHED', company: { status: 'APPROVED' } },
      include: { rates: true, translations: true, company: { select: { id: true, name: true, commissionBps: true } } },
    });
    if (!listing) throw new NotFoundException();
    await this.subs.assertCanAcceptBookings(listing.companyId);
    if (!(BOOKABLE_MODES as readonly string[]).includes(listing.bookingMode)) {
      throw new ConflictException({ code: 'listing_not_bookable' });
    }
    const isRequest = listing.bookingMode === 'REQUEST_TO_BOOK';
    if (isRequest && !this.features.requestToBook) throw new ConflictException({ code: 'booking_mode_not_supported_yet' });
    const slot = await this.db.slot.findFirst({ where: { id: input.slotId, listingId: listing.id } });
    if (!slot) throw new NotFoundException();
    if (slot.status !== 'OPEN' || slot.startsAt.getTime() <= Date.now()) throw new ConflictException({ code: 'slot_unavailable' });

    // Totals are priced here, from stored rates. The client only ever sends quantities.
    const quote = quoteOrThrow(toRateInputs(listing.rates), input.lines);
    // A promo code lowers the price the customer pays; everything after this works on the net amount.
    let discountMinor = 0n;
    let promoId: string | null = null;
    let promoCode: string | null = null;
    if (input.promoCode) {
      const resolved = await this.promos.resolve({
        companyId: listing.companyId,
        listingId: listing.id,
        code: normalizePromoCode(input.promoCode),
        customerId,
        totalMinor: quote.totalMinor,
        currency: quote.currency,
      });
      discountMinor = resolved.discountMinor;
      promoId = resolved.promo.id;
      promoCode = resolved.promo.code;
    }
    const netMinor = quote.totalMinor - discountMinor;
    const isFree = netMinor === 0n;
    // Without platform custody, the operator collects the deposit directly: the seat is held long enough for that.
    const operatorDeposit = !isFree && !this.features.payments;
    if (listing.pickupPoints.length > 0 && (!input.pickupPoint || !listing.pickupPoints.includes(input.pickupPoint))) {
      throw new UnprocessableEntityException({ code: 'pickup_point_required', options: listing.pickupPoints });
    }

    // Release seats from lapsed holds on this slot before trying to take any.
    await expireHoldsAndPromote(this.db, { slotId: slot.id });

    // Strict first-come-first-served: while anyone is queued for this slot, seats are only
    // obtainable through an accepted offer, never by walking past the queue.
    let offerSeats = 0;
    if (isRequest) {
      if (input.waitlistEntryId) throw new ConflictException({ code: 'offer_not_active' });
      // Advisory only: nothing is held. The real, atomic capacity check happens when the business approves.
      if (slot.capacity - slot.reserved < quote.seats) throw new ConflictException({ code: 'not_enough_capacity' });
    } else if (input.waitlistEntryId) {
      const offer = await this.db.waitlistEntry.findFirst({ where: { id: input.waitlistEntryId, customerId, slotId: slot.id } });
      if (!offer || offer.status !== 'OFFERED' || !offer.offerExpiresAt || offer.offerExpiresAt <= new Date()) {
        throw new ConflictException({ code: 'offer_not_active' });
      }
      if (offer.seats !== quote.seats) throw new UnprocessableEntityException({ code: 'seats_must_match_offer', seats: offer.seats });
      offerSeats = offer.seats;
    } else if ((await this.db.waitlistEntry.count({ where: { slotId: slot.id, status: 'WAITING' } })) > 0) {
      throw new ConflictException({ code: 'waitlist_active' });
    }

    const title = (listing.translations.find((t) => t.locale === 'en') ?? listing.translations[0])?.title ?? '';
    const now = new Date();
    const snapshot = {
      version: 1,
      createdAt: now.toISOString(),
      listing: { id: listing.id, title, category: listing.category },
      company: { id: listing.company.id, name: listing.company.name },
      slot: { id: slot.id, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt?.toISOString() ?? null },
      currency: quote.currency,
      lines: quote.lines.map((l) => ({
        kind: l.kind,
        unitMinor: l.unitMinor.toString(),
        qty: l.qty,
        seats: l.seats,
        subtotalMinor: l.subtotalMinor.toString(),
      })),
      seats: quote.seats,
      totalMinor: netMinor.toString(),
      promo: promoCode ? { code: promoCode, discountMinor: discountMinor.toString(), grossMinor: quote.totalMinor.toString() } : null,
      // Commission rate in force at booking time; later plan or rate changes never alter this booking.
      commissionBps: await this.subs.commissionBpsFor(listing.companyId, listing.company.commissionBps),
      taxesMinor: '0',
      feesMinor: '0',
      // The policy the customer saw when booking; later edits to the listing never change it.
      cancellationPolicy: { code: listing.cancellationPolicy, version: 1 },
    };

    try {
      const bookingId = await this.db.$transaction(async (tx) => {
        if (input.waitlistEntryId) {
          // The offer already holds these seats; claiming it exactly once is the gate.
          const claim = await tx.waitlistEntry.updateMany({
            where: { id: input.waitlistEntryId, customerId, status: 'OFFERED', offerExpiresAt: { gt: new Date() } },
            data: { status: 'CONVERTED', resolvedAt: new Date() },
          });
          if (claim.count !== 1) throw new OfferGone();
        }
        const booking = await tx.booking.create({
          data: {
            reference: newReference(),
            companyId: listing.companyId,
            listingId: listing.id,
            slotId: slot.id,
            customerId,
            status: isRequest ? 'REQUESTED' : isFree ? 'CONFIRMED' : 'HELD',
            requestExpiresAt: isRequest ? new Date(now.getTime() + REQUEST_TTL_HOURS * 3_600_000) : null,
            quantity: quote.seats,
            currency: quote.currency,
            totalMinor: netMinor,
            snapshot: snapshot as Prisma.InputJsonValue,
            contactName: input.contactName,
            contactPhone: input.contactPhone,
            pickupPoint: input.pickupPoint ?? null,
            emergencyContactName: input.emergencyContactName ?? null,
            emergencyContactPhone: input.emergencyContactPhone ?? null,
            idempotencyKey: key,
            requestHash: hash,
          },
        });
        // If this fails the whole transaction (including the booking row) rolls back.
        if (promoId) {
          // Claim one redemption atomically with the booking (cap and active flag are checked in the same statement).
          const claimed = await tx.$executeRaw`
            UPDATE "promo_code" SET "redeemed" = "redeemed" + 1
             WHERE "id" = ${promoId}::uuid AND "active" AND ("maxRedemptions" IS NULL OR "redeemed" < "maxRedemptions")`;
          if (claimed !== 1) throw new PromoGone();
          await tx.promoRedemption.create({ data: { promoId, bookingId: booking.id, customerId, discountMinor } });
        }
        if (isRequest) return booking.id; // no seats, no hold until approved
        if (!offerSeats && !(await reserveSeats(tx, slot.id, quote.seats))) throw new CapacityError();
        await tx.hold.create({
          data: {
            bookingId: booking.id,
            slotId: slot.id,
            quantity: quote.seats,
            status: isFree ? 'CONSUMED' : 'ACTIVE',
            expiresAt: operatorDeposit ? depositHoldUntil(now, slot.startsAt) : new Date(now.getTime() + listing.holdMinutes * 60_000),
            resolvedAt: isFree ? now : null,
          },
        });
        return booking.id;
      });
      await this.db.auditEvent.create({
        data: {
          action: 'booking.created',
          actorId: customerId,
          companyId: listing.companyId,
          entityType: 'booking',
          entityId: bookingId,
          meta: { seats: quote.seats, status: isRequest ? 'REQUESTED' : isFree ? 'CONFIRMED' : 'HELD' },
        },
      });
      return { booking: await this.getOwn(customerId, bookingId), replay: false };
    } catch (e) {
      if (e instanceof PromoGone) throw new UnprocessableEntityException({ code: 'promo_invalid', reason: 'exhausted' });
      if (e instanceof OfferGone) throw new ConflictException({ code: 'offer_not_active' });
      if (e instanceof CapacityError) throw new ConflictException({ code: 'not_enough_capacity' });
      // A concurrent request with the same key won the unique index: behave as a replay.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        if (promoId && (await this.db.promoRedemption.count({ where: { promoId, customerId } }))) {
          throw new UnprocessableEntityException({ code: 'promo_invalid', reason: 'already_used' });
        }
        const again = await this.existingForKey(customerId, key, hash);
        if (again) return { booking: again, replay: true };
      }
      throw e;
    }
  }

  async getOwn(customerId: string, id: string): Promise<BookingFull> {
    const b = await this.db.booking.findFirst({ where: { id, customerId }, include: bookingInclude });
    if (!b) throw new NotFoundException();
    return b;
  }

  listOwn(customerId: string): Promise<BookingFull[]> {
    return this.db.booking.findMany({ where: { customerId }, include: bookingInclude, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async listForCompany(companyId: string, status?: string): Promise<Array<BookingFull & { customer: { email: string } }>> {
    return this.db.booking.findMany({
      where: { companyId, ...(status ? { status: status as never } : {}) },
      include: { ...bookingInclude, customer: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async getForCompany(companyId: string, id: string) {
    const b = await this.db.booking.findFirst({
      where: { id, companyId },
      include: { ...bookingInclude, customer: { select: { email: true } } },
    });
    if (!b) throw new NotFoundException();
    return b;
  }

  /**
   * Cancels a booking and releases its seats exactly once. The status transition is the gate: if
   * a concurrent expiry or cancel already moved the booking, this call fails with 409 and releases nothing.
   */
  async cancel(where: { id: string; customerId?: string; companyId?: string }, actorId: string, reason?: string) {
    const found = await this.db.booking.findFirst({
      where: { id: where.id, ...(where.customerId ? { customerId: where.customerId } : {}), ...(where.companyId ? { companyId: where.companyId } : {}) },
    });
    if (!found) throw new NotFoundException();

    if (found.status === 'REQUESTED') {
      // A pending request holds no seats, so cancelling it releases nothing.
      const r = await this.db.booking.updateMany({
        where: { id: found.id, status: 'REQUESTED' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, cancelledBy: where.customerId ? 'CUSTOMER' : 'BUSINESS', version: { increment: 1 } },
      });
      if (r.count === 1) {
        await this.db.$transaction((tx) => releasePromoForBooking(tx, found.id));
        await this.db.auditEvent.create({
          data: { action: 'booking.request_cancelled', actorId, companyId: found.companyId, entityType: 'booking', entityId: found.id, meta: { by: where.customerId ? 'customer' : 'business' } },
        });
        return this.db.booking.findUniqueOrThrow({ where: { id: found.id }, include: bookingInclude });
      }
      // Someone approved it meanwhile: fall through to the normal cancel of a seat-holding booking.
    }

    await this.db.$transaction(async (tx) => {
      const res = await tx.booking.updateMany({
        where: { id: found.id, status: { in: ['HELD', 'CONFIRMED'] } },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, cancelledBy: where.customerId ? 'CUSTOMER' : 'BUSINESS', version: { increment: 1 } },
      });
      if (res.count !== 1) throw new ConflictException({ code: 'invalid_transition' });
      await tx.hold.updateMany({ where: { bookingId: found.id, status: 'ACTIVE' }, data: { status: 'RELEASED', resolvedAt: new Date() } });
      await releaseSeats(tx, found.slotId, found.quantity);
      if (!(await tx.payment.count({ where: { bookingId: found.id, status: { in: ['VERIFIED', 'VERIFIED_UNALLOCATED'] } } }))) {
        await releasePromoForBooking(tx, found.id);
      }
      await tx.auditEvent.create({
        data: {
          action: 'booking.cancelled',
          actorId,
          companyId: found.companyId,
          entityType: 'booking',
          entityId: found.id,
          meta: { by: where.customerId ? 'customer' : 'business', reason: reason ?? null },
        },
      });
    });
    if (!where.customerId) await notify(this.db, found.customerId, 'booking.cancelled_by_business', { bookingId: found.id });
    await promoteWaitlist(this.db, found.slotId);
    return this.db.booking.findUniqueOrThrow({ where: { id: found.id }, include: bookingInclude });
  }

  /** Business approves a request: seats are reserved atomically now; it may fail if the slot filled up. */
  async approve(companyId: string, id: string, actorId: string) {
    const found = await this.db.booking.findFirst({ where: { id, companyId }, include: { listing: { select: { holdMinutes: true } }, slot: { select: { startsAt: true } } } });
    if (!found) throw new NotFoundException();
    const now = new Date();
    if (found.status !== 'REQUESTED') throw new ConflictException({ code: 'invalid_transition', status: found.status });
    if (found.requestExpiresAt && found.requestExpiresAt <= now) {
      await expireHoldsAndPromote(this.db, {});
      throw new ConflictException({ code: 'request_expired' });
    }
    const free = found.totalMinor === 0n;
    const operatorDeposit = !free && !this.features.payments;
    try {
      await this.db.$transaction(async (tx) => {
        const gate = await tx.booking.updateMany({
          where: { id, status: 'REQUESTED', requestExpiresAt: { gt: now } },
          data: { status: free ? 'CONFIRMED' : 'HELD', decidedAt: now, version: { increment: 1 } },
        });
        if (gate.count !== 1) throw new ConflictException({ code: 'invalid_transition' });
        if (!(await reserveSeats(tx, found.slotId, found.quantity))) throw new CapacityError(); // rolls back the status change
        await tx.hold.create({
          data: {
            bookingId: id,
            slotId: found.slotId,
            quantity: found.quantity,
            status: free ? 'CONSUMED' : 'ACTIVE',
            expiresAt: operatorDeposit ? depositHoldUntil(now, found.slot.startsAt) : new Date(now.getTime() + found.listing.holdMinutes * 60_000),
            resolvedAt: free ? now : null,
          },
        });
        await tx.auditEvent.create({
          data: { action: 'booking.request_approved', actorId, companyId, entityType: 'booking', entityId: id, meta: { status: free ? 'CONFIRMED' : 'HELD' } },
        });
        await notify(tx, found.customerId, 'booking.request_approved', { bookingId: id, status: free ? 'CONFIRMED' : 'HELD' });
      });
    } catch (e) {
      if (e instanceof CapacityError) throw new ConflictException({ code: 'not_enough_capacity' });
      throw e;
    }
    return this.db.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
  }

  /** The business marks a trip as delivered. Only then can the customer review it. */
  async complete(companyId: string, id: string, actorId: string) {
    const found = await this.db.booking.findFirst({ where: { id, companyId }, include: { slot: true } });
    if (!found) throw new NotFoundException();
    if (found.status !== 'CONFIRMED') throw new ConflictException({ code: 'invalid_transition', status: found.status });
    if (found.slot.startsAt.getTime() > Date.now()) throw new ConflictException({ code: 'trip_not_started' });
    const r = await this.db.booking.updateMany({ where: { id, status: 'CONFIRMED' }, data: { status: 'COMPLETED', version: { increment: 1 } } });
    if (r.count !== 1) throw new ConflictException({ code: 'invalid_transition' });
    await this.db.auditEvent.create({ data: { action: 'booking.completed', actorId, companyId, entityType: 'booking', entityId: id, meta: {} } });
    await notify(this.db, found.customerId, 'booking.completed', { bookingId: id });
    return this.db.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
  }

  async decline(companyId: string, id: string, actorId: string, reason: string) {
    const found = await this.db.booking.findFirst({ where: { id, companyId } });
    if (!found) throw new NotFoundException();
    const r = await this.db.booking.updateMany({
      where: { id, status: 'REQUESTED' },
      data: { status: 'DECLINED', decidedAt: new Date(), declineReason: reason, version: { increment: 1 } },
    });
    if (r.count !== 1) throw new ConflictException({ code: 'invalid_transition', status: found.status });
    await this.db.auditEvent.create({
      data: { action: 'booking.request_declined', actorId, companyId, entityType: 'booking', entityId: id, meta: { reason } },
    });
    await this.db.$transaction((tx) => releasePromoForBooking(tx, id));
    await notify(this.db, found.customerId, 'booking.request_declined', { bookingId: id });
    return this.db.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude });
  }
}

class CapacityError extends Error {}
class OfferGone extends Error {}
class PromoGone extends Error {}

const money = (n: bigint) => n.toString();

/** Customer-facing shape. A HELD booking is explicitly NOT confirmed. */
export function bookingView(b: BookingFull) {
  const code = (b.snapshot as { cancellationPolicy?: { code?: string } | null }).cancellationPolicy?.code;
  const policy: CancellationPolicy = (CANCELLATION_POLICIES as readonly string[]).includes(code ?? '') ? (code as CancellationPolicy) : DEFAULT_CANCELLATION_POLICY;
  const paid = b.payments.some((p) => p.status === 'VERIFIED') ? b.totalMinor : 0n;
  return {
    // What the customer agreed to, and what they would get back if they cancelled right now.
    cancellation: {
      policy,
      refundIfCancelledNowMinor: ['CONFIRMED', 'HELD'].includes(b.status)
        ? refundableMinor({ paidMinor: paid, policy, startsAt: b.slot.startsAt, cancelledAt: new Date(), by: 'CUSTOMER' }).toString()
        : '0',
    },
    id: b.id,
    reference: b.reference,
    status: b.status,
    confirmed: b.status === 'CONFIRMED' || b.status === 'COMPLETED',
    awaitingPayment: b.status === 'HELD',
    /** True while the business has not answered; nothing is held or charged. */
    awaitingApproval: b.status === 'REQUESTED',
    declined: b.status === 'DECLINED',
    requestExpiresAt: b.status === 'REQUESTED' ? b.requestExpiresAt : null,
    holdExpiresAt: b.status === 'HELD' ? (b.hold?.expiresAt ?? null) : null,
    quantity: b.quantity,
    currency: b.currency,
    totalMinor: money(b.totalMinor),
    slot: { startsAt: b.slot.startsAt, endsAt: b.slot.endsAt },
    snapshot: b.snapshot,
    payments: b.payments.map(paymentView),
    pickupPoint: b.pickupPoint,
    emergencyContact: b.emergencyContactName || b.emergencyContactPhone ? { name: b.emergencyContactName, phone: b.emergencyContactPhone } : null,
    /** Deposits the operator recorded (Whish / OMT / cash), against what the listing asks for. */
    deposit: { ...DepositsService.summary(b, b.listing.depositPercent), items: b.deposits.map(depositView) },
    cancelledAt: b.cancelledAt,
    createdAt: b.createdAt,
  };
}
