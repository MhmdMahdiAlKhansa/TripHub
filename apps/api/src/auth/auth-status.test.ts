import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { createHarness } from '../testing/harness';

describe('GET /auth/status', () => {
  it('answers 200 with authenticated false when signed out, and true with a session', async () => {
    const h2 = await createHarness();
    try {
      expect((await h2.http().get('/api/v1/auth/status').expect(200)).body).toEqual({ authenticated: false });
      const u = await h2.newUser();
      expect((await h2.http().get('/api/v1/auth/status').set('Cookie', u.cookie).expect(200)).body).toEqual({ authenticated: true });
    } finally {
      await h2.close();
    }
  });
});
