import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../testing/harness';

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });
const A = '/api/v1/auth';
const codeFor = (to: string) => [...h.mails].reverse().find((m) => m.to === to && m.template === 'login-code')?.token as string;
const sessionOf = (res: { headers: Record<string, unknown> }) => ((res.headers['set-cookie'] as string[]) ?? []).find((c) => c.startsWith('th_session=') && !c.includes('th_session=;'));

describe('sign in with an emailed code', () => {
  it('sends a 6-digit code, signs in once, and the code cannot be reused', async () => {
    const u = await h.newUser();
    await h.http().post(`${A}/code/request`).send({ email: u.email }).expect(202);
    const code = codeFor(u.email);
    expect(code).toMatch(/^\d{6}$/);
    const row = await h.db.loginCode.findFirstOrThrow({ where: { userId: u.id } });
    expect(row.codeHash).not.toContain(code); // stored hashed
    const ok = await h.http().post(`${A}/code/verify`).send({ email: u.email, code }).expect(200);
    expect(sessionOf(ok)).toBeTruthy();
    expect(ok.body.user.email).toBe(u.email);
    await h.http().post(`${A}/code/verify`).send({ email: u.email, code }).expect(401);
  });

  it('answers the same for unknown addresses and sends nothing', async () => {
    const before = h.mails.length;
    const r = await h.http().post(`${A}/code/request`).send({ email: `nobody-${Date.now()}@example.test` }).expect(202);
    expect(r.body.status).toContain('If the address');
    expect(h.mails.length).toBe(before);
  });

  it('allows only five wrong tries, then even the right code is refused', async () => {
    const u = await h.newUser();
    await h.http().post(`${A}/code/request`).send({ email: u.email }).expect(202);
    const code = codeFor(u.email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await h.http().post(`${A}/code/verify`).send({ email: u.email, code: wrong }).expect(401);
    await h.http().post(`${A}/code/verify`).send({ email: u.email, code }).expect(401);
  });

  it('a new request replaces the old code, an expired code fails, and requests are limited to one a minute', async () => {
    const u = await h.newUser();
    await h.http().post(`${A}/code/request`).send({ email: u.email }).expect(202);
    const first = codeFor(u.email);
    await h.http().post(`${A}/code/request`).send({ email: u.email }).expect(202);
    expect(codeFor(u.email)).toBe(first); // within a minute: no second mail
    await h.db.loginCode.updateMany({ where: { userId: u.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await h.http().post(`${A}/code/request`).send({ email: u.email }).expect(202);
    const second = codeFor(u.email);
    expect(second).not.toBe(first);
    if (first !== second) await h.http().post(`${A}/code/verify`).send({ email: u.email, code: first }).expect(401);
    await h.db.loginCode.updateMany({ where: { userId: u.id, consumedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await h.http().post(`${A}/code/verify`).send({ email: u.email, code: second }).expect(401);
  });

  it('is not offered to accounts with two-step verification, unverified or suspended accounts', async () => {
    const mfa = await h.newUser();
    await h.db.user.update({ where: { id: mfa.id }, data: { mfaEnabledAt: new Date(), mfaSecretEnc: 'x' } });
    const sus = await h.newUser();
    await h.db.user.update({ where: { id: sus.id }, data: { status: 'SUSPENDED' } });
    const unverified = `unv-${Date.now()}@example.test`;
    await h.http().post(`${A}/register`).send({ email: unverified, password: 'a long password 123' }).expect(202);
    for (const email of [mfa.email, sus.email, unverified]) {
      const before = h.mails.filter((m) => m.template === 'login-code').length;
      await h.http().post(`${A}/code/request`).send({ email }).expect(202);
      expect(h.mails.filter((m) => m.template === 'login-code').length).toBe(before);
      await h.http().post(`${A}/code/verify`).send({ email, code: '123456' }).expect(401);
    }
  });

  it('rejects malformed codes', async () => {
    await h.http().post(`${A}/code/verify`).send({ email: 'a@example.test', code: '12ab56' }).expect(400);
  });
});
