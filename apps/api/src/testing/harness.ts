import 'reflect-metadata';
import path from 'node:path';
import { config } from 'dotenv';
import { INestApplication, VersioningType } from '@nestjs/common';
import os from 'node:os';
import { LocalDiskStorage, STORAGE } from '../storage/storage';
import { Test } from '@nestjs/testing';
import * as OTPAuth from 'otpauth';
import { createPrismaClient, PrismaClient } from '@triphub/database';
import request from 'supertest';

config({ path: path.resolve(__dirname, '../../../../.env') });
// Tests exercise the real verified sign-up flow; the local-only simple sign-up is tested on its own.
process.env.SIMPLE_SIGNUP = '0';

import { AppModule } from '../app.module';
import { MAILER, type Mail } from '../auth/mailer';
import { DEFAULT_FEATURES, FEATURES, type Features } from '../config/features';
import { RATE_LIMITER } from '../ratelimit/ratelimit';

export const PASSWORD = 'correct horse battery';

export interface TestUser {
  email: string;
  id: string;
  cookie: string;
}

export interface Harness {
  app: INestApplication;
  mails: Mail[];
  http: () => ReturnType<typeof request>;
  newUser: () => Promise<TestUser>;
  lastToken: (to: string, template: Mail['template']) => string;
  db: PrismaClient;
  /** Platform staff user with MFA enabled (so the session is MFA-verified). */
  staff: (role: 'SUPPORT' | 'VERIFIER' | 'FINANCE' | 'ADMIN') => Promise<TestUser>;
  /** Owner + company that has been through profile, submit and verifier approval. */
  approvedCompany: (opts?: { trial?: boolean }) => Promise<{ owner: TestUser; companyId: string }>;
  close: () => Promise<void>;
}

export const COMPLETE_PROFILE = {
  description: 'Guided day hikes through the Qadisha Valley with local mountain guides.',
  contactEmail: 'hello@example-company.test',
  phone: '+961 3 123 456',
  city: 'Bsharri',
  categories: ['hiking', 'tours'],
  languages: ['en', 'ar'],
};

let counter = 0;

export async function createHarness(opts: { features?: Partial<Features> } = {}): Promise<Harness> {
  const mails: Mail[] = [];
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue({ send: async (m: Mail) => void mails.push(m) })
    .overrideProvider(FEATURES)
    .useValue({ ...DEFAULT_FEATURES, ...opts.features })
    .overrideProvider(STORAGE)
    .useValue(new LocalDiskStorage(path.join(os.tmpdir(), 'triphub-test-uploads')))
    .overrideProvider(RATE_LIMITER)
    .useValue({ hit: async () => ({ allowed: true, retryAfterSec: 1 }) })
    .compile();
  const app = mod.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });
  await app.init();

  const http = () => request(app.getHttpServer());
  const lastToken = (to: string, template: Mail['template']) =>
    [...mails].reverse().find((m) => m.to === to && m.template === template)?.token as string;

  const newUser = async (): Promise<TestUser> => {
    const email = `u-${Date.now()}-${process.pid}-${counter++}-${Math.random().toString(36).slice(2, 7)}@example.test`;
    await http().post('/api/v1/auth/register').send({ email, password: PASSWORD }).expect(202);
    await http()
      .post('/api/v1/auth/verify-email')
      .send({ token: lastToken(email, 'verify-email') })
      .expect(200);
    const res = await http().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0] as string;
    // Fresh sessions are stepped-up by default so tests of sensitive routes read naturally.
    await http().post('/api/v1/auth/step-up').set('Cookie', cookie).send({ password: PASSWORD }).expect(204);
    return { email, id: res.body.user.id as string, cookie };
  };

  const db = createPrismaClient();

  const staff = async (role: 'SUPPORT' | 'VERIFIER' | 'FINANCE' | 'ADMIN'): Promise<TestUser> => {
    const u = await newUser();
    await db.user.update({ where: { id: u.id }, data: { platformRole: role } });
    const { body } = await http().post('/api/v1/auth/mfa/setup').set('Cookie', u.cookie).expect(200);
    const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(body.secret), digits: 6, period: 30 }).generate();
    await http().post('/api/v1/auth/mfa/enable').set('Cookie', u.cookie).send({ code }).expect(200);
    return u;
  };

  const approvedCompany = async (opts: { trial?: boolean } = {}) => {
    const owner = await newUser();
    const created = await http().post('/api/v1/companies').set('Cookie', owner.cookie)
      .send({ name: 'Approved Co', slug: slug() }).expect(201);
    const companyId = created.body.company.id as string;
    await http().patch(`/api/v1/companies/${companyId}/profile`).set('Cookie', owner.cookie).send(COMPLETE_PROFILE).expect(200);
    await http().post(`/api/v1/companies/${companyId}/submit`).set('Cookie', owner.cookie).expect(200);
    const verifier = await staff('VERIFIER');
    await http().post(`/api/v1/admin/companies/${companyId}/review`).set('Cookie', verifier.cookie)
      .send({ decision: 'APPROVED' }).expect(200);
    if (opts.trial !== false) {
      // Selling requires an active subscription; most fixtures want the normal path of starting the free trial.
      await http().post(`/api/v1/companies/${companyId}/subscription/trial`).set('Cookie', owner.cookie)
        .send({ acknowledgedCommissionBps: 1000 }).expect(200);
    }
    return { owner, companyId };
  };

  return {
    app, mails, http, newUser, lastToken, db, staff, approvedCompany,
    close: async () => {
      await app.close();
      await db.$disconnect();
    },
  };
}

export const slug = () => `co-${Date.now().toString(36)}-${process.pid}-${counter++}-${Math.random().toString(36).slice(2, 5)}`;
