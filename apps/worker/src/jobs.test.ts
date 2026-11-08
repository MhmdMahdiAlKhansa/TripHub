import path from 'node:path';
import { config } from 'dotenv';
import { createPrismaClient } from '@triphub/database';
import { afterAll, describe, expect, it } from 'vitest';
import { createHandlers, JOB_EXPIRE_HOLDS, JOB_SETTLE_SUBSCRIPTIONS, runJob } from './jobs';

config({ path: path.resolve(__dirname, '../../../.env') });

const db = createPrismaClient();
afterAll(() => db.$disconnect());
const handlers = createHandlers({ db });

describe('job registry', () => {
  it('runs a registered job', async () => {
    await expect(runJob(handlers, 'system.ping', {})).resolves.toBeUndefined();
  });
  it('fails loudly for an unknown job instead of silently dropping it', async () => {
    await expect(runJob(handlers, 'does.not.exist', {})).rejects.toThrow(/No handler/);
  });
});

describe('bookings.expireHolds (real Postgres)', () => {
  it('releases a lapsed hold, restores the seats, and is idempotent on re-run', async () => {
    // Minimal rows: user -> company -> listing -> slot -> booking(HELD) + hold(lapsed).
    const stamp = Date.now().toString(36);
    const user = await db.user.create({ data: { email: `w-${stamp}@example.test` } });
    const company = await db.company.create({ data: { name: 'Worker Co', slug: `w-${stamp}`, status: 'APPROVED' } });
    const listing = await db.listing.create({ data: { companyId: company.id, category: 'hiking', bookingMode: 'FIXED_DATE', status: 'PUBLISHED' } });
    const slot = await db.slot.create({ data: { listingId: listing.id, startsAt: new Date(Date.now() + 86_400_000), capacity: 5, reserved: 2 } });
    const booking = await db.booking.create({
      data: {
        reference: `TH-W${stamp}`.slice(0, 11).toUpperCase(),
        companyId: company.id, listingId: listing.id, slotId: slot.id, customerId: user.id,
        status: 'HELD', quantity: 2, currency: 'USD', totalMinor: 5000n, snapshot: {},
        idempotencyKey: `k-${stamp}-aaaa`, requestHash: 'x',
      },
    });
    await db.hold.create({ data: { bookingId: booking.id, slotId: slot.id, quantity: 2, status: 'ACTIVE', expiresAt: new Date(Date.now() - 5000) } });

    const first = await runJob(handlers, JOB_EXPIRE_HOLDS, {});
    expect((first as { expired: number }).expired).toBeGreaterThanOrEqual(1);
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('EXPIRED');
    expect((await db.slot.findUniqueOrThrow({ where: { id: slot.id } })).reserved).toBe(0);
    expect((await db.hold.findUniqueOrThrow({ where: { bookingId: booking.id } })).status).toBe('EXPIRED');

    await runJob(handlers, JOB_EXPIRE_HOLDS, {});
    expect((await db.slot.findUniqueOrThrow({ where: { id: slot.id } })).reserved).toBe(0); // not released twice
  });
});

describe('billing.settleSubscriptions (real Postgres)', () => {
  it('persists the date-derived status: expired trial, overdue and suspended, and leaves current ones alone', async () => {
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const mk = async (tag: string, data: object) => {
      const company = await db.company.create({ data: { name: `S ${tag}`, slug: `s-${tag}-${stamp}`, status: 'APPROVED' } });
      return db.subscription.create({ data: { companyId: company.id, commissionBps: 1000, planCode: 'STARTER', ...data } as never });
    };
    const day = 86_400_000;
    const trial = await mk('t', { planCode: 'TRIAL', status: 'TRIALING', trialEndsAt: new Date(Date.now() - day) });
    const overdue = await mk('o', { status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() - 2 * day) });
    const suspended = await mk('x', { status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() - 9 * day) });
    const fine = await mk('f', { status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 20 * day) });

    await runJob(handlers, JOB_SETTLE_SUBSCRIPTIONS, {});
    const status = async (id: string) => (await db.subscription.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(trial.id)).toBe('EXPIRED');
    expect(await status(overdue.id)).toBe('PAST_DUE');
    expect(await status(suspended.id)).toBe('SUSPENDED');
    expect(await status(fine.id)).toBe('ACTIVE');
    await runJob(handlers, JOB_SETTLE_SUBSCRIPTIONS, {}); // idempotent
    expect(await status(overdue.id)).toBe('PAST_DUE');
  });
});
