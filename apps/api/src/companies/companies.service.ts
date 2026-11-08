import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type Company, type PrismaClient } from '@triphub/database';
import { PRISMA } from '../database/database.module';
import { EDITABLE_STATUSES, missingForSubmission, type ProfileInput } from './profile';

@Injectable()
export class CompaniesService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  private audit(action: string, actorId: string, companyId: string, meta: object = {}) {
    return this.db.auditEvent.create({
      data: { action, actorId, companyId, entityType: 'company', entityId: companyId, meta },
    });
  }

  async getProfile(companyId: string): Promise<Company> {
    const c = await this.db.company.findUnique({ where: { id: companyId } });
    if (!c) throw new NotFoundException();
    return c;
  }

  async updateProfile(companyId: string, actorId: string, input: ProfileInput): Promise<Company> {
    const current = await this.getProfile(companyId);
    if (!EDITABLE_STATUSES.includes(current.status)) {
      throw new ConflictException({ code: 'profile_locked', status: current.status });
    }
    // Identity of an approved company can only change through support, not self-service.
    if (current.status === 'APPROVED' && input.name !== undefined && input.name !== current.name) {
      throw new ConflictException({ code: 'name_locked_after_approval' });
    }

    const { socials, latitude, longitude, ...rest } = input;
    const data: Prisma.CompanyUpdateManyMutationInput = {
      ...rest,
      ...(socials !== undefined ? { socials } : {}),
      ...(latitude !== undefined ? { latitude } : {}),
      ...(longitude !== undefined ? { longitude } : {}),
    };
    // The status guard makes a concurrent submit/suspend win over a stale edit.
    const res = await this.db.company.updateMany({
      where: { id: companyId, status: current.status },
      data,
    });
    if (res.count !== 1) throw new ConflictException({ code: 'profile_locked' });
    await this.audit('company.profile_updated', actorId, companyId, { fields: Object.keys(input) });
    return this.getProfile(companyId);
  }

  async submit(companyId: string, actorId: string): Promise<Company> {
    const c = await this.getProfile(companyId);
    if (c.status !== 'DRAFT' && c.status !== 'CHANGES_REQUESTED') {
      throw new ConflictException({ code: 'cannot_submit_in_status', status: c.status });
    }
    const missing = missingForSubmission(c);
    if (missing.length) throw new UnprocessableEntityException({ code: 'incomplete_profile', missing });

    const res = await this.db.company.updateMany({
      where: { id: companyId, status: { in: ['DRAFT', 'CHANGES_REQUESTED'] } },
      data: { status: 'PENDING_REVIEW', submittedAt: new Date() },
    });
    if (res.count !== 1) throw new ConflictException({ code: 'cannot_submit_in_status' });
    await this.audit('company.submitted', actorId, companyId);
    return this.getProfile(companyId);
  }
}

export const publicProfile = (c: Company) => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  status: c.status,
  description: c.description,
  contactEmail: c.contactEmail,
  phone: c.phone,
  website: c.website,
  city: c.city,
  address: c.address,
  latitude: c.latitude === null ? null : Number(c.latitude),
  longitude: c.longitude === null ? null : Number(c.longitude),
  socials: c.socials,
  categories: c.categories,
  languages: c.languages,
  onboardingStep: c.onboardingStep,
  submittedAt: c.submittedAt,
  approvedAt: c.approvedAt,
});
