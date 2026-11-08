import 'reflect-metadata';
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

async function business() {
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
    .send({ startsAt: inDays(7), capacity: 50 }).expect(201);
  const book = async (qty: number) => {
    const c = await h.newUser();
    return (await h.http().post(`${A}/bookings`).set('Cookie', c.cookie).set('Idempotency-Key', key())
      .send({ listingId, slotId: s.body.slot.id, lines: [{ kind: 'ADULT', qty }] }).expect(201)).body.booking.id as string;
  };
  return { owner, companyId, listingId, book };
}

describe('business analytics', () => {
  it('counts only this business, by status, with advanced breakdowns on the trial plan', async () => {
    const b = await business();
    const other = await business();
    await b.book(2);
    await b.book(3);
    const cancelled = await b.book(1);
    await h.http().post(`${A}/companies/${b.companyId}/bookings/${cancelled}/cancel`).set('Cookie', b.owner.cookie).send({}).expect(200);
    await other.book(4);

    const r = (await h.http().get(`${A}/companies/${b.companyId}/analytics`).set('Cookie', b.owner.cookie).expect(200)).body;
    expect(r.level).toBe('advanced');
    expect(r.bookingsByStatus).toEqual({ CONFIRMED: 2, CANCELLED: 1 });
    expect(r.seatsBooked).toBe(5);
    expect(r.bookedValueMinor).toEqual({ USD: '0' });
    expect(r.daily.reduce((s: number, d: { seats: number }) => s + d.seats, 0)).toBe(5);
    expect(r.topListings[0]).toMatchObject({ listingId: b.listingId, title: 'Cedar Forest Walk', seats: 5, bookings: 2 });
    expect(r.checkIn).toEqual({ checkedIn: 0, tripsAlreadyStarted: 0 });
  });

  it('basic plans get totals only', async () => {
    const b = await business();
    await b.book(1);
    await h.db.subscription.update({ where: { companyId: b.companyId }, data: { planCode: 'STARTER', status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000), commissionBps: 1000 } });
    const r = (await h.http().get(`${A}/companies/${b.companyId}/analytics`).set('Cookie', b.owner.cookie).expect(200)).body;
    expect(r.level).toBe('basic');
    expect(r.seatsBooked).toBe(1);
    expect(r.daily).toBeUndefined();
    expect(r.topListings).toBeUndefined();
  });

  it('validates the range and enforces access', async () => {
    const b = await business();
    const get = (q: string, u: TestUser = b.owner, id = b.companyId) => h.http().get(`${A}/companies/${id}/analytics${q}`).set('Cookie', u.cookie);
    await get('?from=nonsense').expect(400);
    await get(`?from=${new Date(Date.now() + 86_400_000).toISOString()}`).expect(400); // from after to
    await get(`?from=${new Date(Date.now() - 400 * 86_400_000).toISOString()}`).expect(400); // too long
    await get('?from=2020-01-01T00:00:00Z&to=2020-02-01T00:00:00Z').expect(200);

    const other = await business();
    await get('', other.owner).expect(404);
    const staff = await h.newUser();
    await h.http().post(`${A}/companies/${b.companyId}/invitations`).set('Cookie', b.owner.cookie).send({ email: staff.email, role: 'BOOKING_STAFF' }).expect(202);
    await h.http().post(`${A}/invitations/accept`).set('Cookie', staff.cookie).send({ token: h.lastToken(staff.email, 'company-invitation') }).expect(200);
    await get('', staff).expect(403);
    await h.http().get(`${A}/companies/${b.companyId}/analytics`).expect(401);
  });
});
