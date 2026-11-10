import { ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient, Session, User } from '@triphub/database';
import { randomInt, timingSafeEqual } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { PRISMA } from '../database/database.module';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  newRecoveryCode,
  newToken,
  sha256,
  verifyPassword,
} from './crypto';
import { MAILER, type Mailer } from './mailer';

export const SESSION_DAYS = 14;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
export const STEP_UP_MINUTES = 10;
const VERIFY_TOKEN_HOURS = 24;
const RESET_TOKEN_MINUTES = 60;
const RECOVERY_CODE_COUNT = 8;
const TOTP_PERIOD = 30;
const day = 86_400_000;

export interface RequestCtx {
  userAgent?: string;
  ipHash?: string;
  requestId?: string;
}

export class InvalidTokenError extends Error {}

export interface AuthContext {
  user: User;
  session: Session;
}

@Injectable()
export class AuthService {
  /** Dummy hash so unknown-email logins cost the same as real ones (timing). */
  private dummyHash: Promise<string>;

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {
    this.dummyHash = hashPassword('dummy-password-for-timing');
  }

  private audit(action: string, ctx: RequestCtx, actorId?: string, meta: object = {}) {
    return this.db.auditEvent.create({
      data: {
        action,
        entityType: 'user',
        entityId: actorId,
        actorId,
        requestId: ctx.requestId,
        ipHash: ctx.ipHash,
        meta,
      },
    });
  }

  private async issueToken(userId: string, type: 'EMAIL_VERIFY' | 'PASSWORD_RESET', ttlMs: number) {
    const token = newToken();
    await this.db.userToken.create({
      data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  /**
   * Simple sign-up for local testing: email + password, signed in at once, no email check. Never in production.
   * The account stays marked UNVERIFIED (so invitations, code sign-in and notification emails still need a real check).
   */
  static simpleSignup() {
    return process.env.SIMPLE_SIGNUP === '1' && process.env.NODE_ENV !== 'production';
  }

  async registerSimple(email: string, password: string, displayName: string | undefined, ctx: RequestCtx): Promise<{ token: string; user: User }> {
    const passwordHash = await hashPassword(password);
    if (await this.db.user.findUnique({ where: { email } })) throw new ConflictException({ code: 'email_taken', message: 'This email is already registered.' });
    const user = await this.db.user.create({ data: { email, passwordHash, displayName } });
    await this.audit('auth.register', ctx, user.id, { simple: true });
    return this.createSession(user, false, ctx, 'auth.login');
  }

  /** Always resolves the same way whether or not the email exists (no account enumeration). */
  async register(email: string, password: string, displayName: string | undefined, ctx: RequestCtx) {
    const passwordHash = await hashPassword(password);
    const existing = await this.db.user.findUnique({ where: { email } });
    if (existing) {
      await this.audit('auth.register.duplicate', ctx, existing.id);
      return;
    }
    const user = await this.db.user.create({ data: { email, passwordHash, displayName } });
    const token = await this.issueToken(user.id, 'EMAIL_VERIFY', VERIFY_TOKEN_HOURS * 3_600_000);
    await this.audit('auth.register', ctx, user.id);
    await this.mailer.send({ to: email, template: 'verify-email', token });
  }

  private async consumeToken(token: string, type: 'EMAIL_VERIFY' | 'PASSWORD_RESET'): Promise<string> {
    // Atomic single-use: only one concurrent caller can flip usedAt from null.
    const res = await this.db.userToken.updateMany({
      where: { tokenHash: sha256(token), type, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (res.count !== 1) throw new InvalidTokenError();
    const row = await this.db.userToken.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    return row.userId;
  }

  async verifyEmail(token: string, ctx: RequestCtx) {
    const userId = await this.consumeToken(token, 'EMAIL_VERIFY');
    await this.db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    await this.audit('auth.email_verified', ctx, userId);
  }

  // ---------------------------------------------------------------- failures / lockout

  private async recordFailure(user: User, ctx: RequestCtx, action = 'auth.login.failed') {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await this.db.user.update({
      where: { id: user.id },
      data: {
        failedLogins: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });
    await this.audit(lock ? 'auth.login.lockout' : action, ctx, user.id);
  }

  // ---------------------------------------------------------------- login

  async login(
    email: string,
    password: string,
    code: string | undefined,
    ctx: RequestCtx,
  ): Promise<{ token: string; user: User }> {
    const user = await this.db.user.findUnique({ where: { email } });
    const now = new Date();

    if (!user?.passwordHash) {
      await verifyPassword(await this.dummyHash, password);
      await this.audit('auth.login.failed', ctx, undefined, { reason: 'unknown' });
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.audit('auth.login.locked', ctx, user.id);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      await this.recordFailure(user, ctx);
      throw new UnauthorizedException('Invalid credentials');
    }
    // Same response as bad credentials: do not reveal that the password was right.
    if ((!user.emailVerifiedAt && !AuthService.simpleSignup()) || user.status !== 'ACTIVE') {
      await this.audit('auth.login.blocked', ctx, user.id, { reason: 'unverified_or_inactive' });
      throw new UnauthorizedException('Invalid credentials');
    }

    let mfaVerified = false;
    if (user.mfaEnabledAt) {
      if (!code) throw new UnauthorizedException({ code: 'mfa_required', message: 'Second factor required' });
      if (!(await this.verifySecondFactor(user, code))) {
        await this.recordFailure(user, ctx, 'auth.login.mfa_failed');
        throw new UnauthorizedException('Invalid credentials');
      }
      mfaVerified = true;
    }

    await this.db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    return this.createSession(user, mfaVerified, ctx, 'auth.login');
  }

  /** Starts a server-side session (the cookie value is returned once; only its hash is stored). */
  async createSession(user: User, mfaVerified: boolean, ctx: RequestCtx, auditAction: string): Promise<{ token: string; user: User }> {
    const now = new Date();
    const token = newToken();
    await this.db.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        userAgent: ctx.userAgent?.slice(0, 255),
        ipHash: ctx.ipHash,
        mfaVerifiedAt: mfaVerified ? now : null,
        expiresAt: new Date(now.getTime() + SESSION_DAYS * day),
      },
    });
    await this.audit(auditAction, ctx, user.id, { mfa: mfaVerified });
    return { token, user };
  }

  async authenticate(token: string): Promise<AuthContext | null> {
    const session = await this.db.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    if (session.user.status !== 'ACTIVE') return null;
    const { user, ...rest } = session;
    return { user, session: rest as Session };
  }

  async logout(token: string, ctx: RequestCtx) {
    const res = await this.db.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count) await this.audit('auth.logout', ctx);
  }

  // ---------------------------------------------------------------- email sign-in code

  private codeHash(userId: string, code: string) {
    return sha256(`${userId}:${code}`);
  }

  /** Always behaves the same to the caller. Sends a 6-digit code only to verified, active accounts without two-step verification. */
  async requestLoginCode(email: string, ctx: RequestCtx) {
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt || user.mfaEnabledAt) return;
    const last = await this.db.loginCode.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
    if (last && Date.now() - last.createdAt.getTime() < 60_000) return; // one per minute
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.$transaction([
      this.db.loginCode.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: new Date() } }),
      this.db.loginCode.create({ data: { userId: user.id, codeHash: this.codeHash(user.id, code), expiresAt: new Date(Date.now() + 10 * 60_000) } }),
    ]);
    await this.audit('auth.login_code.requested', ctx, user.id);
    await this.mailer.send({ to: email, template: 'login-code', token: code });
  }

  async loginWithCode(email: string, code: string, ctx: RequestCtx): Promise<{ token: string; user: User }> {
    const fail = (): never => { throw new UnauthorizedException('Invalid or expired code'); };
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt || user.mfaEnabledAt) return fail();
    const row = await this.db.loginCode.findFirst({ where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!row || row.attempts >= 5) return fail();
    // Count the try first so parallel guesses cannot exceed the limit.
    const tried = await this.db.loginCode.updateMany({ where: { id: row.id, attempts: { lt: 5 }, consumedAt: null }, data: { attempts: { increment: 1 } } });
    if (tried.count !== 1) return fail();
    const a = Buffer.from(this.codeHash(user.id, code));
    const b = Buffer.from(row.codeHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      await this.audit('auth.login_code.failed', ctx, user.id);
      return fail();
    }
    const used = await this.db.loginCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (used.count !== 1) return fail();
    return this.createSession(user, false, ctx, 'auth.login.code');
  }

  // ---------------------------------------------------------------- password reset

  async requestPasswordReset(email: string, ctx: RequestCtx) {
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;
    const token = await this.issueToken(user.id, 'PASSWORD_RESET', RESET_TOKEN_MINUTES * 60_000);
    await this.audit('auth.password_reset.requested', ctx, user.id);
    await this.mailer.send({ to: email, template: 'password-reset', token });
  }

  async resetPassword(token: string, newPassword: string, ctx: RequestCtx) {
    const userId = await this.consumeToken(token, 'PASSWORD_RESET');
    const passwordHash = await hashPassword(newPassword);
    await this.db.$transaction([
      this.db.user.update({
        where: { id: userId },
        data: { passwordHash, failedLogins: 0, lockedUntil: null, emailVerifiedAt: new Date() },
      }),
      // A reset invalidates every existing session.
      this.db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit('auth.password_reset.completed', ctx, userId);
  }

  // ---------------------------------------------------------------- MFA (TOTP)

  private totp(secretBase32: string, email: string) {
    return new OTPAuth.TOTP({
      issuer: 'TripHub',
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: TOTP_PERIOD,
      secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
  }

  /** Starts enrolment. The secret is stored encrypted and is inactive until confirmed. */
  async mfaSetup(user: User, ctx: RequestCtx) {
    if (user.mfaEnabledAt) throw new ConflictException({ code: 'mfa_already_enabled' });
    const secret = new OTPAuth.Secret({ size: 20 });
    await this.db.user.update({ where: { id: user.id }, data: { mfaSecretEnc: encryptSecret(secret.base32) } });
    await this.audit('auth.mfa.setup_started', ctx, user.id);
    return { secret: secret.base32, otpauthUrl: this.totp(secret.base32, user.email).toString() };
  }

  /** Validates a TOTP code and enforces one-time use per 30s step (replay protection). */
  private async checkTotp(user: User, code: string): Promise<boolean> {
    if (!user.mfaSecretEnc || !/^\d{6}$/.test(code)) return false;
    const delta = this.totp(decryptSecret(user.mfaSecretEnc), user.email).validate({ token: code, window: 1 });
    if (delta === null) return false;
    const step = Math.floor(Date.now() / 1000 / TOTP_PERIOD) + delta;
    // Atomic: only a strictly newer step than the last accepted one succeeds.
    const res = await this.db.user.updateMany({
      where: { id: user.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
      data: { mfaLastStep: step },
    });
    return res.count === 1;
  }

  private async checkRecoveryCode(user: User, code: string): Promise<boolean> {
    const normalized = code.trim().toLowerCase();
    if (!/^[0-9a-f]{5}(-[0-9a-f]{5}){3}$/.test(normalized)) return false;
    const res = await this.db.mfaRecoveryCode.updateMany({
      where: { userId: user.id, codeHash: sha256(normalized), usedAt: null },
      data: { usedAt: new Date() },
    });
    return res.count === 1;
  }

  private async verifySecondFactor(user: User, code: string): Promise<boolean> {
    return (await this.checkTotp(user, code.trim())) || (await this.checkRecoveryCode(user, code));
  }

  async mfaEnable(user: User, code: string, sessionId: string, ctx: RequestCtx) {
    if (user.mfaEnabledAt) throw new ConflictException({ code: 'mfa_already_enabled' });
    if (!user.mfaSecretEnc || !(await this.checkTotp(user, code.trim()))) {
      throw new UnauthorizedException('Invalid code');
    }
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await this.db.$transaction([
      this.db.user.update({ where: { id: user.id }, data: { mfaEnabledAt: new Date() } }),
      this.db.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
      this.db.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ userId: user.id, codeHash: sha256(c) })) }),
      // Enabling MFA ends every other session; this one is now MFA-verified.
      this.db.session.updateMany({
        where: { userId: user.id, revokedAt: null, id: { not: sessionId } },
        data: { revokedAt: new Date() },
      }),
      this.db.session.update({ where: { id: sessionId }, data: { mfaVerifiedAt: new Date() } }),
    ]);
    await this.audit('auth.mfa.enabled', ctx, user.id);
    return { recoveryCodes: codes };
  }

  async mfaDisable(user: User, password: string, code: string, ctx: RequestCtx) {
    if (!user.mfaEnabledAt) throw new ConflictException({ code: 'mfa_not_enabled' });
    const ok =
      !!user.passwordHash && (await verifyPassword(user.passwordHash, password)) && (await this.verifySecondFactor(user, code));
    if (!ok) {
      await this.recordFailure(user, ctx, 'auth.mfa.disable_failed');
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.db.$transaction([
      this.db.user.update({
        where: { id: user.id },
        data: { mfaEnabledAt: null, mfaSecretEnc: null, mfaLastStep: null },
      }),
      this.db.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
    ]);
    await this.audit('auth.mfa.disabled', ctx, user.id);
  }

  // ---------------------------------------------------------------- sessions & step-up

  listSessions(userId: string) {
    return this.db.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string, ctx: RequestCtx) {
    // Scoped to the caller: another user's session id behaves as not found.
    const res = await this.db.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count !== 1) throw new NotFoundException();
    await this.audit('auth.session.revoked', ctx, userId);
  }

  async revokeOtherSessions(userId: string, currentSessionId: string, ctx: RequestCtx) {
    const res = await this.db.session.updateMany({
      where: { userId, revokedAt: null, id: { not: currentSessionId } },
      data: { revokedAt: new Date() },
    });
    await this.audit('auth.session.revoked_others', ctx, userId, { count: res.count });
    return res.count;
  }

  /** Re-authenticates for sensitive actions: password, plus a second factor when MFA is on. */
  async stepUp(user: User, sessionId: string, password: string, code: string | undefined, ctx: RequestCtx) {
    const passOk = !!user.passwordHash && (await verifyPassword(user.passwordHash, password));
    let ok = passOk;
    if (ok && user.mfaEnabledAt) ok = !!code && (await this.verifySecondFactor(user, code));
    if (!ok) {
      await this.recordFailure(user, ctx, 'auth.step_up.failed');
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.db.session.update({ where: { id: sessionId }, data: { stepUpAt: new Date() } });
    await this.audit('auth.step_up', ctx, user.id);
  }
}
