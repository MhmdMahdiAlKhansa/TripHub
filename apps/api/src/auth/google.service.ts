import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient, User } from '@triphub/database';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { PRISMA } from '../database/database.module';
import { decryptSecret, encryptSecret } from './crypto';
import { AuthService, type RequestCtx } from './auth.service';

export const OAUTH_COOKIE = 'th_oauth';
const TTL_MS = 10 * 60_000;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  issuers: string[];
}

/** Configuration from the environment. Endpoint overrides (for tests with a mock IdP) are ignored in production. */
export function googleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  const web = (env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0]!.trim();
  const dev = env.NODE_ENV !== 'production';
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI || `${web}/api/v1/auth/google/callback`,
    authUrl: (dev && env.GOOGLE_AUTH_URL) || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: (dev && env.GOOGLE_TOKEN_URL) || 'https://oauth2.googleapis.com/token',
    jwksUrl: (dev && env.GOOGLE_JWKS_URL) || 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: dev && env.GOOGLE_ISSUER ? [env.GOOGLE_ISSUER] : ['https://accounts.google.com', 'accounts.google.com'],
  };
}

export type GoogleFailure = 'google_failed' | 'google_mfa' | 'google_unverified' | 'google_blocked';

interface Pending { s: string; v: string; n: string; l: 'en' | 'ar'; exp: number }
const b64url = (n: number) => randomBytes(n).toString('base64url');

/**
 * "Continue with Google": OpenID Connect authorization-code flow with PKCE, a one-time state and nonce
 * kept in an encrypted short-lived cookie, and the ID token verified (signature, issuer, audience, expiry,
 * nonce) before anything is trusted. Google must assert the email is verified.
 */
@Injectable()
export class GoogleAuthService {
  private readonly log = new Logger('GoogleAuth');
  private jwks?: { url: string; set: ReturnType<typeof createRemoteJWKSet> };

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  enabled() {
    return googleConfig() !== null;
  }

  start(locale: 'en' | 'ar'): { url: string; cookie: string } | null {
    const cfg = googleConfig();
    if (!cfg) return null;
    const verifier = b64url(48);
    const p: Pending = { s: b64url(24), v: verifier, n: b64url(24), l: locale, exp: Date.now() + TTL_MS };
    const url = new URL(cfg.authUrl);
    url.search = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: p.s,
      nonce: p.n,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return { url: url.toString(), cookie: encryptSecret(JSON.stringify(p)) };
  }

  /** Returns the signed-in user and a session token, or a failure code the web app shows a message for. */
  async finish(input: { code?: string; state?: string; error?: string; cookie?: string }, ctx: RequestCtx): Promise<
    { ok: true; token: string; user: User; locale: 'en' | 'ar' } | { ok: false; failure: GoogleFailure; locale: 'en' | 'ar' }
  > {
    const cfg = googleConfig();
    let pending: Pending | null = null;
    try {
      pending = input.cookie ? (JSON.parse(decryptSecret(input.cookie)) as Pending) : null;
    } catch {
      pending = null;
    }
    const locale = pending?.l ?? 'en';
    const fail = (failure: GoogleFailure) => ({ ok: false as const, failure, locale });
    if (!cfg || !pending || pending.exp < Date.now() || input.error || !input.code || !input.state) return fail('google_failed');
    const a = Buffer.from(input.state);
    const b = Buffer.from(pending.s);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return fail('google_failed');

    let claims: { sub: string; email?: string; email_verified?: boolean; name?: string };
    try {
      const res = await fetch(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: input.code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: cfg.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: pending.v,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return fail('google_failed');
      const tokens = (await res.json()) as { id_token?: string };
      if (!tokens.id_token) return fail('google_failed');
      if (!this.jwks || this.jwks.url !== cfg.jwksUrl) this.jwks = { url: cfg.jwksUrl, set: createRemoteJWKSet(new URL(cfg.jwksUrl)) };
      const { payload } = await jwtVerify(tokens.id_token, this.jwks.set, { issuer: cfg.issuers, audience: cfg.clientId, algorithms: ['RS256'] });
      if (payload.nonce !== pending.n) return fail('google_failed');
      claims = payload as typeof claims;
    } catch (e) {
      this.log.warn(`google sign-in failed: ${(e as Error).message}`);
      return fail('google_failed');
    }
    if (!claims.sub || !claims.email || claims.email_verified !== true) return fail('google_unverified');
    const email = claims.email.trim().toLowerCase();

    // 1) Already linked to this Google account.
    let user = await this.db.user.findUnique({ where: { googleSub: claims.sub } });
    if (!user) {
      const existing = await this.db.user.findUnique({ where: { email } });
      if (existing) {
        if (existing.googleSub && existing.googleSub !== claims.sub) return fail('google_blocked');
        // 2) Same email: Google vouches for it. If the address was never verified, whoever registered it may not
        // own it, so their password is removed and their sessions ended before the real owner takes over.
        if (!existing.emailVerifiedAt) {
          await this.db.session.updateMany({ where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date() } });
        }
        user = await this.db.user.update({
          where: { id: existing.id },
          data: {
            googleSub: claims.sub,
            emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
            ...(existing.emailVerifiedAt ? {} : { passwordHash: null }),
            displayName: existing.displayName ?? claims.name?.slice(0, 80) ?? null,
          },
        });
      } else {
        // 3) New account, no password.
        user = await this.db.user.create({
          data: { email, googleSub: claims.sub, emailVerifiedAt: new Date(), displayName: claims.name?.slice(0, 80) ?? null, locale: pending.l },
        });
      }
    }
    if (user.status !== 'ACTIVE') return fail('google_blocked');
    // A second factor must never be bypassed by signing in with Google.
    if (user.mfaEnabledAt) return fail('google_mfa');

    const session = await this.auth.createSession(user, false, ctx, 'auth.google.login');
    return { ok: true, token: session.token, user, locale };
  }
}
