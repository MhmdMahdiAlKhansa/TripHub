import 'reflect-metadata';
import { expireHoldsAndPromote } from '@triphub/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from '../testing/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());

const LONG = 'A calm and carefully guided walk with plenty of time for photos and tea.';
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000 + Math.floor(Math.random() * 100000) * 1000).toISOString();
const key = () => `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const A = '/api/v1';

interface Fx { owner: TestUser; companyId: string; listingId: string; slotId: string }

/** A free (so payments-flag independent) published listing with one slot. */
async function fixture(capacity: number): Promise<Fx> {
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
    .send({ startsAt: inDays(7), capacity }).expect(201);
  return { owner, companyId, listingId, slotId: s.body.slot.id };
}

const book = (u: TestUser, f: Fx, qty: number, extra: object = {}, idem = key()) =>
  h.http().post(`${A}/bookings`).set('Cookie', u.cookie).set('Idempotency-Key', idem)
    .send({ listingId: f.listingId, slotId: f.slotId, lines: [{ kind: 'ADULT', qty }], ...extra });
const join = (u: TestUser, f: Fx, seats: number) => h.http().post(`${A}/waitlist`).set('Cookie', u.cookie).send({ slotId: f.slotId, seats });
const cancelBooking = (f: Fx, bookingId: string) =>
  h.http().post(`${A}/companies/${f.companyId}/bookings/${bookingId}/cancel`).set('Cookie', f.owner.cookie).send({});
const entry = (id: string) => h.db.waitlistEntry.findUniqueOrThrow({ where: { id } });

/** reserved = seats of live bookings + seats held by outstanding offers. */
async function assertConsistent(slotId: string) {
  const slot = await h.db.slot.findUniqueOrThrow({ where: { id: slotId } });
  const live = await h.db.booking.aggregate({ where: { slotId, status: { in: ['HELD', 'CONFIRMED'] } }, _sum: { quantity: true } });
  const offers = await h.db.waitlistEntry.aggregate({ where: { slotId, status: 'OFFERED' }, _sum: { seats: true } });
  expect(slot.reserved).toBe((live._sum.quantity ?? 0) + (offers._sum.seats ?? 0));
  expect(slot.reserved).toBeLessThanOrEqual(slot.capacity);
}

describe('waitlist', () => {
  it('queues in order, blocks queue-jumping, and turns a freed seat into an offer that becomes a booking', async () => {
    const f = await fixture(2);
    const [a, b, c, d] = await Promise.all([h.newUser(), h.newUser(), h.newUser(), h.newUser()]);
    const aBooking = (await book(a, f, 2).expect(201)).body.booking;

    await join(d, f, 1).expect(201).then(async (r) => {
      expect(r.body.entry).toMatchObject({ state: 'waiting', position: 1 });
      await h.http().delete(`${A}/waitlist/${r.body.entry.id}`).set('Cookie', d.cookie).expect(204);
    });
    const eb = (await join(b, f, 2).expect(201)).body.entry;
    const ec = (await join(c, f, 1).expect(201)).body.entry;
    expect(ec.position).toBe(2);
    await join(b, f, 2).expect(409); // already waitlisted

    // Someone else cannot walk past the queue even though they fit once seats free up.
    await book(d, f, 1).expect(409);

    await cancelBooking(f, aBooking.id).expect(200);
    expect(await entry(eb.id)).toMatchObject({ status: 'OFFERED' });
    expect(await entry(ec.id)).toMatchObject({ status: 'WAITING' }); // 2 seats went to the head; nothing left
    await assertConsistent(f.slotId);
    await book(d, f, 1).expect(409); // still queued customers: no jumping

    const mine = await h.http().get(`${A}/waitlist`).set('Cookie', b.cookie).expect(200);
    expect(mine.body.entries[0]).toMatchObject({ state: 'offer_available', seats: 2 });

    // Wrong seat count, or someone else's offer, is refused; the right one converts exactly once.
    await book(b, f, 1, { waitlistEntryId: eb.id }).expect(422);
    await book(c, f, 2, { waitlistEntryId: eb.id }).expect(409);
    const idem = key();
    const won = await book(b, f, 2, { waitlistEntryId: eb.id }, idem).expect(201);
    expect(won.body.booking.status).toBe('CONFIRMED');
    await book(b, f, 2, { waitlistEntryId: eb.id }, idem).expect(200); // idempotent replay
    await book(b, f, 2, { waitlistEntryId: eb.id }).expect(409); // offer already used
    expect(await entry(eb.id)).toMatchObject({ status: 'CONVERTED' });
    await assertConsistent(f.slotId);
    expect((await h.db.slot.findUniqueOrThrow({ where: { id: f.slotId } })).reserved).toBe(2);
  });

  it('is strictly first-come-first-served: a head that does not fit blocks those behind it', async () => {
    const f = await fixture(3);
    const [a, x, b, c] = await Promise.all([h.newUser(), h.newUser(), h.newUser(), h.newUser()]);
    await book(a, f, 2).expect(201);
    const xb = (await book(x, f, 1).expect(201)).body.booking;
    const eb = (await join(b, f, 2).expect(201)).body.entry;
    const ec = (await join(c, f, 1).expect(201)).body.entry;
    await cancelBooking(f, xb.id).expect(200); // one seat frees; the head needs two
    expect((await entry(eb.id)).status).toBe('WAITING');
    expect((await entry(ec.id)).status).toBe('WAITING'); // C would fit but must not jump B
    await assertConsistent(f.slotId);
  });

  it('a lapsed offer gives its seats to the next customer; the late customer cannot book with it', async () => {
    const f = await fixture(1);
    const [a, b, c] = await Promise.all([h.newUser(), h.newUser(), h.newUser()]);
    const ab = (await book(a, f, 1).expect(201)).body.booking;
    const eb = (await join(b, f, 1).expect(201)).body.entry;
    const ec = (await join(c, f, 1).expect(201)).body.entry;
    await cancelBooking(f, ab.id).expect(200);
    expect((await entry(eb.id)).status).toBe('OFFERED');

    await h.db.waitlistEntry.update({ where: { id: eb.id }, data: { offerExpiresAt: new Date(Date.now() - 1000) } });
    await book(b, f, 1, { waitlistEntryId: eb.id }).expect(409); // lapsed even before the sweep runs
    await expireHoldsAndPromote(h.db, {}); // (the rejected booking attempt above already triggered the lazy sweep)
    expect((await entry(eb.id)).status).toBe('EXPIRED');
    expect((await entry(ec.id)).status).toBe('OFFERED');
    await assertConsistent(f.slotId);
    await book(c, f, 1, { waitlistEntryId: ec.id }).expect(201);
  });

  it('leaving an offer passes it on, and nobody can leave someone else\'s entry', async () => {
    const f = await fixture(1);
    const [a, b, c] = await Promise.all([h.newUser(), h.newUser(), h.newUser()]);
    const ab = (await book(a, f, 1).expect(201)).body.booking;
    const eb = (await join(b, f, 1).expect(201)).body.entry;
    const ec = (await join(c, f, 1).expect(201)).body.entry;
    await cancelBooking(f, ab.id).expect(200);
    await h.http().delete(`${A}/waitlist/${eb.id}`).set('Cookie', c.cookie).expect(404);
    await h.http().delete(`${A}/waitlist/${eb.id}`).set('Cookie', b.cookie).expect(204);
    expect((await entry(ec.id)).status).toBe('OFFERED');
    await assertConsistent(f.slotId);
  });

  it('with many joining concurrently, exactly the earliest is offered and seats are never over-reserved', async () => {
    const f = await fixture(1);
    const holder = await h.newUser();
    const hb = (await book(holder, f, 1).expect(201)).body.booking;
    const crowd = await Promise.all(Array.from({ length: 6 }, () => h.newUser()));
    const joined = await Promise.all(crowd.map((u) => join(u, f, 1)));
    expect(joined.every((r) => r.status === 201)).toBe(true);
    await Promise.all([cancelBooking(f, hb.id), expireHoldsAndPromote(h.db, { slotId: f.slotId }), expireHoldsAndPromote(h.db, { slotId: f.slotId })]);
    const all = await h.db.waitlistEntry.findMany({ where: { slotId: f.slotId }, orderBy: { seq: 'asc' } });
    expect(all.filter((e) => e.status === 'OFFERED').map((e) => e.id)).toEqual([all[0]!.id]);
    expect(all.slice(1).every((e) => e.status === 'WAITING')).toBe(true);
    await assertConsistent(f.slotId);
  });

  it('cannot join when seats are free, for impossible sizes, or without a session', async () => {
    const f = await fixture(4);
    const u = await h.newUser();
    await join(u, f, 2).expect(409); // simply book
    await join(u, f, 9).expect(409);
    await h.http().post(`${A}/waitlist`).send({ slotId: f.slotId, seats: 1 }).expect(401);
    await h.http().post(`${A}/waitlist`).set('Cookie', u.cookie).send({ slotId: f.slotId, seats: 0 }).expect(400);
  });
});
