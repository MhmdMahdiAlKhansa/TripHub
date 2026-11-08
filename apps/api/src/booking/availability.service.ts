import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { expireDueHolds, Prisma, type PrismaClient } from '@triphub/database';
import type { z } from 'zod';
import { PRISMA } from '../database/database.module';
import type { RatesDto, SlotDto, SlotPatchDto } from './booking.dto';

@Injectable()
export class AvailabilityService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  private audit(action: string, actorId: string, companyId: string, entityId: string, meta: object = {}) {
    return this.db.auditEvent.create({
      data: { action, actorId, companyId, entityType: 'listing', entityId, meta },
    });
  }

  /** Listing must belong to the company (scoped lookup) and not be archived. */
  private async editableListing(companyId: string, listingId: string) {
    const l = await this.db.listing.findFirst({ where: { id: listingId, companyId } });
    if (!l) throw new NotFoundException();
    if (l.status === 'ARCHIVED') throw new ConflictException({ code: 'listing_archived' });
    return l;
  }

  async setRates(companyId: string, listingId: string, actorId: string, input: z.infer<typeof RatesDto>) {
    const listing = await this.editableListing(companyId, listingId);
    if (listing.bookingMode === 'DISCOVERY_ONLY') throw new ConflictException({ code: 'listing_not_bookable' });
    await this.db.$transaction([
      this.db.listingRate.deleteMany({ where: { listingId } }),
      this.db.listingRate.createMany({
        data: input.rates.map((r) => ({
          listingId,
          kind: r.kind,
          amountMinor: r.amount,
          currency: r.currency,
          groupSize: r.kind === 'GROUP' ? (r.groupSize ?? null) : null,
        })),
      }),
    ]);
    await this.audit('listing.rates_set', actorId, companyId, listingId, { currency: input.rates[0]!.currency });
    return this.getRates(companyId, listingId);
  }

  async getRates(companyId: string, listingId: string) {
    const l = await this.db.listing.findFirst({ where: { id: listingId, companyId }, include: { rates: true } });
    if (!l) throw new NotFoundException();
    return l.rates;
  }

  async createSlot(companyId: string, listingId: string, actorId: string, input: z.infer<typeof SlotDto>) {
    const listing = await this.editableListing(companyId, listingId);
    if (listing.bookingMode === 'DISCOVERY_ONLY') throw new ConflictException({ code: 'listing_not_bookable' });
    if (input.startsAt.getTime() <= Date.now()) throw new ConflictException({ code: 'slot_in_past' });
    try {
      const slot = await this.db.slot.create({
        data: { listingId, startsAt: input.startsAt, endsAt: input.endsAt, capacity: input.capacity },
      });
      await this.audit('slot.created', actorId, companyId, listingId, { slotId: slot.id, capacity: input.capacity });
      return slot;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ code: 'slot_exists' });
      }
      throw e;
    }
  }

  async listSlots(companyId: string, listingId: string) {
    const l = await this.db.listing.findFirst({ where: { id: listingId, companyId }, select: { id: true } });
    if (!l) throw new NotFoundException();
    return this.db.slot.findMany({ where: { listingId }, orderBy: { startsAt: 'asc' } });
  }

  async updateSlot(companyId: string, listingId: string, slotId: string, actorId: string, input: z.infer<typeof SlotPatchDto>) {
    await this.editableListing(companyId, listingId);
    const exists = await this.db.slot.findFirst({ where: { id: slotId, listingId }, select: { id: true } });
    if (!exists) throw new NotFoundException();

    // Capacity can never drop below what is already reserved: the guard is part of the UPDATE itself.
    const res = await this.db.slot.updateMany({
      where: {
        id: slotId,
        listingId,
        ...(input.capacity !== undefined ? { reserved: { lte: input.capacity } } : {}),
      },
      data: { capacity: input.capacity, status: input.status },
    });
    if (res.count !== 1) throw new ConflictException({ code: 'capacity_below_reserved' });
    await this.audit('slot.updated', actorId, companyId, listingId, { slotId, ...input });
    return this.db.slot.findUniqueOrThrow({ where: { id: slotId } });
  }

  // ------------------------------------------------------------------ public

  /** Bookable, published listing of a verified company, or 404. */
  async publicBookableListing(listingId: string) {
    const l = await this.db.listing.findFirst({
      where: { id: listingId, status: 'PUBLISHED', company: { status: 'APPROVED' }, bookingMode: { not: 'DISCOVERY_ONLY' } },
      include: { rates: true },
    });
    if (!l) throw new NotFoundException();
    return l;
  }

  async publicAvailability(listingId: string) {
    const listing = await this.publicBookableListing(listingId);
    // Free seats from lapsed holds before reporting what is left.
    await expireDueHolds(this.db);
    const slots = await this.db.slot.findMany({
      where: { listingId, status: 'OPEN', startsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
      take: 100,
    });
    return { listing, slots };
  }
}
