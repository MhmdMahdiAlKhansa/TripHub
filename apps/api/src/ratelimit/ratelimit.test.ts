import 'reflect-metadata';
import path from 'node:path';
import { config } from 'dotenv';
import { VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import Redis from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';

config({ path: path.resolve(__dirname, '../../../../.env') });
process.env.SIMPLE_SIGNUP = '0'; // these tests cover the verified sign-up flow

import { AppModule } from '../app.module';
import { MAILER } from '../auth/mailer';
import { MemoryRateLimiter, RedisRateLimiter } from './ratelimit';

describe('limiter implementations', () => {
  it('memory limiter allows up to the limit then blocks, per key', async () => {
    const l = new MemoryRateLimiter();
    for (let i = 0; i < 3; i++) expect((await l.hit('a', 3, 60)).allowed).toBe(true);
    const blocked = await l.hit('a', 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect((await l.hit('b', 3, 60)).allowed).toBe(true);
  });

  it('memory limiter window resets', async () => {
    const l = new MemoryRateLimiter();
    expect((await l.hit('w', 1, 1)).allowed).toBe(true);
    expect((await l.hit('w', 1, 1)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await l.hit('w', 1, 1)).allowed).toBe(true);
  });

  it('redis limiter enforces the limit against real Redis', async () => {
    const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
    try {
      const l = new RedisRateLimiter(redis);
      const key = `test-${Date.now()}`;
      const results = await Promise.all(Array.from({ length: 6 }, () => l.hit(key, 4, 30)));
      expect(results.filter((r) => r.allowed)).toHaveLength(4);
    } finally {
      redis.disconnect();
    }
  });

  it('redis limiter fails open when Redis is unreachable', async () => {
    const dead = new Redis('redis://127.0.0.1:1', { maxRetriesPerRequest: 0, enableOfflineQueue: false, lazyConnect: true });
    dead.on('error', () => {});
    const r = await new RedisRateLimiter(dead).hit('x', 1, 60);
    expect(r.allowed).toBe(true);
    dead.disconnect();
  });
});

describe('HTTP rate limiting', () => {
  it('returns 429 with Retry-After on the 11th login attempt in a window', async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAILER)
      .useValue({ send: async () => {} })
      .compile();
    const app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
    try {
      const statuses: number[] = [];
      let last: request.Response | undefined;
      for (let i = 0; i < 11; i++) {
        last = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: 'nobody@example.test', password: 'whatever-123' });
        statuses.push(last.status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses[10]).toBe(429);
      expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0);
      expect(last!.body.code).toBe('rate_limited');
    } finally {
      await app.close();
    }
  });
});
