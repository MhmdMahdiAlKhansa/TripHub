import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@triphub/database';
import { PRISMA } from '../database/database.module';

@Injectable()
export class ContentService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /** Staff pick which published experiences are featured on the home page. A hidden listing is never featured. */
  async setFeatured(staffId: string, listingId: string, featured: boolean) {
    const l = await this.db.listing.findUnique({ where: { id: listingId }, include: { company: { select: { status: true } } } });
    if (!l) throw new NotFoundException();
    if (featured && (l.status !== 'PUBLISHED' || l.company.status !== 'APPROVED')) throw new ConflictException({ code: 'listing_not_public' });
    const updated = await this.db.listing.update({ where: { id: listingId }, data: { featuredAt: featured ? new Date() : null } });
    await this.db.auditEvent.create({
      data: { action: featured ? 'listing.featured' : 'listing.unfeatured', actorId: staffId, companyId: l.companyId, entityType: 'listing', entityId: listingId, meta: {} },
    });
    return updated;
  }

  /** The rate in force now, or null when staff have not set one (the site then shows no LBP estimate). */
  currentRate() {
    return this.db.exchangeRate.findFirst({ where: { effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' } });
  }

  async setRate(staffId: string, lbpPerUsd: number, source: string) {
    const row = await this.db.exchangeRate.create({ data: { lbpPerUsd, source, createdBy: staffId } });
    await this.db.auditEvent.create({
      data: { action: 'fx.rate_set', actorId: staffId, entityType: 'exchange_rate', entityId: row.id, meta: { lbpPerUsd, source } },
    });
    return row;
  }

  history() {
    return this.db.exchangeRate.findMany({ orderBy: { effectiveFrom: 'desc' }, take: 50 });
  }
}
