import 'reflect-metadata';
import path from 'node:path';
import { config } from 'dotenv';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createPrismaClient, PrismaClient } from '@triphub/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

config({ path: path.resolve(__dirname, '../../../../.env') });
process.env.SIMPLE_SIGNUP = '0'; // these tests cover the verified sign-up flow

import { AppModule } from '../app.module';
import { sha256 } from './crypto';
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS } from './auth.service';
import { MAILER, type Mail } from './mailer';
import { RATE_LIMITER } from '../ratelimit/ratelimit';

const PASSWORD = 'correct horse battery';
let app: INestApplication;
let db: PrismaClient;
const mails: Mail[] = [];
let n = 0;
const uniqueEmail = () => `auth-${Date.now()}-${n++}@example.test`;
const http = () => request(app.getHttpServer());

const lastToken = (to: string, template: Mail['template']) =>
  [...mails].reverse().find((m) => m.to === to && m.template === template)?.token as string;

async function registerVerified(email = uniqueEmail()) {
  await http().post('/api/v1/auth/register').send({ email, password: PASSWORD }).expect(202);
  await http()
    .post('/api/v1/auth/verify-email')
    .send({ token: lastToken(email, 'verify-email') })
    .expect(200);
  return email;
}
const login = (email: string, password = PASSWORD) =>
  http().post('/api/v1/auth/login').send({ email, password });
const cookieOf = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[])[0] as string;

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue({ send: async (m: Mail) => void mails.push(m) })
    .overrideProvider(RATE_LIMITER)
    .useValue({ hit: async () => ({ allowed: true, retryAfterSec: 1 }) })
    .compile();
  app = mod.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });
  await app.init();
  db = createPrismaClient();
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('auth flows (real Postgres)', () => {
  it('register -> verify -> login -> me -> logout -> me is 401', async () => {
    const email = await registerVerified();
    const res = await login(email).expect(200);
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.user.email).toBe(email);
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash/);

    await http().post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
  });

  it('stores only hashes of session and verification tokens', async () => {
    const email = uniqueEmail();
    await http().post('/api/v1/auth/register').send({ email, password: PASSWORD }).expect(202);
    const raw = lastToken(email, 'verify-email');
    expect(await db.userToken.count({ where: { tokenHash: raw } })).toBe(0);
    expect(await db.userToken.count({ where: { tokenHash: sha256(raw) } })).toBe(1);
  });

  it('rejects unverified login with the same error as bad credentials', async () => {
    const email = uniqueEmail();
    await http().post('/api/v1/auth/register').send({ email, password: PASSWORD }).expect(202);
    const unverified = await login(email).expect(401);
    const unknown = await login(uniqueEmail()).expect(401);
    const { requestId: _a, ...u1 } = unverified.body;
    const { requestId: _b, ...u2 } = unknown.body;
    expect(u1).toEqual(u2);
  });

  it('does not reveal whether an email is already registered', async () => {
    const email = await registerVerified();
    const dup = await http().post('/api/v1/auth/register').send({ email, password: PASSWORD }).expect(202);
    const fresh = await http()
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail(), password: PASSWORD })
      .expect(202);
    expect(dup.body).toEqual(fresh.body);
    expect(await db.user.count({ where: { email } })).toBe(1);
  });

  it('validates input (short password, bad email)', async () => {
    await http().post('/api/v1/auth/register').send({ email: 'nope', password: 'x' }).expect(400);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const email = await registerVerified();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await login(email, 'wrong-password-123').expect(401);
    await login(email).expect(401);
    const u = await db.user.findUniqueOrThrow({ where: { email } });
    expect(u.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + (LOCKOUT_MINUTES - 1) * 60_000);
    // After the lock expires login works again.
    await db.user.update({ where: { email }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await login(email).expect(200);
  });

  it('verification token is single-use, even under concurrent submission', async () => {
    const email = uniqueEmail();
    await http().post('/api/v1/auth/register').send({ email, password: PASSWORD }).expect(202);
    const token = lastToken(email, 'verify-email');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => http().post('/api/v1/auth/verify-email').send({ token })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(4);
  });

  it('expired verification token is rejected', async () => {
    const email = uniqueEmail();
    await http().post('/api/v1/auth/register').send({ email, password: PASSWORD }).expect(202);
    const token = lastToken(email, 'verify-email');
    await db.userToken.update({ where: { tokenHash: sha256(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await http().post('/api/v1/auth/verify-email').send({ token }).expect(400);
  });

  it('password reset changes the password, revokes sessions, and is single-use', async () => {
    const email = await registerVerified();
    const cookie = cookieOf(await login(email).expect(200));

    await http().post('/api/v1/auth/password-reset/request').send({ email }).expect(202);
    const token = lastToken(email, 'password-reset');
    const newPassword = 'a brand new passphrase';
    await http().post('/api/v1/auth/password-reset/confirm').send({ token, password: newPassword }).expect(200);
    await http().post('/api/v1/auth/password-reset/confirm').send({ token, password: newPassword }).expect(400);

    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    await login(email).expect(401);
    await login(email, newPassword).expect(200);
  });

  it('reset request for an unknown email looks identical and sends nothing', async () => {
    const before = mails.length;
    const res = await http()
      .post('/api/v1/auth/password-reset/request')
      .send({ email: uniqueEmail() })
      .expect(202);
    expect(res.body).toEqual({ status: 'reset_email_sent_if_account_exists' });
    expect(mails.length).toBe(before);
  });

  it('rejects an expired session', async () => {
    const email = await registerVerified();
    const cookie = cookieOf(await login(email).expect(200));
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await db.session.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 2 * 86_400_000), expiresAt: new Date(Date.now() - 1000) },
    });
    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
  });

  it('blocks state-changing requests from a foreign Origin (CSRF)', async () => {
    const email = await registerVerified();
    const cookie = cookieOf(await login(email).expect(200));
    await http()
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .expect(403);
    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
  });

  it('writes audit events for security-relevant actions', async () => {
    const email = await registerVerified();
    await login(email, 'wrong-password-123').expect(401);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const actions = (await db.auditEvent.findMany({ where: { actorId: user.id } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['auth.register', 'auth.email_verified', 'auth.login.failed']));
  });
});
