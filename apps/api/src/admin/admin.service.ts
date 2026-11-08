import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CompanyStatus, PrismaClient, ReviewDecision } from '@triphub/database';
import { PRISMA } from '../database/database.module';

const NEXT_STATUS: Record<ReviewDecision, CompanyStatus> = {
  APPROVED: 'APPROVED',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  REJECTED: 'REJECTED',
};

@Injectable()
export class AdminService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  listCompanies(status: CompanyStatus) {
    return this.db.company.findMany({
      where: { status },
      orderBy: { submittedAt: 'asc' },
      select: { id: true, slug: true, name: true, status: true, city: true, categories: true, submittedAt: true },
    });
  }

  async getCompany(id: string) {
    const company = await this.db.company.findUnique({
      where: { id },
      include: { reviews: { orderBy: { createdAt: 'desc' } } },
    });
    if (!company) throw new NotFoundException();
    return company;
  }

  async review(companyId: string, reviewerId: string, decision: ReviewDecision, reason: string | undefined) {
    // Conflict of interest: staff cannot decide on a company they belong to.
    const isMember = await this.db.membership.count({ where: { companyId, userId: reviewerId, status: 'ACTIVE' } });
    if (isMember) throw new ForbiddenException({ code: 'conflict_of_interest' });

    const exists = await this.db.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!exists) throw new NotFoundException();

    return this.db.$transaction(async (tx) => {
      // Atomic: only a company still PENDING_REVIEW can be decided, and only once.
      const res = await tx.company.updateMany({
        where: { id: companyId, status: 'PENDING_REVIEW' },
        data: {
          status: NEXT_STATUS[decision],
          ...(decision === 'APPROVED' ? { approvedAt: new Date() } : {}),
        },
      });
      if (res.count !== 1) throw new ConflictException({ code: 'not_pending_review' });
      await tx.companyReview.create({ data: { companyId, reviewerId, decision, reason } });
      await tx.auditEvent.create({
        data: {
          action: `company.review.${decision.toLowerCase()}`,
          actorId: reviewerId,
          companyId,
          entityType: 'company',
          entityId: companyId,
          meta: { reason: reason ?? null },
        },
      });
      return tx.company.findUniqueOrThrow({ where: { id: companyId } });
    });
  }
}
