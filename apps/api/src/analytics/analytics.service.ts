import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@triphub/database';
import { PLANS, type PlanCode } from '@triphub/shared';
import { PRISMA } from '../database/database.module';

const DAY = 86_400_000;
export const MAX_RANGE_DAYS = 366;

/** Business analytics. Everything is scoped to one company and computed from stored records. */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  private async level(companyId: string): Promise<'basic' | 'advanced'> {
    const s = await this.db.subscription.findUnique({ where: { companyId }, select: { planCode: true } });
    const caps = s ? PLANS[s.planCode as PlanCode].capabilities : [];
    return caps.some((c) => c === 'analytics.advanced' || c === 'analytics.full') ? 'advanced' : 'basic';
  }

  async summary(companyId: string, from: Date, to: Date) {
    const level = await this.level(companyId);
    const range = { companyId, createdAt: { gte: from, lt: to } };

    const [byStatus, seats, value, verified, checkedIn, delivered, reviews] = await Promise.all([
      this.db.booking.groupBy({ by: ['status'], where: range, _count: true }),
      this.db.booking.aggregate({ where: { ...range, status: { in: ['CONFIRMED', 'COMPLETED'] } }, _sum: { quantity: true } }),
      this.db.booking.groupBy({ by: ['currency'], where: { ...range, status: { in: ['CONFIRMED', 'COMPLETED'] } }, _sum: { totalMinor: true } }),
      this.db.payment.groupBy({ by: ['currency'], where: { status: 'VERIFIED', booking: range }, _sum: { amountMinor: true } }),
      this.db.booking.count({ where: { ...range, status: { in: ['CONFIRMED', 'COMPLETED'] }, checkedInAt: { not: null } } }),
      this.db.booking.count({ where: { ...range, status: { in: ['CONFIRMED', 'COMPLETED'] }, slot: { startsAt: { lt: new Date() } } } }),
      this.db.review.aggregate({ where: { companyId, status: 'VISIBLE', createdAt: { gte: from, lt: to } }, _avg: { rating: true }, _count: true }),
    ]);

    const out: Record<string, unknown> = {
      level,
      range: { from, to },
      bookingsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count])),
      seatsBooked: seats._sum.quantity ?? 0,
      // Booked value is what customers committed to; verified payments is money platform finance actually confirmed.
      bookedValueMinor: Object.fromEntries(value.map((r) => [r.currency, (r._sum.totalMinor ?? 0n).toString()])),
      verifiedPaymentsMinor: Object.fromEntries(verified.map((r) => [r.currency, (r._sum.amountMinor ?? 0n).toString()])),
      checkIn: { checkedIn, tripsAlreadyStarted: delivered },
      reviews: { count: reviews._count, average: reviews._avg.rating === null ? null : Math.round(reviews._avg.rating * 10) / 10 },
    };

    if (level === 'advanced') {
      const daily = await this.db.$queryRaw<Array<{ day: string; bookings: bigint; seats: bigint }>>`
        SELECT to_char(("createdAt" AT TIME ZONE 'Asia/Beirut')::date, 'YYYY-MM-DD') AS day,
               count(*)::bigint AS bookings, COALESCE(sum("quantity"), 0)::bigint AS seats
          FROM "booking"
         WHERE "companyId" = ${companyId}::uuid AND "createdAt" >= ${from} AND "createdAt" < ${to}
           AND "status" IN ('CONFIRMED', 'COMPLETED')
         GROUP BY 1 ORDER BY 1`;
      const top = await this.db.$queryRaw<Array<{ listingId: string; title: string | null; bookings: bigint; seats: bigint }>>`
        SELECT b."listingId", (SELECT t.title FROM "listing_translation" t WHERE t."listingId" = b."listingId" ORDER BY (t.locale = 'en') DESC LIMIT 1) AS title,
               count(*)::bigint AS bookings, COALESCE(sum(b."quantity"), 0)::bigint AS seats
          FROM "booking" b
         WHERE b."companyId" = ${companyId}::uuid AND b."createdAt" >= ${from} AND b."createdAt" < ${to}
           AND b."status" IN ('CONFIRMED', 'COMPLETED')
         GROUP BY b."listingId" ORDER BY seats DESC, bookings DESC LIMIT 10`;
      out.daily = daily.map((d) => ({ day: d.day, bookings: Number(d.bookings), seats: Number(d.seats) }));
      out.topListings = top.map((t) => ({ listingId: t.listingId, title: t.title, bookings: Number(t.bookings), seats: Number(t.seats) }));
    }
    return out;
  }
}

export function parseRange(fromRaw?: string, toRaw?: string, now = new Date()): { from: Date; to: Date } | null {
  const to = toRaw ? new Date(toRaw) : now;
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 30 * DAY);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (from >= to || to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY) return null;
  return { from, to };
}
