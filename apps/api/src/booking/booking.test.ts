import 'reflect-metadata';
import { expireDueHolds } from '@triphub/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from '../testing/harness';

let h: Harness; // payments OFF (the real default)
let hp: Harness; // payments ON, to exercise HELD/hold-expiry mechanics that need a priced booking
beforeAll(async () => {
  h = await createHarness();
  hp = await createHarness({ features: { payments: true } });
});
afterAll(async () => {
  await h.close();
  await hp.close();
});

const LONG = 'A calm and carefully guided walk with plenty of time for photos and tea.';
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000 + Math.floor(Math.random() * 1000) * 1000).toISOString();
let k = 0;
const key = () => `idem-${Date.now()}-${k++}-${Math.random().toString(36).slice(2, 8)}`;

interface Fixture {
  owner: TestUser;
  companyId: string;
  listingId: string;
  slotId: string;
}

/** Published bookable listing + one slot. `price` in minor units (0 = free). */
async function fixture(harness: Harness, opts: { capacity: number; price?: number; mode?: string }): Promise<Fixture> {
  const { owner, companyId } = await harness.approvedCompany();
  const http = harness.http;
  const l = await http().post(`/api/v1/companies/${companyId}/listings`).set('Cookie', owner.cookie).send({
    category: 'hiking',
    bookingMode: opts.mode ?? 'FIXED_DATE',
    city: 'Bsharri',
    meetingPoint: 'Village square',
    translations: { en: { title: 'Cedar Forest Walk', description: LONG } },
  }).expect(201);
  const listingId = l.body.listing.id as string;
  await http().put(`/api/v1/companies/${companyId}/listings/${listingId}/rates`).set('Cookie', owner.cookie)
    .send({ rates: [{ kind: 'ADULT', amount: opts.price ?? 0, currency: 'USD' }, { kind: 'CHILD', amount: (opts.price ?? 0) / 2, currency: 'USD' }] }).expect(200);
  await http().post(`/api/v1/companies/${companyId}/listings/${listingId}/publish`).set('Cookie', owner.cookie).expect(200);
  const s = await http().post(`/api/v1/companies/${companyId}/listings/${listingId}/slots`).set('Cookie', owner.cookie)
    .send({ startsAt: inDays(7), capacity: opts.capacity }).expect(201);
  return { owner, companyId, listingId, slotId: s.body.slot.id };
}

const book = (harness: Harness, u: TestUser, f: Fixture, qty = 1, idem = key(), extra: object = {}) =>
  harness.http().post('/api/v1/bookings').set('Cookie', u.cookie).set('Idempotency-Key', idem)
    .send({ listingId: f.listingId, slotId: f.slotId, lines: [{ kind: 'ADULT', qty }], ...extra });

const users = (n: number) => Promise.all(Array.from({ length: n }, () => h.newUser()));

/** The invariant that must hold after ANY sequence of operations. */
async function assertConsistent(slotId: string) {
  const slot = await h.db.slot.findUniqueOrThrow({ where: { id: slotId } });
  const held = await h.db.booking.aggregate({
    where: { slotId, status: { in: ['HELD', 'CONFIRMED'] } },
    _sum: { quantity: true },
  });
  expect(slot.reserved, 'reserved must equal seats of HELD+CONFIRMED bookings').toBe(held._sum.quantity ?? 0);
  expect(slot.reserved).toBeLessThanOrEqual(slot.capacity);
  expect(slot.reserved).toBeGreaterThanOrEqual(0);
  const activeHolds = await h.db.hold.aggregate({ where: { slotId, status: 'ACTIVE' }, _sum: { quantity: true } });
  const heldSeats = await h.db.booking.aggregate({ where: { slotId, status: 'HELD' }, _sum: { quantity: true } });
  expect(activeHolds._sum.quantity ?? 0).toBe(heldSeats._sum.quantity ?? 0);
  return slot;
}

describe('rates and slots setup', () => {
  it('validates rate cards', async () => {
    const f = await fixture(h, { capacity: 5 });
    const put = (body: object) => h.http().put(`/api/v1/companies/${f.companyId}/listings/${f.listingId}/rates`).set('Cookie', f.owner.cookie).send(body);
    await put({ rates: [{ kind: 'ADULT', amount: 1, currency: 'USD' }, { kind: 'ADULT', amount: 2, currency: 'USD' }] }).expect(400);
    await put({ rates: [{ kind: 'ADULT', amount: 1, currency: 'USD' }, { kind: 'CHILD', amount: 1, currency: 'LBP' }] }).expect(400);
    await put({ rates: [{ kind: 'GROUP', amount: 100, currency: 'USD' }] }).expect(400);
    await put({ rates: [{ kind: 'ADULT', amount: 100, currency: 'USD', groupSize: 3 }] }).expect(400);
    await put({ rates: [{ kind: 'ADULT', amount: -5, currency: 'USD' }] }).expect(400);
    await put({ rates: [{ kind: 'ADULT', amount: 1.5, currency: 'USD' }] }).expect(400);
    await put({ rates: [{ kind: 'ADULT', amount: 5, currency: 'EUR' }] }).expect(400);
    await put({ rates: [{ kind: 'GROUP', amount: '9000', currency: 'USD', groupSize: 4 }] }).expect(200);
  });

  it('validates slots and refuses discovery-only listings', async () => {
    const f = await fixture(h, { capacity: 5 });
    const post = (body: object, listingId = f.listingId) =>
      h.http().post(`/api/v1/companies/${f.companyId}/listings/${listingId}/slots`).set('Cookie', f.owner.cookie).send(body);
    expect((await post({ startsAt: new Date(Date.now() - 3600_000).toISOString(), capacity: 5 }).expect(409)).body.code).toBe('slot_in_past');
    await post({ startsAt: inDays(3), capacity: 0 }).expect(400);
    await post({ startsAt: inDays(3), endsAt: inDays(2), capacity: 5 }).expect(400);
    await post({ startsAt: 'tomorrow', capacity: 5 }).expect(400);
    const when = inDays(20);
    await post({ startsAt: when, capacity: 5 }).expect(201);
    expect((await post({ startsAt: when, capacity: 5 }).expect(409)).body.code).toBe('slot_exists');

    const disc = await h.http().post(`/api/v1/companies/${f.companyId}/listings`).set('Cookie', f.owner.cookie)
      .send({ category: 'museums', translations: { en: { title: 'A museum', description: LONG } } }).expect(201);
    expect((await post({ startsAt: inDays(4), capacity: 5 }, disc.body.listing.id).expect(409)).body.code).toBe('listing_not_bookable');
  });

  it('capacity cannot be lowered below what is reserved', async () => {
    const f = await fixture(h, { capacity: 5 });
    const [u] = await users(1);
    await book(h, u!, f, 3).expect(201);
    const patch = (body: object) => h.http().patch(`/api/v1/companies/${f.companyId}/listings/${f.listingId}/slots/${f.slotId}`).set('Cookie', f.owner.cookie).send(body);
    expect((await patch({ capacity: 2 }).expect(409)).body.code).toBe('capacity_below_reserved');
    await patch({ capacity: 3 }).expect(200);
    await assertConsistent(f.slotId);
  });
});

describe('public availability and quote', () => {
  it('reports remaining seats and rates; hides unpublished and discovery listings', async () => {
    const f = await fixture(h, { capacity: 4 });
    const [u] = await users(1);
    await book(h, u!, f, 3).expect(201);
    const a = await h.http().get(`/api/v1/public/listings/${f.listingId}/availability`).expect(200);
    expect(a.body.slots[0]).toMatchObject({ capacity: 4, reserved: 3, remaining: 1 });
    expect(a.body.rates.map((r: { kind: string }) => r.kind).sort()).toEqual(['ADULT', 'CHILD']);
    await h.http().post(`/api/v1/companies/${f.companyId}/listings/${f.listingId}/pause`).set('Cookie', f.owner.cookie).expect(200);
    await h.http().get(`/api/v1/public/listings/${f.listingId}/availability`).expect(404);
  });

  it('prices on the server and ignores/refuses any client-supplied total', async () => {
    const f = await fixture(hp, { capacity: 10, price: 2500 });
    const q = await hp.http().post(`/api/v1/public/listings/${f.listingId}/quote`)
      .send({ lines: [{ kind: 'ADULT', qty: 2 }, { kind: 'CHILD', qty: 1 }] }).expect(200);
    expect(q.body).toMatchObject({ currency: 'USD', seats: 3, free: false, totalMinor: String(2 * 2500 + 1250) });
    await hp.http().post(`/api/v1/public/listings/${f.listingId}/quote`).send({ lines: [{ kind: 'ADULT', qty: 1 }], totalMinor: '1' }).expect(400);
    await hp.http().post(`/api/v1/public/listings/${f.listingId}/quote`).send({ lines: [{ kind: 'GROUP', qty: 1 }] }).expect(422);
    await hp.http().post(`/api/v1/public/listings/${f.listingId}/quote`).send({ lines: [{ kind: 'ADULT', qty: 99 }] }).expect(400);
  });
});

describe('creating bookings', () => {
  it('free bookings are confirmed instantly with an immutable server-built snapshot', async () => {
    const f = await fixture(h, { capacity: 6 });
    const [u] = await users(1);
    const r = await book(h, u!, f, 2, key(), { contactName: 'Layla Haddad', contactPhone: '+961 70 123 456' }).expect(201);
    const b = r.body.booking;
    expect(b).toMatchObject({ status: 'CONFIRMED', confirmed: true, awaitingPayment: false, quantity: 2, totalMinor: '0', currency: 'USD' });
    expect(b.reference).toMatch(/^TH-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(b.snapshot).toMatchObject({ version: 1, seats: 2, listing: { id: f.listingId }, slot: { id: f.slotId } });
    expect((await assertConsistent(f.slotId)).reserved).toBe(2);
  });

  it('requires login and an Idempotency-Key, and validates input', async () => {
    const f = await fixture(h, { capacity: 6 });
    const [u] = await users(1);
    await h.http().post('/api/v1/bookings').set('Idempotency-Key', key()).send({}).expect(401);
    await h.http().post('/api/v1/bookings').set('Cookie', u!.cookie).send({ listingId: f.listingId, slotId: f.slotId, lines: [{ kind: 'ADULT', qty: 1 }] }).expect(400);
    await book(h, u!, f, 1, 'short').expect(400);
    await book(h, u!, f, 0).expect(400);
    await book(h, u!, f, 1, key(), { totalMinor: '1' }).expect(400);
    await book(h, u!, f, 1, key(), { status: 'CONFIRMED' }).expect(400);
    await h.http().post('/api/v1/bookings').set('Cookie', u!.cookie).set('Idempotency-Key', key())
      .send({ listingId: f.listingId, slotId: '00000000-0000-4000-8000-000000000000', lines: [{ kind: 'ADULT', qty: 1 }] }).expect(404);
    expect((await assertConsistent(f.slotId)).reserved).toBe(0);
  });

  it('holds priced bookings for the operator-collected deposit while platform payments are off', async () => {
    const f = await fixture(h, { capacity: 6 });
    await h.db.listingRate.updateMany({ where: { listingId: f.listingId }, data: { amountMinor: 2500n } });
    const [u] = await users(1);
    const r = await book(h, u!, f).expect(201);
    expect(r.body.booking).toMatchObject({ status: 'HELD', deposit: { requiredMinor: '2500', receivedMinor: '0' } });
    expect((await assertConsistent(f.slotId)).reserved).toBe(1);
  });

  it('refuses closed, past and unbookable slots', async () => {
    const f = await fixture(h, { capacity: 6 });
    const [u] = await users(1);
    await h.http().patch(`/api/v1/companies/${f.companyId}/listings/${f.listingId}/slots/${f.slotId}`).set('Cookie', f.owner.cookie).send({ status: 'CLOSED' }).expect(200);
    expect((await book(h, u!, f).expect(409)).body.code).toBe('slot_unavailable');
    await h.db.slot.update({ where: { id: f.slotId }, data: { status: 'OPEN', startsAt: new Date(Date.now() - 60_000) } });
    expect((await book(h, u!, f).expect(409)).body.code).toBe('slot_unavailable');
  });

  it('a single request for more seats than remain is refused cleanly', async () => {
    const f = await fixture(h, { capacity: 3 });
    const [u] = await users(1);
    expect((await book(h, u!, f, 4).expect(409)).body.code).toBe('not_enough_capacity');
    expect((await assertConsistent(f.slotId)).reserved).toBe(0);
    expect(await h.db.booking.count({ where: { slotId: f.slotId } })).toBe(0); // rolled back, no orphan row
  });
});

describe('idempotency', () => {
  it('same key + same payload replays the original booking without reserving again', async () => {
    const f = await fixture(h, { capacity: 6 });
    const [u] = await users(1);
    const idem = key();
    const a = await book(h, u!, f, 2, idem).expect(201);
    const b = await book(h, u!, f, 2, idem).expect(200);
    expect(b.headers['idempotent-replay']).toBe('true');
    expect(b.body.booking.id).toBe(a.body.booking.id);
    expect((await assertConsistent(f.slotId)).reserved).toBe(2);
  });

  it('same key + different payload is a conflict and changes nothing', async () => {
    const f = await fixture(h, { capacity: 6 });
    const [u] = await users(1);
    const idem = key();
    await book(h, u!, f, 2, idem).expect(201);
    expect((await book(h, u!, f, 3, idem).expect(409)).body.code).toBe('idempotency_key_reuse');
    expect((await assertConsistent(f.slotId)).reserved).toBe(2);
  });

  it('keys are scoped per customer', async () => {
    const f = await fixture(h, { capacity: 6 });
    const [a, b] = await users(2);
    const idem = key();
    const r1 = await book(h, a!, f, 1, idem).expect(201);
    const r2 = await book(h, b!, f, 1, idem).expect(201);
    expect(r1.body.booking.id).not.toBe(r2.body.booking.id);
  });

  it('5 simultaneous identical requests create exactly one booking and reserve once', async () => {
    const f = await fixture(h, { capacity: 6 });
    const [u] = await users(1);
    const idem = key();
    const rs = await Promise.all(Array.from({ length: 5 }, () => book(h, u!, f, 2, idem)));
    const ok = rs.filter((r) => r.status === 200 || r.status === 201);
    expect(ok).toHaveLength(5);
    expect(new Set(ok.map((r) => r.body.booking.id)).size).toBe(1);
    expect(rs.filter((r) => r.status === 201).length).toBe(1);
    expect(await h.db.booking.count({ where: { slotId: f.slotId } })).toBe(1);
    expect((await assertConsistent(f.slotId)).reserved).toBe(2);
  });
});

describe('concurrency: no overbooking', () => {
  it('12 customers race for 5 seats: exactly 5 win', async () => {
    const f = await fixture(h, { capacity: 5 });
    const us = await users(12);
    const rs = await Promise.all(us.map((u) => book(h, u, f, 1)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(5);
    const losers = rs.filter((r) => r.status !== 201);
    expect(losers).toHaveLength(7);
    for (const r of losers) expect(r.body.code).toBe('not_enough_capacity');
    expect((await assertConsistent(f.slotId)).reserved).toBe(5);
    expect(await h.db.booking.count({ where: { slotId: f.slotId } })).toBe(5);
  });

  it('two customers race for the last seat: one wins', async () => {
    const f = await fixture(h, { capacity: 1 });
    const [a, b] = await users(2);
    const rs = await Promise.all([book(h, a!, f, 1), book(h, b!, f, 1)]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await assertConsistent(f.slotId)).reserved).toBe(1);
  });

  it('mixed party sizes never exceed capacity and seat counts add up', async () => {
    const f = await fixture(h, { capacity: 10 });
    const sizes = [3, 3, 3, 3, 3, 2, 2, 4];
    const us = await users(sizes.length);
    const rs = await Promise.all(us.map((u, i) => book(h, u, f, sizes[i]!)));
    const won = rs.map((r, i) => (r.status === 201 ? sizes[i]! : 0)).reduce((a, b) => a + b, 0);
    expect(won).toBeLessThanOrEqual(10);
    const slot = await assertConsistent(f.slotId);
    expect(slot.reserved).toBe(won);
  });

  it('lowering capacity while customers book never leaves reserved above capacity', async () => {
    const f = await fixture(h, { capacity: 10 });
    const us = await users(10);
    const patch = h.http().patch(`/api/v1/companies/${f.companyId}/listings/${f.listingId}/slots/${f.slotId}`)
      .set('Cookie', f.owner.cookie).send({ capacity: 4 });
    const results = await Promise.all([patch, ...us.map((u) => book(h, u, f, 1))]);
    void results;
    const slot = await assertConsistent(f.slotId);
    expect(slot.reserved).toBeLessThanOrEqual(slot.capacity);
  });
});

describe('cancellation', () => {
  it('releases seats exactly once, frees them for others, and rejects repeats', async () => {
    const f = await fixture(h, { capacity: 2 });
    const [a, b] = await users(2);
    const id = (await book(h, a!, f, 2).expect(201)).body.booking.id as string;
    expect((await book(h, b!, f, 1).expect(409)).body.code).toBe('not_enough_capacity');
    const c = await h.http().post(`/api/v1/bookings/${id}/cancel`).set('Cookie', a!.cookie).send({ reason: 'plans changed' }).expect(200);
    expect(c.body.booking.status).toBe('CANCELLED');
    await h.http().post(`/api/v1/bookings/${id}/cancel`).set('Cookie', a!.cookie).send({}).expect(409);
    await book(h, b!, f, 2).expect(201);
    expect((await assertConsistent(f.slotId)).reserved).toBe(2);
  });

  it('concurrent cancels release seats only once', async () => {
    const f = await fixture(h, { capacity: 4 });
    const [a] = await users(1);
    const id = (await book(h, a!, f, 3).expect(201)).body.booking.id as string;
    const rs = await Promise.all([1, 2, 3, 4].map(() => h.http().post(`/api/v1/bookings/${id}/cancel`).set('Cookie', a!.cookie).send({})));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await assertConsistent(f.slotId)).reserved).toBe(0);
  });

  it("customers cannot see or cancel each other's bookings", async () => {
    const f = await fixture(h, { capacity: 4 });
    const [a, b] = await users(2);
    const id = (await book(h, a!, f, 1).expect(201)).body.booking.id as string;
    await h.http().get(`/api/v1/bookings/${id}`).set('Cookie', b!.cookie).expect(404);
    await h.http().post(`/api/v1/bookings/${id}/cancel`).set('Cookie', b!.cookie).send({}).expect(404);
    const mine = await h.http().get('/api/v1/bookings').set('Cookie', b!.cookie).expect(200);
    expect(mine.body.bookings).toHaveLength(0);
    await h.http().get(`/api/v1/bookings/${id}`).set('Cookie', a!.cookie).expect(200);
  });

  it('the business sees its bookings, can cancel them, and other companies cannot', async () => {
    const f = await fixture(h, { capacity: 4 });
    const other = await h.approvedCompany();
    const [a] = await users(1);
    const id = (await book(h, a!, f, 2, key(), { contactName: 'Sam Aoun' }).expect(201)).body.booking.id as string;

    const list = await h.http().get(`/api/v1/companies/${f.companyId}/bookings`).set('Cookie', f.owner.cookie).expect(200);
    expect(list.body.bookings[0]).toMatchObject({ id, customerEmail: a!.email, contactName: 'Sam Aoun' });
    await h.http().get(`/api/v1/companies/${f.companyId}/bookings`).set('Cookie', other.owner.cookie).expect(404);
    await h.http().get(`/api/v1/companies/${other.companyId}/bookings/${id}`).set('Cookie', other.owner.cookie).expect(404);
    await h.http().post(`/api/v1/companies/${other.companyId}/bookings/${id}/cancel`).set('Cookie', other.owner.cookie).expect(404);

    await h.http().post(`/api/v1/companies/${f.companyId}/bookings/${id}/cancel`).set('Cookie', f.owner.cookie).send({ reason: 'guide unavailable' }).expect(200);
    expect((await assertConsistent(f.slotId)).reserved).toBe(0);
    expect(await h.db.auditEvent.count({ where: { entityId: id, action: 'booking.cancelled' } })).toBe(1);
  });
});

describe('holds (priced bookings, payments enabled in this harness only)', () => {
  it('a priced booking is HELD, not confirmed, with a bounded hold window', async () => {
    const f = await fixture(hp, { capacity: 4, price: 2500 });
    const u = await hp.newUser();
    const before = Date.now();
    const r = await book(hp, u, f, 2).expect(201);
    expect(r.body.booking).toMatchObject({ status: 'HELD', confirmed: false, awaitingPayment: true, totalMinor: '5000' });
    const exp = new Date(r.body.booking.holdExpiresAt).getTime();
    expect(exp).toBeGreaterThan(before + 14 * 60_000);
    expect(exp).toBeLessThan(Date.now() + 16 * 60_000);
    expect((await assertConsistent(f.slotId)).reserved).toBe(2);
  });

  it('the platform caps the hold window at 30 minutes in the database', async () => {
    const f = await fixture(hp, { capacity: 4, price: 2500 });
    await expect(h.db.listing.update({ where: { id: f.listingId }, data: { holdMinutes: 31 } })).rejects.toThrow();
    await expect(h.db.listing.update({ where: { id: f.listingId }, data: { holdMinutes: 4 } })).rejects.toThrow();
    await h.db.listing.update({ where: { id: f.listingId }, data: { holdMinutes: 30 } });
  });

  it('an expired hold is released and its seats go to the next customer', async () => {
    const f = await fixture(hp, { capacity: 1, price: 2500 });
    const [a, b] = [await hp.newUser(), await hp.newUser()];
    const first = (await book(hp, a, f, 1).expect(201)).body.booking.id as string;
    expect((await book(hp, b, f, 1).expect(409)).body.code).toBe('not_enough_capacity');

    await h.db.hold.updateMany({ where: { bookingId: first }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await book(hp, b, f, 1).expect(201); // creation frees lapsed holds first
    expect((await h.db.booking.findUniqueOrThrow({ where: { id: first } })).status).toBe('EXPIRED');
    expect((await assertConsistent(f.slotId)).reserved).toBe(1);
  });

  it('running the expiry job concurrently releases seats exactly once', async () => {
    const f = await fixture(hp, { capacity: 5, price: 2500 });
    const u = await hp.newUser();
    const id = (await book(hp, u, f, 3).expect(201)).body.booking.id as string;
    await h.db.hold.updateMany({ where: { bookingId: id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const counts = await Promise.all([1, 2, 3, 4].map(() => expireDueHolds(h.db, { slotId: f.slotId })));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect((await assertConsistent(f.slotId)).reserved).toBe(0);
    expect(await expireDueHolds(h.db, { slotId: f.slotId })).toBe(0); // idempotent
  });

  it('cancel racing with expiry releases seats once and ends in one consistent state', async () => {
    const f = await fixture(hp, { capacity: 5, price: 2500 });
    const u = await hp.newUser();
    for (let i = 0; i < 5; i++) {
      const id = (await book(hp, u, f, 1).expect(201)).body.booking.id as string;
      await h.db.hold.updateMany({ where: { bookingId: id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await Promise.all([
        hp.http().post(`/api/v1/bookings/${id}/cancel`).set('Cookie', u.cookie).send({}),
        expireDueHolds(h.db, { slotId: f.slotId }),
      ]);
      const status = (await h.db.booking.findUniqueOrThrow({ where: { id } })).status;
      expect(['CANCELLED', 'EXPIRED']).toContain(status);
      await assertConsistent(f.slotId);
    }
    expect((await assertConsistent(f.slotId)).reserved).toBe(0);
  });

  it('an expired booking cannot be cancelled again', async () => {
    const f = await fixture(hp, { capacity: 2, price: 2500 });
    const u = await hp.newUser();
    const id = (await book(hp, u, f, 1).expect(201)).body.booking.id as string;
    await h.db.hold.updateMany({ where: { bookingId: id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expireDueHolds(h.db, { slotId: f.slotId });
    await hp.http().post(`/api/v1/bookings/${id}/cancel`).set('Cookie', u.cookie).send({}).expect(409);
    expect((await assertConsistent(f.slotId)).reserved).toBe(0);
  });
});

describe('database-level guarantees', () => {
  it('booking terms and snapshot are immutable and bookings cannot be deleted', async () => {
    const f = await fixture(h, { capacity: 3 });
    const [u] = await users(1);
    const id = (await book(h, u!, f, 1).expect(201)).body.booking.id as string;
    await expect(h.db.booking.update({ where: { id }, data: { totalMinor: 1n } })).rejects.toThrow(/immutable/);
    await expect(h.db.booking.update({ where: { id }, data: { quantity: 3 } })).rejects.toThrow(/immutable/);
    await expect(h.db.booking.update({ where: { id }, data: { snapshot: { hacked: true } } })).rejects.toThrow(/immutable/);
    await expect(h.db.booking.delete({ where: { id } })).rejects.toThrow(/cannot be deleted/);
    await h.db.booking.update({ where: { id }, data: { contactName: 'Updated Name' } }); // non-priced fields remain editable
  });

  it('the database itself refuses reserved > capacity or negative reserved', async () => {
    const f = await fixture(h, { capacity: 3 });
    await expect(h.db.slot.update({ where: { id: f.slotId }, data: { reserved: 4 } })).rejects.toThrow();
    await expect(h.db.slot.update({ where: { id: f.slotId }, data: { reserved: -1 } })).rejects.toThrow();
  });
});
