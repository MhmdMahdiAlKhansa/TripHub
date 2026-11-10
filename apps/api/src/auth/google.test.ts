import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../testing/harness';

let h: Harness;
let idp: Server;
let jwk: JWK;
let privateKey: CryptoKey;
const codes = new Map<string, { claims: Record<string, unknown>; aud?: string; iss?: string }>();
const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const A = '/api/v1/auth';

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey as CryptoKey;
  jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  idp = createServer(async (req, res) => {
    if (req.url === '/jwks') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ keys: [jwk] }));
    }
    if (req.url === '/token' && req.method === 'POST') {
      let body = '';
      for await (const c of req) body += c;
      const p = new URLSearchParams(body);
      const entry = codes.get(p.get('code') ?? '');
      if (!entry || p.get('client_id') !== CLIENT_ID || !p.get('code_verifier')) {
        res.statusCode = 400;
        return res.end('{"error":"invalid_grant"}');
      }
      const id = await new SignJWT(entry.claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(entry.iss ?? 'https://accounts.google.com')
        .setAudience(entry.aud ?? CLIENT_ID)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ id_token: id, access_token: 'unused' }));
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
  const port = (idp.address() as { port: number }).port;
  Object.assign(process.env, {
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'test-secret',
    GOOGLE_AUTH_URL: `http://127.0.0.1:${port}/auth`,
    GOOGLE_TOKEN_URL: `http://127.0.0.1:${port}/token`,
    GOOGLE_JWKS_URL: `http://127.0.0.1:${port}/jwks`,
  });
  h = await createHarness();
});
afterAll(async () => {
  for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_AUTH_URL', 'GOOGLE_TOKEN_URL', 'GOOGLE_JWKS_URL']) delete process.env[k];
  await h.close();
  await new Promise<void>((r) => idp.close(() => r()));
});

let n = 0;
const RUN = Date.now().toString(36); // Google ids must be unique per run: the development database is shared and persistent
const uniqEmail = () => `g-${Date.now()}-${n++}@example.test`;

/** Runs the whole browser journey against the mock Google. */
async function google(opts: { email?: string; sub?: string; verified?: boolean; name?: string; nonce?: 'wrong'; aud?: string; stateOverride?: string; cookieOverride?: string; locale?: 'en' | 'ar' }) {
  const start = await h.http().get(`${A}/google/start`).query({ locale: opts.locale ?? 'en' });
  expect(start.status).toBe(302);
  const loc = new URL(start.headers.location as string);
  const state = loc.searchParams.get('state')!;
  const nonce = loc.searchParams.get('nonce')!;
  expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
  expect(loc.searchParams.get('scope')).toBe('openid email profile');
  const cookie = ((start.headers['set-cookie'] as unknown as string[]) ?? []).find((c) => c.startsWith('th_oauth='))!.split(';')[0]!;
  const code = `code-${n++}`;
  codes.set(code, {
    aud: opts.aud,
    claims: { sub: opts.sub ?? `sub-${RUN}-${n}`, email: opts.email ?? uniqEmail(), email_verified: opts.verified ?? true, name: opts.name ?? 'Maya Haddad', nonce: opts.nonce === 'wrong' ? 'not-the-nonce' : nonce },
  });
  const cb = await h.http().get(`${A}/google/callback`).query({ code, state: opts.stateOverride ?? state }).set('Cookie', opts.cookieOverride ?? cookie);
  const session = ((cb.headers['set-cookie'] as unknown as string[]) ?? []).find((c) => c.startsWith('th_session=') && !c.includes('th_session=;'));
  return { cb, location: cb.headers.location as string, sessionCookie: session?.split(';')[0], start: loc };
}

describe('Continue with Google', () => {
  it('is advertised only when configured, and starts a PKCE authorization-code flow', async () => {
    expect((await h.http().get(`${A}/google/status`).expect(200)).body).toEqual({ enabled: true });
    const r = await google({});
    expect(r.start.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(r.start.searchParams.get('response_type')).toBe('code');
    expect(r.start.searchParams.get('redirect_uri')).toContain('/api/v1/auth/google/callback');
  });

  it('creates a verified, passwordless account for a new Google user and signs them in', async () => {
    const email = uniqEmail();
    const r = await google({ email, name: 'Maya Haddad', locale: 'ar' });
    expect(r.location).toMatch(/\/ar\/profile$/);
    expect(r.sessionCookie).toBeTruthy();
    const me = await h.http().get(`${A}/me`).set('Cookie', r.sessionCookie!).expect(200);
    expect(me.body.user).toMatchObject({ email, displayName: 'Maya Haddad', locale: 'ar' });
    const row = await h.db.user.findUniqueOrThrow({ where: { email } });
    expect(row.emailVerifiedAt).not.toBeNull();
    expect(row.passwordHash).toBeNull();
    expect(row.googleSub).toBeTruthy();
    expect(await h.db.auditEvent.count({ where: { action: 'auth.google.login', actorId: row.id } })).toBe(1);
  });

  it('signs a returning Google user into the same account, and links an existing verified password account', async () => {
    const email = uniqEmail();
    const first = await google({ email, sub: `sub-returning-${RUN}` });
    const again = await google({ email, sub: `sub-returning-${RUN}` });
    expect(again.sessionCookie).toBeTruthy();
    expect(await h.db.user.count({ where: { email } })).toBe(1);
    expect(first.location).toBe(again.location);

    const normal = await h.newUser(); // registered with email + password and verified
    const linked = await google({ email: normal.email, sub: `sub-linked-${RUN}` });
    expect(linked.sessionCookie).toBeTruthy();
    const row = await h.db.user.findUniqueOrThrow({ where: { email: normal.email } });
    expect(row.googleSub).toBe(`sub-linked-${RUN}`);
    expect(row.passwordHash).not.toBeNull(); // their password still works
  });

  it('takes an unverified pre-registered account away from whoever registered it (their password and sessions die)', async () => {
    const email = uniqEmail();
    await h.http().post(`${A}/register`).send({ email, password: 'attacker-chosen-password-1' }).expect(202);
    expect((await h.db.user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeNull();
    const r = await google({ email, sub: `sub-real-owner-${RUN}` });
    expect(r.sessionCookie).toBeTruthy();
    const row = await h.db.user.findUniqueOrThrow({ where: { email } });
    expect(row.passwordHash).toBeNull();
    expect(row.emailVerifiedAt).not.toBeNull();
    await h.http().post(`${A}/login`).send({ email, password: 'attacker-chosen-password-1' }).expect(401);
  });

  it('refuses tampering: wrong state, missing cookie, wrong nonce, wrong audience, unverified email', async () => {
    const bad = async (o: Parameters<typeof google>[0]) => {
      const r = await google(o);
      expect(r.sessionCookie).toBeUndefined();
      expect(r.location).toMatch(/\/en\/login\?error=google_/);
      return r.location;
    };
    await bad({ stateOverride: 'forged-state' });
    await bad({ cookieOverride: 'th_oauth=garbage' });
    await bad({ nonce: 'wrong' });
    await bad({ aud: 'someone-elses-client-id' });
    expect(await bad({ verified: false })).toContain('google_unverified');
    // No cookie at all.
    const cb = await h.http().get(`${A}/google/callback`).query({ code: 'x', state: 'y' });
    expect(cb.headers.location).toContain('error=google_failed');
    // Google reporting an error (user pressed cancel).
    const cancelled = await h.http().get(`${A}/google/callback`).query({ error: 'access_denied' });
    expect(cancelled.headers.location).toContain('error=google_failed');
  });

  it('cannot be used to skip two-step verification', async () => {
    const user = await h.newUser();
    await h.db.user.update({ where: { id: user.id }, data: { mfaEnabledAt: new Date(), mfaSecretEnc: 'x' } });
    const r = await google({ email: user.email, sub: `sub-mfa-${RUN}` });
    expect(r.sessionCookie).toBeUndefined();
    expect(r.location).toContain('error=google_mfa');
  });

  it('blocks a different Google account from taking over an email already linked to another', async () => {
    const email = uniqEmail();
    await google({ email, sub: `sub-owner-1-${RUN}` });
    const r = await google({ email, sub: `sub-owner-2-${RUN}` });
    expect(r.sessionCookie).toBeUndefined();
    expect(r.location).toContain('error=google_blocked');
  });

  it('a one-time code cannot be replayed with a stale cookie', async () => {
    const r = await google({});
    // Reuse the same callback URL without the (now cleared) cookie.
    const replay = await h.http().get(`${A}/google/callback`).query({ code: 'code-1', state: r.start.searchParams.get('state')! });
    expect(replay.headers.location).toContain('error=google_failed');
  });
});
