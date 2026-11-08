import path from 'node:path';
import { config } from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './index';

config({ path: path.resolve(__dirname, '../../../.env') });

const db = createPrismaClient();
afterAll(() => db.$disconnect());

describe('baseline schema constraints (real Postgres)', () => {
  it('audit_event rows cannot be updated or deleted', async () => {
    const ev = await db.auditEvent.create({
      data: { action: 'test.created', entityType: 'test', entityId: 'x' },
    });
    await expect(
      db.auditEvent.update({ where: { id: ev.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.auditEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
  });

  it('idempotency (scope, key) is unique', async () => {
    const key = `k-${Date.now()}`;
    await db.idempotencyKey.create({ data: { scope: 'test', key, requestHash: 'a' } });
    await expect(
      db.idempotencyKey.create({ data: { scope: 'test', key, requestHash: 'b' } }),
    ).rejects.toThrow();
  });

  it('sessions must expire after creation', async () => {
    const user = await db.user.create({ data: { email: `u-${Date.now()}@example.test` } });
    await expect(
      db.session.create({
        data: { userId: user.id, tokenHash: `t-${Date.now()}`, expiresAt: new Date(Date.now() - 60_000) },
      }),
    ).rejects.toThrow();
  });
});
