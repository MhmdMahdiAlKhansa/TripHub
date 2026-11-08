import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@triphub/database';
import { PRISMA } from '../database/database.module';
import { ListingsService, publicListing } from '../listings/listings.service';

@Injectable()
export class EngagementService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(ListingsService) private readonly listings: ListingsService,
  ) {}

  // ------------------------------------------------------------------ favorites

  async addFavorite(userId: string, listingId: string) {
    await this.listings.getPublic(listingId); // 404 unless publicly visible
    await this.db.favorite.upsert({ where: { userId_listingId: { userId, listingId } }, create: { userId, listingId }, update: {} });
  }

  async removeFavorite(userId: string, listingId: string) {
    await this.db.favorite.deleteMany({ where: { userId, listingId } });
  }

  async listFavorites(userId: string, locale: 'en' | 'ar') {
    const rows = await this.db.favorite.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
    const out = [];
    for (const f of rows) {
      try {
        out.push(publicListing(await this.listings.getPublic(f.listingId), locale));
      } catch (e) {
        if (!(e instanceof NotFoundException)) throw e; // no longer public: quietly hidden, not deleted
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ reviews

  /** Reviews are tied to a completed booking, once, and cannot be edited afterwards. */
  async createReview(customerId: string, bookingId: string, input: { rating: number; comment?: string }) {
    const b = await this.db.booking.findFirst({ where: { id: bookingId, customerId } });
    if (!b) throw new NotFoundException();
    if (b.status !== 'COMPLETED') throw new ConflictException({ code: 'booking_not_completed', status: b.status });
    try {
      const r = await this.db.review.create({
        data: { bookingId, listingId: b.listingId, companyId: b.companyId, customerId, rating: input.rating, comment: input.comment ?? null },
      });
      await this.db.auditEvent.create({
        data: { action: 'review.created', actorId: customerId, companyId: b.companyId, entityType: 'review', entityId: r.id, meta: { rating: input.rating } },
      });
      return r;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException({ code: 'already_reviewed' });
      throw e;
    }
  }

  async publicReviews(listingId: string, limit = 20) {
    await this.listings.getPublic(listingId);
    const where = { listingId, status: 'VISIBLE' as const };
    const [agg, rows] = await Promise.all([
      this.db.review.aggregate({ where, _avg: { rating: true }, _count: true }),
      this.db.review.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, include: { customer: { select: { displayName: true } } } }),
    ]);
    return {
      summary: { count: agg._count, average: agg._avg.rating === null ? null : Math.round(agg._avg.rating * 10) / 10 },
      reviews: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        // Every review comes from a completed booking, so this is always true; shown so the claim is explicit.
        verifiedBooking: true,
        author: (r.customer.displayName ?? 'Traveller').split(' ')[0],
        createdAt: r.createdAt,
      })),
    };
  }

  reviewsForCompany(companyId: string) {
    return this.db.review.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  listForModeration(status: 'VISIBLE' | 'HIDDEN') {
    return this.db.review.findMany({ where: { status }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  /** Staff hide or restore a review with a recorded reason. Content is never edited or deleted. */
  async moderate(staffId: string, reviewId: string, status: 'VISIBLE' | 'HIDDEN', reason: string) {
    const r = await this.db.review.findUnique({ where: { id: reviewId } });
    if (!r) throw new NotFoundException();
    if (r.customerId === staffId) throw new ConflictException({ code: 'cannot_moderate_own_review' });
    const updated = await this.db.review.update({
      where: { id: reviewId },
      data: { status, moderationReason: reason, moderatedBy: staffId, moderatedAt: new Date() },
    });
    await this.db.auditEvent.create({
      data: { action: status === 'HIDDEN' ? 'review.hidden' : 'review.restored', actorId: staffId, companyId: r.companyId, entityType: 'review', entityId: reviewId, meta: { reason } },
    });
    return updated;
  }

  // ------------------------------------------------------------------ notifications

  async notifications(userId: string) {
    const [unread, rows] = await Promise.all([
      this.db.notification.count({ where: { userId, readAt: null } }),
      this.db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return { unread, notifications: rows.map((n) => ({ id: n.id, kind: n.kind, data: n.data, read: n.readAt !== null, createdAt: n.createdAt })) };
  }

  async markRead(userId: string, id: string) {
    const r = await this.db.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    if (r.count === 0 && !(await this.db.notification.count({ where: { id, userId } }))) throw new NotFoundException();
  }

  async markAllRead(userId: string) {
    await this.db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  }

  // ------------------------------------------------------------------ profile

  async updateProfile(userId: string, data: { displayName?: string; locale?: 'en' | 'ar' }) {
    return this.db.user.update({ where: { id: userId }, data, select: { id: true, email: true, displayName: true, locale: true } });
  }
}
