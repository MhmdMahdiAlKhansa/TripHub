import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CompanyRole } from '@triphub/shared';
import { Prisma, type Company, type PrismaClient, type User } from '@triphub/database';
import { newToken, sha256 } from '../auth/crypto';
import { MAILER, type Mailer } from '../auth/mailer';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PRISMA } from '../database/database.module';

const INVITE_DAYS = 7;

export class InvalidInvitationError extends Error {}

@Injectable()
export class TenancyService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(SubscriptionsService) private readonly subs: SubscriptionsService,
  ) {}

  private audit(action: string, actorId: string, companyId: string, entityId: string, meta: object = {}) {
    return this.db.auditEvent.create({
      data: { action, actorId, companyId, entityType: 'company', entityId, meta },
    });
  }

  async createCompany(user: User, name: string, slug: string) {
    try {
      const company = await this.db.$transaction(async (tx) => {
        const c = await tx.company.create({ data: { name, slug } });
        await tx.membership.create({ data: { companyId: c.id, userId: user.id, role: 'OWNER' } });
        return c;
      });
      await this.audit('company.created', user.id, company.id, company.id);
      return company;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ code: 'slug_taken' });
      }
      throw e;
    }
  }

  listMine(userId: string) {
    return this.db.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { company: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  getCompany(companyId: string): Promise<Company> {
    return this.db.company.findUniqueOrThrow({ where: { id: companyId } });
  }

  listMembers(companyId: string) {
    return this.db.membership.findMany({
      where: { companyId, status: 'ACTIVE' },
      include: { user: { select: { id: true, email: true, displayName: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async invite(companyId: string, actorId: string, email: string, role: CompanyRole) {
    await this.subs.assertCanAddTeamMember(companyId);
    const existing = await this.db.membership.findFirst({
      where: { companyId, status: 'ACTIVE', user: { email } },
    });
    if (existing) throw new ConflictException({ code: 'already_member' });

    const token = newToken();
    await this.db.$transaction([
      // Only one live invitation per email per company.
      this.db.invitation.updateMany({
        where: { companyId, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.db.invitation.create({
        data: {
          companyId,
          email,
          role,
          invitedBy: actorId,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
        },
      }),
    ]);
    await this.audit('team.invited', actorId, companyId, companyId, { role });
    await this.mailer.send({ to: email, template: 'company-invitation', token });
  }

  /** Token is single-use and bound to the invited (verified) email address. */
  async acceptInvitation(user: User, token: string) {
    const hash = sha256(token);
    const inv = await this.db.invitation.findUnique({ where: { tokenHash: hash } });
    if (!inv || inv.email !== user.email || !user.emailVerifiedAt) throw new InvalidInvitationError();

    const claimed = await this.db.invitation.updateMany({
      where: { id: inv.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw new InvalidInvitationError();

    const membership = await this.db.membership.upsert({
      where: { companyId_userId: { companyId: inv.companyId, userId: user.id } },
      create: { companyId: inv.companyId, userId: user.id, role: inv.role },
      update: { role: inv.role, status: 'ACTIVE' },
    });
    await this.audit('team.invitation_accepted', user.id, inv.companyId, membership.id, { role: inv.role });
    return membership;
  }

  private async findMember(companyId: string, memberId: string) {
    // Scoped by company: another tenant's membership id resolves to 404.
    const m = await this.db.membership.findFirst({ where: { id: memberId, companyId, status: 'ACTIVE' } });
    if (!m) throw new NotFoundException();
    return m;
  }

  private mapLastOwner(e: unknown): never {
    if (e instanceof Error && /last owner/i.test(e.message)) {
      throw new ConflictException({ code: 'last_owner' });
    }
    throw e;
  }

  async changeRole(companyId: string, actorId: string, memberId: string, role: CompanyRole) {
    const m = await this.findMember(companyId, memberId);
    try {
      await this.db.membership.update({ where: { id: m.id }, data: { role } });
    } catch (e) {
      this.mapLastOwner(e);
    }
    await this.audit('team.role_changed', actorId, companyId, m.id, { from: m.role, to: role });
  }

  async removeMember(companyId: string, actorId: string, memberId: string) {
    const m = await this.findMember(companyId, memberId);
    try {
      await this.db.membership.update({ where: { id: m.id }, data: { status: 'REMOVED' } });
    } catch (e) {
      this.mapLastOwner(e);
    }
    await this.audit('team.member_removed', actorId, companyId, m.id, { role: m.role });
  }
}
