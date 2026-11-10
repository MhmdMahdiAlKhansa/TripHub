import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient, Session, User } from '@triphub/database';
import { PRISMA } from '../database/database.module';
import { AuthService } from './auth.service';
import type { RequestCtx } from './auth.service';

/**
 * Customer privacy tools. Export returns everything we hold about the account. Deletion ANONYMISES the
 * account: bookings, payments and the ledger must be kept (financial and legal record-keeping, and the
 * business's own records), but they no longer point to a person, and the login can never be used again.
 */
@Injectable()
export class PrivacyService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async export(user: User) {
    const [bookings, payments, reviews, favorites, waitlist, notifications, memberships, audit, sessions] = await Promise.all([
      this.db.booking.findMany({ where: { customerId: user.id }, select: { reference: true, status: true, quantity: true, currency: true, totalMinor: true, contactName: true, contactPhone: true, createdAt: true, cancelledAt: true, cancelReason: true } }),
      this.db.payment.findMany({ where: { customerId: user.id }, select: { id: true, bookingId: true, method: true, amountMinor: true, currency: true, status: true, submittedAt: true } }),
      this.db.review.findMany({ where: { customerId: user.id }, select: { listingId: true, rating: true, comment: true, status: true, createdAt: true } }),
      this.db.favorite.findMany({ where: { userId: user.id }, select: { listingId: true } }),
      this.db.waitlistEntry.findMany({ where: { customerId: user.id }, select: { slotId: true, seats: true, status: true, createdAt: true } }),
      this.db.notification.findMany({ where: { userId: user.id }, select: { kind: true, readAt: true, createdAt: true } }),
      this.db.membership.findMany({ where: { userId: user.id }, select: { companyId: true, role: true, status: true } }),
      this.db.auditEvent.findMany({ where: { actorId: user.id }, orderBy: { at: 'desc' }, take: 500, select: { at: true, action: true, entityType: true } }),
      this.db.session.count({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      account: { id: user.id, email: user.email, emailVerified: !!user.emailVerifiedAt, displayName: user.displayName, locale: user.locale, createdAt: user.createdAt, googleLinked: !!user.googleSub, twoStepEnabled: !!user.mfaEnabledAt, hasPassword: !!user.passwordHash },
      bookings: bookings.map((b) => ({ ...b, totalMinor: b.totalMinor.toString() })),
      payments: payments.map((p) => ({ ...p, amountMinor: p.amountMinor.toString() })),
      reviews,
      favorites,
      waitlist,
      notifications,
      memberships,
      activeSessions: sessions,
      recentActivity: audit,
      notIncluded: 'Passwords, session tokens and two-step secrets are never exported. Financial records are summarised, not duplicated.',
    };
  }

  async deleteAccount(user: User, session: Session, input: { password?: string; code?: string }, ctx: RequestCtx) {
    if (user.platformRole !== 'NONE') throw new ConflictException({ code: 'staff_account', message: 'Platform staff accounts must be removed by an administrator.' });
    if (user.passwordHash) {
      if (!input.password) throw new UnauthorizedException('Invalid credentials');
      await this.auth.stepUp(user, session.id, input.password, input.code, ctx); // throws on wrong password / code
    } else if (Date.now() - session.createdAt.getTime() > 10 * 60_000) {
      // Google-only accounts have no password: require a fresh sign-in instead.
      throw new UnauthorizedException({ code: 'recent_login_required', message: 'Sign in again, then retry within 10 minutes.' });
    }
    const owners = await this.db.membership.findMany({ where: { userId: user.id, role: 'OWNER', status: 'ACTIVE' }, select: { companyId: true } });
    for (const m of owners) {
      const others = await this.db.membership.count({ where: { companyId: m.companyId, role: 'OWNER', status: 'ACTIVE', userId: { not: user.id } } });
      if (others === 0) throw new ConflictException({ code: 'sole_owner', message: 'You are the only owner of a business. Transfer ownership first.' });
    }
    const open = await this.db.booking.count({ where: { customerId: user.id, OR: [{ status: { in: ['HELD', 'REQUESTED'] } }, { status: 'CONFIRMED', slot: { startsAt: { gt: new Date() } } }] } });
    if (open > 0) throw new ConflictException({ code: 'open_bookings', message: 'You have bookings that are not finished. Cancel them or wait until they are completed.' });
    if ((await this.db.waitlistEntry.count({ where: { customerId: user.id, status: 'OFFERED' } })) > 0) throw new ConflictException({ code: 'open_offer', message: 'Answer your waitlist offer first.' });

    const now = new Date();
    await this.db.$transaction([
      this.db.waitlistEntry.updateMany({ where: { customerId: user.id, status: 'WAITING' }, data: { status: 'CANCELLED', resolvedAt: now } }),
      this.db.booking.updateMany({ where: { customerId: user.id }, data: { contactName: null, contactPhone: null } }),
      this.db.review.updateMany({ where: { customerId: user.id }, data: { comment: null } }),
      this.db.favorite.deleteMany({ where: { userId: user.id } }),
      this.db.notification.deleteMany({ where: { userId: user.id } }),
      this.db.userToken.deleteMany({ where: { userId: user.id } }),
      this.db.loginCode.deleteMany({ where: { userId: user.id } }),
      this.db.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
      this.db.membership.updateMany({ where: { userId: user.id, status: 'ACTIVE' }, data: { status: 'REMOVED' } }),
      this.db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
      this.db.user.update({ where: { id: user.id }, data: { status: 'DELETED', email: `deleted-${user.id}@deleted.invalid`, displayName: null, passwordHash: null, googleSub: null, mfaSecretEnc: null, mfaEnabledAt: null, emailVerifiedAt: null } }),
      this.db.emailOutbox.deleteMany({ where: { toEmail: user.email } }),
    ]);
    await this.db.auditEvent.create({ data: { actorId: user.id, action: 'account.deleted', entityType: 'user', entityId: user.id, requestId: ctx.requestId ?? null, meta: {} } });
  }
}
