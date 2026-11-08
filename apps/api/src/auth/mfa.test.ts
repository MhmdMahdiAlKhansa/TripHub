import 'reflect-metadata';
import * as OTPAuth from 'otpauth';
import { createPrismaClient, PrismaClient } from '@triphub/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, PASSWORD, slug, type Harness, type TestUser } from '../testing/harness';
import { MAX_FAILED_LOGINS } from './auth.service';

let h: Harness;
let db: PrismaClient;
beforeAll(async () => {
  h = await createHarness();
  db = createPrismaClient();
});
afterAll(async () => {
  await h.close();
  await db.$disconnect();
});

const totp = (secret: string) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30, algorithm: 'SHA1' });
/** Code for the current step, or a neighbouring one (accepted by the +/-1 step window). */
const codeAt = (secret: string, stepOffset = 0) => totp(secret).generate({ timestamp: Date.now() + stepOffset * 30_000 });
const forgetLastStep = (userId: string) => db.user.update({ where: { id: userId }, data: { mfaLastStep: null } });
const loginReq = (email: string, extra: object = {}) =>
  h.http().post('/api/v1/auth/login').send({ email, password: PASSWORD, ...extra });
const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers['set-cookie'] as string[])[0] as string;

async function userWithMfa() {
  const u = await h.newUser();
  const setup = await h.http().post('/api/v1/auth/mfa/setup').set('Cookie', u.cookie).expect(200);
  const secret = setup.body.secret as string;
  const en = await h
    .http()
    .post('/api/v1/auth/mfa/enable')
    .set('Cookie', u.cookie)
    .send({ code: codeAt(secret) })
    .expect(200);
  await forgetLastStep(u.id); // simulate time passing so tests can reuse the current step
  return { u, secret, recovery: en.body.recoveryCodes as string[] };
}

describe('TOTP MFA', () => {
  it('setup stores the secret encrypted and returns an otpauth URL', async () => {
    const u = await h.newUser();
    const res = await h.http().post('/api/v1/auth/mfa/setup').set('Cookie', u.cookie).expect(200);
    expect(res.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.mfaSecretEnc).toBeTruthy();
    expect(row.mfaSecretEnc).not.toContain(res.body.secret);
    expect(row.mfaEnabledAt).toBeNull(); // not active until confirmed
  });

  it('enabling needs a valid code, yields 8 recovery codes, and ends other sessions', async () => {
    const u = await h.newUser();
    const other = cookieOf(await loginReq(u.email).expect(200));
    const { body } = await h.http().post('/api/v1/auth/mfa/setup').set('Cookie', u.cookie).expect(200);
    await h.http().post('/api/v1/auth/mfa/enable').set('Cookie', u.cookie).send({ code: '000000' }).expect(401);
    const en = await h
      .http()
      .post('/api/v1/auth/mfa/enable')
      .set('Cookie', u.cookie)
      .send({ code: codeAt(body.secret) })
      .expect(200);
    expect(en.body.recoveryCodes).toHaveLength(8);
    await h.http().get('/api/v1/auth/me').set('Cookie', other).expect(401);
    await h.http().get('/api/v1/auth/me').set('Cookie', u.cookie).expect(200);
    // Recovery codes are stored only as hashes.
    const stored = await db.mfaRecoveryCode.findMany({ where: { userId: u.id } });
    expect(stored.map((r) => r.codeHash)).not.toContain(en.body.recoveryCodes[0]);
  });

  it('login then requires the second factor', async () => {
    const { u, secret } = await userWithMfa();
    const missing = await loginReq(u.email).expect(401);
    expect(missing.body.code).toBe('mfa_required');
    await loginReq(u.email, { code: '123456' }).expect(401);
    const ok = await loginReq(u.email, { code: codeAt(secret) }).expect(200);
    const session = await db.session.findFirstOrThrow({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } });
    expect(session.mfaVerifiedAt).not.toBeNull();
    await h.http().get('/api/v1/auth/me').set('Cookie', cookieOf(ok)).expect(200);
  });

  it('a TOTP code cannot be replayed', async () => {
    const { u, secret } = await userWithMfa();
    const code = codeAt(secret);
    await loginReq(u.email, { code }).expect(200);
    await loginReq(u.email, { code }).expect(401);
  });

  it('recovery codes work exactly once', async () => {
    const { u, recovery } = await userWithMfa();
    await loginReq(u.email, { code: recovery[0] }).expect(200);
    await loginReq(u.email, { code: recovery[0] }).expect(401);
    await loginReq(u.email, { code: recovery[1] }).expect(200);
  });

  it('wrong second factors count toward lockout', async () => {
    const { u, secret } = await userWithMfa();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await loginReq(u.email, { code: '111111' }).expect(401);
    await loginReq(u.email, { code: codeAt(secret) }).expect(401); // locked, even with a valid code
  });

  it('disabling requires password and a valid code, and clears the secret', async () => {
    const { u, secret } = await userWithMfa();
    await h.http().post('/api/v1/auth/mfa/disable').set('Cookie', u.cookie)
      .send({ password: 'wrong-password-xyz', code: codeAt(secret) }).expect(401);
    await h.http().post('/api/v1/auth/mfa/disable').set('Cookie', u.cookie)
      .send({ password: PASSWORD, code: codeAt(secret) }).expect(204);
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.mfaEnabledAt).toBeNull();
    expect(row.mfaSecretEnc).toBeNull();
    expect(await db.mfaRecoveryCode.count({ where: { userId: u.id } })).toBe(0);
    await loginReq(u.email).expect(200); // no second factor needed any more
  });
});

describe('sessions', () => {
  it('lists own sessions, marks the current one, and revokes others', async () => {
    const u = await h.newUser();
    const second = cookieOf(await loginReq(u.email).expect(200));
    const list = await h.http().get('/api/v1/auth/sessions').set('Cookie', u.cookie).expect(200);
    expect(list.body.sessions).toHaveLength(2);
    expect(list.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const other = list.body.sessions.find((s: { current: boolean }) => !s.current);
    await h.http().delete(`/api/v1/auth/sessions/${other.id}`).set('Cookie', u.cookie).expect(204);
    await h.http().get('/api/v1/auth/me').set('Cookie', second).expect(401);

    const third = cookieOf(await loginReq(u.email).expect(200));
    const res = await h.http().post('/api/v1/auth/sessions/revoke-others').set('Cookie', u.cookie).expect(200);
    expect(res.body.revoked).toBe(1);
    await h.http().get('/api/v1/auth/me').set('Cookie', third).expect(401);
    await h.http().get('/api/v1/auth/me').set('Cookie', u.cookie).expect(200);
  });

  it("cannot revoke another user's session", async () => {
    const a = await h.newUser();
    const b = await h.newUser();
    const bSession = await db.session.findFirstOrThrow({ where: { userId: b.id } });
    await h.http().delete(`/api/v1/auth/sessions/${bSession.id}`).set('Cookie', a.cookie).expect(404);
    await h.http().delete('/api/v1/auth/sessions/not-a-uuid').set('Cookie', a.cookie).expect(404);
    await h.http().get('/api/v1/auth/me').set('Cookie', b.cookie).expect(200);
  });
});

describe('step-up reauthentication', () => {
  async function ownerWithMember(): Promise<{ owner: TestUser; companyId: string; memberId: string }> {
    const owner = await h.newUser();
    const m = await h.newUser();
    const c = await h.http().post('/api/v1/companies').set('Cookie', owner.cookie)
      .send({ name: 'Step Co', slug: slug() }).expect(201);
    const companyId = c.body.company.id as string;
    await h.http().post(`/api/v1/companies/${companyId}/invitations`).set('Cookie', owner.cookie)
      .send({ email: m.email, role: 'MANAGER' }).expect(202);
    await h.http().post('/api/v1/invitations/accept').set('Cookie', m.cookie)
      .send({ token: h.lastToken(m.email, 'company-invitation') }).expect(200);
    const memberId = (await db.membership.findFirstOrThrow({ where: { companyId, userId: m.id } })).id;
    return { owner, companyId, memberId };
  }

  it('sensitive team actions need a recent step-up', async () => {
    const { owner, companyId, memberId } = await ownerWithMember();
    await db.session.updateMany({ where: { userId: owner.id }, data: { stepUpAt: null } });
    const denied = await h.http().patch(`/api/v1/companies/${companyId}/members/${memberId}`)
      .set('Cookie', owner.cookie).send({ role: 'FINANCE' }).expect(403);
    expect(denied.body.code).toBe('step_up_required');

    await h.http().post('/api/v1/auth/step-up').set('Cookie', owner.cookie).send({ password: 'nope-nope-nope' }).expect(401);
    await h.http().post('/api/v1/auth/step-up').set('Cookie', owner.cookie).send({ password: PASSWORD }).expect(204);
    await h.http().patch(`/api/v1/companies/${companyId}/members/${memberId}`)
      .set('Cookie', owner.cookie).send({ role: 'FINANCE' }).expect(200);
  });

  it('step-up expires', async () => {
    const { owner, companyId, memberId } = await ownerWithMember();
    await db.session.updateMany({ where: { userId: owner.id }, data: { stepUpAt: new Date(Date.now() - 11 * 60_000) } });
    await h.http().delete(`/api/v1/companies/${companyId}/members/${memberId}`)
      .set('Cookie', owner.cookie).expect(403);
  });

  it('with MFA enabled, step-up also requires the second factor', async () => {
    const { u, secret } = await userWithMfa();
    await h.http().post('/api/v1/auth/step-up').set('Cookie', u.cookie).send({ password: PASSWORD }).expect(401);
    await h.http().post('/api/v1/auth/step-up').set('Cookie', u.cookie)
      .send({ password: PASSWORD, code: codeAt(secret) }).expect(204);
  });
});
