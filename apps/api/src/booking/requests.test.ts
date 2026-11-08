import 'reflect-metadata';
import { expireHoldsAndPromote } from '@triphub/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from '../testing/harness';

let hr: Harness; // requestToBook ON
let h0: Harness; // default (OFF)
beforeAll(async () => {
  hr = await createHarness({ features: { requestToBook: true } });
  h0 = await createHarness();
});
afterAll(async () => {
  await hr.close();
  await h0.close();
});

const LONG = 'A calm and carefully guided walk with plenty of time for photos and tea.';
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000 + Math.floor(Math.random() * 100000) * 1000).toISOString();
const key = () => `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const A = '/api/v1';

interface Fx { owner: TestUser; companyId: string; listingId: string; slotId: string }

async function fixture(capacity: number): Promise<Fx> {
  const { owner, companyId } = await hr.approvedCompany();
  const l = await hr.http().post(`${A}/companies/${companyId}/listings`).set('Cookie', owner.cookie).send({
    category: 'hiking', bookingMode: 'REQUEST_TO_BOOK', city: 'Bsharri', meetingPoint: 'Village square',
    translations: { en: { title: 'Private Cedar Walk', description: LONG } },
  }).expect(201);
  const listingId = l.body.listing.id as string;
  await hr.http().put(`${A}/companies/${companyId}/listings/${listingId}/rates`).set('Cookie', owner.cookie)
    .send({ rates: [{ kind: 'ADULT', amount: 0, currency: 'USD' }] }).expect(200);
  await hr.http().post(`${A}/companies/${companyId}/listings/${listingId}/publish`).set('Cookie', owner.cookie).expect(200);
  const s = await hr.http().post(`${A}/companies/${companyId}/listings/${listingId}/slots`).set('Cookie', owner.cookie)
    .send({ startsAt: inDays(7), capacity }).expect(201);
  return { owner, companyId, listingId, slotId: s.body.slot.id };
}

const request = (h: Harness, u: TestUser, f: Fx, qty: number) =>
  h.http().post(`${A}/bookings`).set('Cookie', u.cookie).set('Idempotency-Key', key())
    .send({ listingId: f.listingId, slotId: f.slotId, lines: [{ kind: 'ADULT', qty }] });
const decide = (f: Fx, id: string, what: 'approve' | 'decline', body: object = {}, u: TestUser = f.owner) =>
  hr.http().post(`${A}/companies/${f.companyId}/bookings/${id}/${what}`).set('Cookie', u.cookie).send(body);
const reserved = async (f: Fx) => (await hr.db.slot.findUniqueOrThrow({ where: { id: f.slotId } })).reserved;

describe('request to book', () => {
  it('stays off by default', async () => {
    const f = await fixture(5);
    const u = await h0.newUser();
    await request(h0, u, f, 1).expect(409);
  });

  it('a request holds nothing and is not a booking until the business approves', async () => {
    const f = await fixture(5);
    const u = await hr.newUser();
    const b = (await request(hr, u, f, 2).expect(201)).body.booking;
    expect(b).toMatchObject({ status: 'REQUESTED', confirmed: false, awaitingApproval: true, awaitingPayment: false });
    expect(await reserved(f)).toBe(0);
    expect(await hr.db.hold.count({ where: { bookingId: b.id } })).toBe(0);

    const ok = (await decide(f, b.id, 'approve').expect(200)).body.booking;
    expect(ok).toMatchObject({ status: 'CONFIRMED', confirmed: true, awaitingApproval: false });
    expect(await reserved(f)).toBe(2);
    await decide(f, b.id, 'approve').expect(409);
    await decide(f, b.id, 'decline', { reason: 'Too late to change my mind.' }).expect(409);
  });

  it('capacity is checked atomically at approval; a request that no longer fits stays pending', async () => {
    const f = await fixture(2);
    const [u1, u2] = await Promise.all([hr.newUser(), hr.newUser()]);
    const b1 = (await request(hr, u1, f, 2).expect(201)).body.booking;
    const b2 = (await request(hr, u2, f, 2).expect(201)).body.booking;
    await decide(f, b1.id, 'approve').expect(200);
    await decide(f, b2.id, 'approve').expect(409);
    expect((await hr.db.booking.findUniqueOrThrow({ where: { id: b2.id } })).status).toBe('REQUESTED');
    expect(await reserved(f)).toBe(2);
    await decide(f, b2.id, 'decline', { reason: 'The date is fully booked.' }).expect(200);
    expect(await reserved(f)).toBe(2);
  });

  it('racing approvals of two requests for the last seats confirm exactly one', async () => {
    const f = await fixture(2);
    const users = await Promise.all([hr.newUser(), hr.newUser(), hr.newUser()]);
    const bs = await Promise.all(users.map(async (u) => (await request(hr, u, f, 2).expect(201)).body.booking.id as string));
    const res = await Promise.all(bs.map((id) => decide(f, id, 'approve')));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await reserved(f)).toBe(2);
    const same = await Promise.all([decide(f, bs[0]!, 'approve'), decide(f, bs[0]!, 'approve')]);
    expect(same.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    expect(await reserved(f)).toBe(2);
  });

  it('declining or cancelling a request releases nothing (it held nothing)', async () => {
    const f = await fixture(4);
    const [u1, u2] = await Promise.all([hr.newUser(), hr.newUser()]);
    const b1 = (await request(hr, u1, f, 2).expect(201)).body.booking;
    const b2 = (await request(hr, u2, f, 1).expect(201)).body.booking;
    await decide(f, b1.id, 'decline', { reason: 'Guide is unavailable that day.' }).expect(200);
    await hr.http().post(`${A}/bookings/${b2.id}/cancel`).set('Cookie', u2.cookie).send({}).expect(200);
    expect(await reserved(f)).toBe(0);
    const view = await hr.http().get(`${A}/bookings/${b1.id}`).set('Cookie', u1.cookie).expect(200);
    expect(view.body.booking).toMatchObject({ status: 'DECLINED', declined: true, confirmed: false });
  });

  it('unanswered requests lapse and can no longer be approved', async () => {
    const f = await fixture(3);
    const u = await hr.newUser();
    const b = (await request(hr, u, f, 1).expect(201)).body.booking;
    await hr.db.booking.update({ where: { id: b.id }, data: { requestExpiresAt: new Date(Date.now() - 1000) } });
    await decide(f, b.id, 'approve').expect(409);
    await expireHoldsAndPromote(hr.db, {});
    expect((await hr.db.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('EXPIRED');
    expect(await reserved(f)).toBe(0);
  });

  it('only the owning business with booking.manage can decide', async () => {
    const f = await fixture(3);
    const u = await hr.newUser();
    const b = (await request(hr, u, f, 1).expect(201)).body.booking;
    const other = await hr.approvedCompany();
    await hr.http().post(`${A}/companies/${other.companyId}/bookings/${b.id}/approve`).set('Cookie', other.owner.cookie).expect(404);
    await decide(f, b.id, 'approve', {}, u).expect(404); // customer is not a member
    await hr.http().post(`${A}/companies/${f.companyId}/bookings/${b.id}/approve`).expect(401);
    await decide(f, b.id, 'decline', { reason: 'x' }).expect(400); // reason required
  });
});
