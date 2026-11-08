import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { expireHoldsAndPromote, leaveWaitlist, promoteWaitlist, Prisma, type PrismaClient } from '@triphub/database';
import { PRISMA } from '../database/database.module';

const BOOKABLE_MODES = ['FIXED_DATE', 'TIME_SLOT'];

@Injectable()
export class WaitlistService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /** Join the queue for a slot that cannot take these seats right now. No money is involved yet. */
  async join(customerId: string, slotId: string, seats: number) {
    const slot = await this.db.slot.findFirst({
      where: { id: slotId, listing: { status: 'PUBLISHED', company: { status: 'APPROVED' } } },
      include: { listing: true },
    });
    if (!slot || !BOOKABLE_MODES.includes(slot.listing.bookingMode)) throw new NotFoundException();
    if (slot.status !== 'OPEN' || slot.startsAt.getTime() <= Date.now()) throw new ConflictException({ code: 'slot_unavailable' });
    if (seats > slot.capacity) throw new ConflictException({ code: 'exceeds_capacity' });

    await expireHoldsAndPromote(this.db, { slotId });
    const fresh = await this.db.slot.findUniqueOrThrow({ where: { id: slotId } });
    const queued = await this.db.waitlistEntry.count({ where: { slotId, status: 'WAITING' } });
    // If the seats are free and nobody is ahead, the customer should simply book.
    if (queued === 0 && fresh.capacity - fresh.reserved >= seats) throw new ConflictException({ code: 'seats_available' });

    try {
      const e = await this.db.waitlistEntry.create({ data: { slotId, customerId, seats } });
      await this.db.auditEvent.create({
        data: { action: 'waitlist.joined', actorId: customerId, companyId: slot.listing.companyId, entityType: 'waitlist_entry', entityId: e.id, meta: { seats } },
      });
      // Seats may have freed between the checks above; the head of the queue is processed immediately.
      await promoteWaitlist(this.db, slotId);
      return this.view(customerId, e.id);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException({ code: 'already_waitlisted' });
      throw err;
    }
  }

  async leave(customerId: string, id: string) {
    if (!(await leaveWaitlist(this.db, id, customerId))) throw new NotFoundException();
  }

  async view(customerId: string, id: string) {
    const e = await this.db.waitlistEntry.findFirst({ where: { id, customerId }, include: { slot: { select: { listingId: true, startsAt: true } } } });
    if (!e) throw new NotFoundException();
    return this.shape(e);
  }

  async mine(customerId: string) {
    const rows = await this.db.waitlistEntry.findMany({
      where: { customerId },
      include: { slot: { select: { listingId: true, startsAt: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return Promise.all(rows.map((e) => this.shape(e)));
  }

  private async shape(e: { id: string; seq: number; slotId: string; seats: number; status: string; offerExpiresAt: Date | null; slot: { listingId: string; startsAt: Date } }) {
    const position = e.status === 'WAITING' ? await this.db.waitlistEntry.count({ where: { slotId: e.slotId, status: 'WAITING', seq: { lte: e.seq } } }) : null;
    const live = e.status === 'OFFERED' && e.offerExpiresAt && e.offerExpiresAt > new Date();
    return {
      id: e.id,
      slotId: e.slotId,
      listingId: e.slot.listingId,
      startsAt: e.slot.startsAt,
      seats: e.seats,
      status: e.status,
      position,
      offerExpiresAt: e.status === 'OFFERED' ? e.offerExpiresAt : null,
      // An offer is only a time-limited right to book at the current price: nothing is booked or charged.
      state: e.status === 'WAITING' ? 'waiting' : live ? 'offer_available' : e.status === 'OFFERED' || e.status === 'EXPIRED' ? 'offer_expired' : e.status === 'CONVERTED' ? 'booked' : 'cancelled',
    };
  }
}
