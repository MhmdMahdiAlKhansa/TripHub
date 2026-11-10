import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../testing/harness';

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { process.env.SIMPLE_SIGNUP = '0'; await h.close(); });
const A = '/api/v1/auth';
const email = () => `simple-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
const PW = 'a-long-simple-password-1';

describe('simple sign-up (local testing only)', () => {
  it('signs you in straight after email + password, without any email check', async () => {
    process.env.SIMPLE_SIGNUP = '1';
    const e = email();
    const r = await h.http().post(`${A}/register`).send({ email: e, password: PW }).expect(201);
    const cookie = ((r.headers['set-cookie'] as unknown as string[]) ?? []).find((c) => c.startsWith('th_session='))!.split(';')[0]!;
    await h.http().get(`${A}/me`).set('Cookie', cookie).expect(200);
    expect(h.mails.some((m) => m.to === e)).toBe(false);
    expect((await h.db.user.findUniqueOrThrow({ where: { email: e } })).emailVerifiedAt).toBeNull(); // still honestly unverified
    await h.http().post(`${A}/login`).send({ email: e, password: PW }).expect(200);
  });

  it('tells you plainly when the email is already registered, and does not touch the old account', async () => {
    process.env.SIMPLE_SIGNUP = '1';
    const e = email();
    await h.http().post(`${A}/register`).send({ email: e, password: PW }).expect(201);
    const again = await h.http().post(`${A}/register`).send({ email: e, password: 'another-long-password-2' }).expect(409);
    expect(again.body.code ?? again.body.message?.code).toBe('email_taken');
    await h.http().post(`${A}/login`).send({ email: e, password: PW }).expect(200);
  });

  it('unverified accounts still cannot use code sign-in', async () => {
    process.env.SIMPLE_SIGNUP = '1';
    const e = email();
    await h.http().post(`${A}/register`).send({ email: e, password: PW }).expect(201);
    const before = h.mails.length;
    await h.http().post(`${A}/code/request`).send({ email: e }).expect(202);
    expect(h.mails.length).toBe(before);
  });

  it('is off by default and is never available in production', async () => {
    process.env.SIMPLE_SIGNUP = '0';
    const e = email();
    await h.http().post(`${A}/register`).send({ email: e, password: PW }).expect(202);
    await h.http().post(`${A}/login`).send({ email: e, password: PW }).expect(401); // must verify first
    const prev = process.env.NODE_ENV;
    process.env.SIMPLE_SIGNUP = '1';
    process.env.NODE_ENV = 'production';
    try {
      await h.http().post(`${A}/register`).send({ email: email(), password: PW }).expect(202);
    } finally { process.env.NODE_ENV = prev; }
  });
});
