import 'reflect-metadata';
import { expireHoldsAndPromote } from '@triphub/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from '../testing/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
afterAll(async () => h.close());

const LONG = 'A calm and carefully guided walk with plenty of time for photos and tea.';
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000 + Math.floor(Math.random() * 100000) * 1000).toISOString();
const key = () => `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const A = '/api/v1';

describe('mixed concurrent load on one slot', () => {
  it('bookings, cancellations, waitlist joins and sweeps together never break the seat invariant', async () => {
    const CAPACITY = 20;
    const USERS = 60;
    const { owner, companyId } = await h.approvedCompany();
    const l = await h.http().post(`${A}/companies/${companyId}/listings`).set('Cookie', owner.cookie).send({
      category: 'hiking', bookingMode: 'FIXED_DATE', city: 'Bsharri', meetingPoint: 'Village square',
      translations: { en: { title: 'Cedar Forest Walk', description: LONG } },
    }).expect(201);
    const listingId = l.body.listing.id as string;
    await h.http().put(`${A}/companies/${companyId}/listings/${listingId}/rates`).set('Cookie', owner.cookie)
      .send({ rates: [{ kind: 'ADULT', amount: 0, currency: 'USD' }] }).expect(200);
    await h.http().post(`${A}/companies/${companyId}/listings/${listingId}/publish`).set('Cookie', owner.cookie).expect(200);
    const s = await h.http().post(`${A}/companies/${companyId}/listings/${listingId}/slots`).set('Cookie', owner.cookie)
      .send({ startsAt: inDays(7), capacity: CAPACITY }).expect(201);
    const slotId = s.body.slot.id as string;

    const users: TestUser[] = await Promise.all(Array.from({ length: USERS }, () => h.newUser()));
    const book = (u: TestUser, extra: object = {}) =>
      h.http().post(`${A}/bookings`).set('Cookie', u.cookie).set('Idempotency-Key', key())
        .send({ listingId, slotId, lines: [{ kind: 'ADULT', qty: 1 }], ...extra });

    // Wave 1: everyone tries to book at once. Exactly CAPACITY win; the rest are refused cleanly.
    const wave1 = await Promise.all(users.map((u) => book(u)));
    const won = wave1.filter((r) => r.status === 201);
    expect(won).toHaveLength(CAPACITY);
    expect(wave1.filter((r) => r.status !== 201).every((r) => r.status === 409)).toBe(true);

    // Everyone who lost joins the queue at once; then half of the winners are cancelled while sweeps run.
    const losers = users.filter((_, i) => wave1[i]!.status !== 201);
    const joined = await Promise.all(losers.map((u) => h.http().post(`${A}/waitlist`).set('Cookie', u.cookie).send({ slotId, seats: 1 })));
    expect(joined.every((r) => r.status === 201)).toBe(true);

    const winners = won.map((r) => r.body.booking.id as string);
    await Promise.all([
      ...winners.slice(0, 10).map((id) => h.http().post(`${A}/companies/${companyId}/bookings/${id}/cancel`).set('Cookie', owner.cookie).send({})),
      expireHoldsAndPromote(h.db, { slotId }),
      expireHoldsAndPromote(h.db, { slotId }),
    ]);

    // Invariant: reserved == live bookings + outstanding offers, never above capacity.
    const slot = await h.db.slot.findUniqueOrThrow({ where: { id: slotId } });
    const live = await h.db.booking.aggregate({ where: { slotId, status: { in: ['HELD', 'CONFIRMED'] } }, _sum: { quantity: true } });
    const offers = await h.db.waitlistEntry.aggregate({ where: { slotId, status: 'OFFERED' }, _sum: { seats: true } });
    expect(slot.reserved).toBe((live._sum.quantity ?? 0) + (offers._sum.seats ?? 0));
    expect(slot.reserved).toBeLessThanOrEqual(CAPACITY);
    expect(offers._sum.seats).toBe(10); // exactly the freed seats, offered to the first ten in line

    // The ten offered are the ten earliest in the queue.
    const entries = await h.db.waitlistEntry.findMany({ where: { slotId }, orderBy: { seq: 'asc' } });
    expect(entries.slice(0, 10).every((e) => e.status === 'OFFERED')).toBe(true);
    expect(entries.slice(10).every((e) => e.status === 'WAITING')).toBe(true);

    // Offer holders convert concurrently; capacity still holds.
    const offered = entries.slice(0, 10);
    const byId = new Map(losers.map((u, i) => [u.id, u] as const));
    void byId;
    const conv = await Promise.all(
      offered.map((e) => {
        const u = users.find((x) => x.id === e.customerId)!;
        return book(u, { waitlistEntryId: e.id });
      }),
    );
    expect(conv.every((r) => r.status === 201)).toBe(true);
    const after = await h.db.slot.findUniqueOrThrow({ where: { id: slotId } });
    expect(after.reserved).toBe(CAPACITY);
  }, 120_000);
});
