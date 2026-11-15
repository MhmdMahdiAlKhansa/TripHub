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

describe('business sign-up', () => {
  it('creates the account as owner of a DRAFT business; after verifying, the owner sees it; an existing email gets nothing new', async () => {
    process.env.SIMPLE_SIGNUP = '0';
    const e = email();
    await h.http().post(`${A}/register`).send({ email: e, password: PW, businessName: 'Qadisha Trails' }).expect(202);
    const u = await h.db.user.findUniqueOrThrow({ where: { email: e } });
    const m = await h.db.membership.findMany({ where: { userId: u.id }, include: { company: true } });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ role: 'OWNER', company: { name: 'Qadisha Trails', status: 'DRAFT' } });
    expect(m[0]!.company.slug).toMatch(/^qadisha-trails-[a-z0-9]{1,6}$/);
    await h.http().post(`${A}/verify-email`).send({ token: h.lastToken(e, 'verify-email') }).expect(200);
    const login = await h.http().post(`${A}/login`).send({ email: e, password: PW }).expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const mine = await h.http().get('/api/v1/companies').set('Cookie', cookie).expect(200);
    expect(mine.body.companies).toMatchObject([{ name: 'Qadisha Trails', role: 'OWNER', status: 'DRAFT' }]);
    // Same email again: same neutral answer, and no second business appears.
    await h.http().post(`${A}/register`).send({ email: e, password: PW, businessName: 'Another One' }).expect(202);
    expect(await h.db.membership.count({ where: { userId: u.id } })).toBe(1);
    await h.http().post(`${A}/register`).send({ email: email(), password: PW, businessName: 'x' }).expect(400);
  });
});
