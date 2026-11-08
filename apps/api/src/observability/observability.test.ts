import 'reflect-metadata';
import { Controller, Get, HttpException, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AllExceptionsFilter, JsonLogger, ObservabilityModule, redact } from './observability';

@Controller({ path: 'boom', version: '1' })
class BoomController {
  @Get('db')
  db() {
    throw new Error('duplicate key value violates unique constraint "user_email_key" Key (email)=(a@b.c)');
  }
  @Get('http')
  http() {
    throw new HttpException({ code: 'custom_code', message: 'Nope', extra: 1 }, 409);
  }
}

let app: import('@nestjs/common').INestApplication;
const lines: string[] = [];
beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [ObservabilityModule], controllers: [BoomController] })
    .overrideProvider(JsonLogger)
    .useValue(new JsonLogger((l) => void lines.push(l)))
    .compile();
  app = mod.createNestApplication();
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });
  await app.init();
});
afterAll(() => app.close());

describe('request ids', () => {
  it('generates one when absent and echoes it in the header and error body', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boom/http').expect(409);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
  it('keeps a safe caller-supplied id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boom/http').set('X-Request-Id', 'trace-abc12345');
    expect(res.headers['x-request-id']).toBe('trace-abc12345');
  });
  it('replaces an unsafe id (log injection / oversized)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boom/http').set('X-Request-Id', 'bad id\twith spaces');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('error shape', () => {
  it('unknown errors become a generic 500 that leaks nothing', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boom/db').expect(500);
    expect(res.body).toMatchObject({ status: 500, code: 'internal_error', message: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toMatch(/duplicate key|user_email_key|a@b\.c/);
  });
  it('the real error is logged server-side with the request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boom/db').expect(500);
    const logged = lines.map((l) => JSON.parse(l)).find((l) => l.data?.[0]?.requestId === res.body.requestId);
    expect(logged?.level).toBe('error');
  });
  it('HttpExceptions keep their code and safe extras in a uniform envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/boom/http').expect(409);
    expect(res.body).toMatchObject({ status: 409, code: 'custom_code', message: 'Nope', extra: 1 });
  });
  it('404 for unknown routes uses the same envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nothing').expect(404);
    expect(res.body).toMatchObject({ status: 404, code: 'not_found' });
    expect(res.body.requestId).toBeTruthy();
  });
});

describe('log redaction', () => {
  it('redacts sensitive keys at any depth, leaving other fields', () => {
    const out = redact({
      email: 'a@b.c',
      password: 'hunter2',
      nested: { token: 't', headers: { authorization: 'Bearer x', cookie: 'th_session=abc', ok: 1 } },
      list: [{ apiKey: 'k', name: 'n' }],
      totpCode: '123456',
    }) as Record<string, any>;
    expect(out.password).toBe('[REDACTED]');
    expect(out.nested.token).toBe('[REDACTED]');
    expect(out.nested.headers.authorization).toBe('[REDACTED]');
    expect(out.nested.headers.cookie).toBe('[REDACTED]');
    expect(out.nested.headers.ok).toBe(1);
    expect(out.list[0].apiKey).toBe('[REDACTED]');
    expect(out.list[0].name).toBe('n');
    expect(out.totpCode).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toMatch(/hunter2|th_session=abc|123456/);
  });
  it('the logger never prints a raw password passed in metadata', () => {
    const out: string[] = [];
    new JsonLogger((l) => void out.push(l)).log('login attempt', 'Auth', { password: 'hunter2', user: 'x' });
    expect(out[0]).not.toContain('hunter2');
  });
  it('filter class can be constructed with an injected logger', () => {
    expect(new AllExceptionsFilter(new JsonLogger(() => {}))).toBeTruthy();
  });
});

describe('security headers', () => {
  it('are present on API responses, including errors, and nothing is cacheable by default', async () => {
    const { createHarness } = await import('../testing/harness');
    const h = await createHarness();
    try {
      for (const url of ['/api/v1/health/live', '/api/v1/does-not-exist', '/api/v1/auth/me']) {
        const res = await h.http().get(url);
        expect(res.headers['x-content-type-options'], url).toBe('nosniff');
        expect(res.headers['x-frame-options'], url).toBe('DENY');
        expect(res.headers['referrer-policy'], url).toBe('no-referrer');
        expect(res.headers['content-security-policy'], url).toContain("default-src 'none'");
        expect(res.headers['cache-control'], url).toBe('no-store');
        expect(res.headers['x-powered-by']).toBeUndefined();
      }
    } finally {
      await h.close();
    }
  });
});
