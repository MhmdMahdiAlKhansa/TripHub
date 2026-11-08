import 'reflect-metadata';
import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';
import { DB_PING } from './health.tokens';

async function makeApp(ping: () => Promise<void>): Promise<INestApplication> {
  const mod = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: DB_PING, useValue: ping }],
  }).compile();
  const app = mod.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });
  await app.init();
  return app;
}

describe('health', () => {
  let up: INestApplication;
  let down: INestApplication;
  beforeAll(async () => {
    up = await makeApp(async () => {});
    down = await makeApp(async () => {
      throw new Error('db down');
    });
  });
  afterAll(async () => {
    await up.close();
    await down.close();
  });

  it('live returns 200', async () => {
    await request(up.getHttpServer()).get('/api/v1/health/live').expect(200, { status: 'ok' });
  });
  it('ready returns 200 when db is up', async () => {
    await request(up.getHttpServer()).get('/api/v1/health/ready').expect(200);
  });
  it('ready returns 503 when db is down, without leaking the error', async () => {
    const res = await request(down.getHttpServer()).get('/api/v1/health/ready').expect(503);
    expect(JSON.stringify(res.body)).not.toContain('db down');
  });
});
