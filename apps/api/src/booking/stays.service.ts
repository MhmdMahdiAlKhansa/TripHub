import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@triphub/database';
import { beirutInstant, beirutToday, quoteStay, shiftDay, StayError, stayRulesOf, type Currency } from '@triphub/shared';
import { createHash } from 'node:crypto';
import { FEATURES, type Features } from '../config/features';
import { PRISMA } from '../database/database.module';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { bookingInclude, depositHoldUntil, newReference, type BookingFull } from './bookings.service';

export interface StayRequest {
  checkIn: string;
  checkOut: string;
  guests: number;
}
export interface CreateStayInput extends StayRequest {
  listingId: string;
  contactName?: string;
  contactPhone?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

/** Postgres raises 23P01 when the no-overlap exclusion constraint on slots rejects a range. */
const isOverlap = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2004' || String(e.message).includes('slot_no_overlapping_stays') || String((e.meta as { code?: string } | undefined)?.code) === '23P01')) ||
  String((e as { message?: string })?.message ?? '').includes('slot_no_overlapping_stays') ||
  String((e as { cause?: { code?: string } })?.cause?.code ?? '') === '23P01';

/**
 * Nightly stays at a property. Each stay is a Booking with its own STAY slot (capacity 1) covering
 * check-in to check-out. A database exclusion constraint makes two live stays (or a stay and a host block)
 * on the same property impossible, even under concurrent requests. When a stay is cancelled or its
 * deposit hold lapses, the slot's seat is released and the dates become free again automatically.
 */
@Injectable()
export class StaysService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(FEATURES) private readonly features: Features,
    @Inject(SubscriptionsService) private readonly subs: SubscriptionsService,
  ) {}

  private async publicStay(listingId: string) {
    const l = await this.db.listing.findFirst({
      where: { id: listingId, status: 'PUBLISHED', bookingMode: 'NIGHTLY', company: { status: 'APPROVED' } },
      include: { rates: true, translations: true, company: { select: { id: true, name: true, commissionBps: true } } },
    });
    if (!l) throw new NotFoundException();
    return l;
  }

  static pricing(rates: Array<{ kind: string; amountMinor: bigint; currency: string }>) {
    const night = rates.find((r) => r.kind === 'NIGHT');
    if (!night) return null;
    return {
      currency: night.currency as Currency,
      nightMinor: night.amountMinor,
      weekendNightMinor: rates.find((r) => r.kind === 'WEEKEND_NIGHT')?.amountMinor ?? null,
      cleaningMinor: rates.find((r) => r.kind === 'CLEANING')?.amountMinor ?? null,
    };
  }

  private quoteOrThrow(listing: { rates: Array<{ kind: string; amountMinor: bigint; currency: string }>; attributes: unknown }, req: StayRequest) {
    const pricing = StaysService.pricing(listing.rates);
    if (!pricing) throw new ConflictException({ code: 'no_price' });
    const rules = stayRulesOf(listing.attributes);
    try {
      return { quote: quoteStay(pricing, rules, req, beirutToday()), rules };
    } catch (e) {
      if (e instanceof StayError) throw new UnprocessableEntityException({ code: e.code, message: e.message, minNights: rules.minNights, maxGuests: rules.maxGuests });
      throw e;
    }
  }

  /** Nights that cannot be booked between two dates: booked stays and host blocks, as half-open [from, to) date ranges. */
  async calendar(listingId: string, from: string, to: string) {
    const l = await this.publicStay(listingId);
    const rules = stayRulesOf(l.attributes);
    const slots = await this.db.slot.findMany({
      where: {
        listingId,
        OR: [{ kind: 'BLOCK' }, { kind: 'STAY', reserved: { gt: 0 } }],
        startsAt: { lt: beirutInstant(to, '23:59') },
        endsAt: { gt: beirutInstant(from, '00:00') },
      },
      select: { startsAt: true, endsAt: true },
      orderBy: { startsAt: 'asc' },
    });
    const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(d);
    return {
      rules,
      pricing: (() => {
        const p = StaysService.pricing(l.rates);
        return p ? { currency: p.currency, nightMinor: p.nightMinor.toString(), weekendNightMinor: p.weekendNightMinor?.toString() ?? null, cleaningMinor: p.cleaningMinor?.toString() ?? null } : null;
      })(),
      // A stay occupies the nights from its check-in date up to (not including) its check-out date.
      unavailable: slots.map((s) => ({ from: day(s.startsAt), to: day(s.endsAt!) })),
      today: beirutToday(),
    };
  }

  async quote(listingId: string, req: StayRequest) {
    const l = await this.publicStay(listingId);
    const { quote } = this.quoteOrThrow(l, req);
    const free = await this.rangeIsFree(listingId, req, l.attributes);
    return { ...serializeQuote(quote), available: free };
  }

  private async rangeIsFree(listingId: string, req: StayRequest, attributes: unknown) {
    const rules = stayRulesOf(attributes);
    const startsAt = beirutInstant(req.checkIn, rules.checkInTime);
    const endsAt = beirutInstant(req.checkOut, rules.checkOutTime);
    const clash = await this.db.slot.count({
      where: { listingId, OR: [{ kind: 'BLOCK' }, { kind: 'STAY', reserved: { gt: 0 } }], startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    });
    return clash === 0;
  }

  async book(customerId: string, key: string, input: CreateStayInput): Promise<{ booking: BookingFull; replay: boolean }> {
    const hash = createHash('sha256').update(JSON.stringify(['stay', input.listingId, input.checkIn, input.checkOut, input.guests, input.contactName ?? null, input.contactPhone ?? null, input.emergencyContactName ?? null, input.emergencyContactPhone ?? null])).digest('hex');
    const prior = await this.db.booking.findUnique({ where: { customerId_idempotencyKey: { customerId, idempotencyKey: key } }, include: bookingInclude });
    if (prior) {
      if (prior.requestHash !== hash) throw new ConflictException({ code: 'idempotency_key_reuse' });
      return { booking: prior, replay: true };
    }
    const listing = await this.publicStay(input.listingId);
    await this.subs.assertCanAcceptBookings(listing.companyId);
    const { quote, rules } = this.quoteOrThrow(listing, input);
    const startsAt = beirutInstant(input.checkIn, rules.checkInTime);
    const endsAt = beirutInstant(input.checkOut, rules.checkOutTime);
    if (startsAt.getTime() <= Date.now()) throw new UnprocessableEntityException({ code: 'check_in_in_past' });
    const isFree = quote.totalMinor === 0n;
    const operatorDeposit = !isFree && !this.features.payments;
    if (!isFree && !operatorDeposit) throw new ConflictException({ code: 'payments_not_available_yet' });
    const now = new Date();
    const title = (listing.translations.find((t) => t.locale === 'en') ?? listing.translations[0])?.title ?? '';
    const snapshot = {
      version: 1,
      kind: 'STAY',
      createdAt: now.toISOString(),
      listing: { id: listing.id, title, category: listing.category },
      company: { id: listing.company.id, name: listing.company.name },
      slot: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
      stay: { checkIn: input.checkIn, checkOut: input.checkOut, nights: quote.nights, guests: input.guests, checkInTime: rules.checkInTime, checkOutTime: rules.checkOutTime },
      currency: quote.currency,
      lines: [
        { kind: 'NIGHTS', qty: quote.nights, subtotalMinor: quote.nightsMinor.toString(), perNight: quote.perNight.map((n) => ({ date: n.date, minor: n.minor.toString(), weekend: n.weekend })) },
        ...(quote.cleaningMinor > 0n ? [{ kind: 'CLEANING', qty: 1, subtotalMinor: quote.cleaningMinor.toString() }] : []),
      ],
      seats: 1,
      totalMinor: quote.totalMinor.toString(),
      promo: null,
      commissionBps: await this.subs.commissionBpsFor(listing.companyId, listing.company.commissionBps),
      taxesMinor: '0',
      feesMinor: '0',
      cancellationPolicy: { code: listing.cancellationPolicy, version: 1 },
    };
    try {
      const bookingId = await this.db.$transaction(async (tx) => {
        // The STAY slot is created already holding its one "seat": the exclusion constraint checks the range here.
        const slot = await tx.slot.create({ data: { listingId: listing.id, kind: 'STAY', startsAt, endsAt, capacity: 1, reserved: 1 } });
        const booking = await tx.booking.create({
          data: {
            reference: newReference(), companyId: listing.companyId, listingId: listing.id, slotId: slot.id, customerId,
            status: isFree ? 'CONFIRMED' : 'HELD', quantity: 1, currency: quote.currency, totalMinor: quote.totalMinor,
            snapshot: snapshot as Prisma.InputJsonValue,
            contactName: input.contactName, contactPhone: input.contactPhone,
            emergencyContactName: input.emergencyContactName ?? null, emergencyContactPhone: input.emergencyContactPhone ?? null,
            idempotencyKey: key, requestHash: hash,
          },
        });
        await tx.hold.create({
          data: {
            bookingId: booking.id, slotId: slot.id, quantity: 1,
            status: isFree ? 'CONSUMED' : 'ACTIVE',
            expiresAt: operatorDeposit ? depositHoldUntil(now, startsAt) : new Date(now.getTime() + listing.holdMinutes * 60_000),
            resolvedAt: isFree ? now : null,
          },
        });
        await tx.auditEvent.create({
          data: { action: 'stay.booked', actorId: customerId, companyId: listing.companyId, entityType: 'booking', entityId: booking.id, meta: { checkIn: input.checkIn, checkOut: input.checkOut, nights: quote.nights, guests: input.guests } },
        });
        return booking.id;
      });
      return { booking: await this.db.booking.findUniqueOrThrow({ where: { id: bookingId }, include: bookingInclude }), replay: false };
    } catch (e) {
      if (isOverlap(e)) throw new ConflictException({ code: 'dates_unavailable' });
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.db.booking.findUnique({ where: { customerId_idempotencyKey: { customerId, idempotencyKey: key } }, include: bookingInclude });
        if (again) return { booking: again, replay: true };
      }
      throw e;
    }
  }

  // ------------------------------------------------------------------ host side

  private async hostStay(companyId: string, listingId: string) {
    const l = await this.db.listing.findFirst({ where: { id: listingId, companyId, bookingMode: 'NIGHTLY' } });
    if (!l) throw new NotFoundException();
    if (l.status === 'ARCHIVED') throw new ConflictException({ code: 'listing_archived' });
    return l;
  }

  /** The host closes dates (maintenance, family use). Fails if a live stay already covers any of those nights. */
  async block(companyId: string, listingId: string, actorId: string, input: { from: string; to: string; note?: string }) {
    const l = await this.hostStay(companyId, listingId);
    if (input.to <= input.from) throw new BadRequestException({ code: 'check_out_before_check_in' });
    if (input.from < beirutToday()) throw new UnprocessableEntityException({ code: 'check_in_in_past' });
    const rules = stayRulesOf(l.attributes);
    try {
      const slot = await this.db.slot.create({
        data: { listingId, kind: 'BLOCK', startsAt: beirutInstant(input.from, rules.checkInTime), endsAt: beirutInstant(input.to, rules.checkOutTime), capacity: 0, reserved: 0, note: input.note ?? null },
      });
      await this.db.auditEvent.create({ data: { action: 'stay.blocked', actorId, companyId, entityType: 'listing', entityId: listingId, meta: { from: input.from, to: input.to } } });
      return slot;
    } catch (e) {
      if (isOverlap(e)) throw new ConflictException({ code: 'dates_unavailable' });
      throw e;
    }
  }

  async unblock(companyId: string, listingId: string, slotId: string, actorId: string) {
    await this.hostStay(companyId, listingId);
    const res = await this.db.slot.deleteMany({ where: { id: slotId, listingId, kind: 'BLOCK' } });
    if (res.count !== 1) throw new NotFoundException();
    await this.db.auditEvent.create({ data: { action: 'stay.unblocked', actorId, companyId, entityType: 'listing', entityId: listingId, meta: { slotId } } });
  }

  /** The host's calendar: upcoming stays (with guest and status) and blocks, in date order. */
  async hostCalendar(companyId: string, listingId: string) {
    await this.hostStay(companyId, listingId);
    const since = beirutInstant(shiftDay(beirutToday(), -1), '00:00');
    const slots = await this.db.slot.findMany({
      where: { listingId, kind: { in: ['STAY', 'BLOCK'] }, endsAt: { gt: since }, OR: [{ kind: 'BLOCK' }, { reserved: { gt: 0 } }] },
      include: { bookings: { select: { id: true, reference: true, status: true, contactName: true, contactPhone: true, snapshot: true, totalMinor: true, currency: true } } },
      orderBy: { startsAt: 'asc' },
    });
    const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(d);
    return slots.map((s) => {
      const b = s.bookings[0];
      const stay = (b?.snapshot as { stay?: { guests: number; nights: number } } | undefined)?.stay;
      return {
        id: s.id, kind: s.kind, from: day(s.startsAt), to: day(s.endsAt!), note: s.note,
        booking: b ? { id: b.id, reference: b.reference, status: b.status, guestName: b.contactName, guestPhone: b.contactPhone, guests: stay?.guests ?? null, nights: stay?.nights ?? null, totalMinor: b.totalMinor.toString(), currency: b.currency } : null,
      };
    });
  }
}

export const serializeQuote = (q: ReturnType<typeof quoteStay>) => ({
  nights: q.nights,
  weekendNights: q.weekendNights,
  currency: q.currency,
  nightsMinor: q.nightsMinor.toString(),
  cleaningMinor: q.cleaningMinor.toString(),
  totalMinor: q.totalMinor.toString(),
  perNight: q.perNight.map((n) => ({ date: n.date, minor: n.minor.toString(), weekend: n.weekend })),
});
