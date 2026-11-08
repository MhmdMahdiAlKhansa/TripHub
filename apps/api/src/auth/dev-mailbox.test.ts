import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../testing/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());

describe('dev mailbox', () => {
  it('is invisible unless explicitly enabled, and never exposes tokens otherwise', async () => {
    const prev = process.env.DEV_MAILBOX;
    delete process.env.DEV_MAILBOX;
    try {
      await h.http().get('/api/v1/dev/mailbox').expect(404);
    } finally {
      if (prev !== undefined) process.env.DEV_MAILBOX = prev;
    }
  });

  it('is never available in production even if the flag is set', async () => {
    const env = { ...process.env };
    process.env.DEV_MAILBOX = '1';
    process.env.NODE_ENV = 'production';
    try {
      await h.http().get('/api/v1/dev/mailbox').expect(404);
    } finally {
      process.env.NODE_ENV = env.NODE_ENV;
      if (env.DEV_MAILBOX === undefined) delete process.env.DEV_MAILBOX;
      else process.env.DEV_MAILBOX = env.DEV_MAILBOX;
    }
  });
});
