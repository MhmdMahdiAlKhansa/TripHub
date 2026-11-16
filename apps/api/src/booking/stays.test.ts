import 'reflect-metadata';
import { beirutToday, shiftDay } from '@triphub/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from '../testing/harness';

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

const A = '/api/v1';
const LONG = 'A stone chalet above the valley with a fireplace, a garden and a view of the cedars.';
let k = 0;
const key = () => `stay-${Date.now()}-${k++}-${Math.random().toString(36).slice(2, 8)}`;
// Each test books far enough ahead (and on its own dates) not to collide with others sharing the database.
const base = () => shiftDay(beirutToday(), 20 + Math.floor(Math.random() * 300));

async function host(opts: { night?: number; weekend?: number; cleaning?: number; minNights?: number; maxGuests?: number } = {}) {
  const { owner, companyId } = await h.approvedCompany();
  await h.db.company.update({ where: { id: companyId }, data: { kind: 'HOST' } });
  const root = `${A}/companies/${companyId}/listings`;
  const l = await h.http().post(root).set('Cookie', owner.cookie).send({
    category: 'stays', bookingMode: 'NIGHTLY', city: 'Ehden', meetingPoint: 'At the chalet, Ehden main road',
    attributes: { propertyType: 'chalet', maxGuests: opts.maxGuests ?? 4, bedrooms: 2, beds: 3, bathrooms: 1, amenities: ['fireplace', 'wifi'], checkInTime: '14:00', checkOutTime: '11:00', minNights: opts.minNights ?? 1 },
    translations: { en: { title: 'Stone chalet in Ehden', description: LONG } },
  }).expect(201);
  const listingId = l.body.listing.id as string;
  const rates = [{ kind: 'NIGHT', amount: opts.night ?? 8000, currency: 'USD' }];
  if (opts.weekend) rates.push({ kind: 'WEEKEND_NIGHT', amount: opts.weekend, currency: 'USD' });
  if (opts.cleaning) rates.push({ kind: 'CLEANING', amount: opts.cleaning, currency: 'USD' });
  await h.http().put(`${root}/${listingId}/rates`).set('Cookie', owner.cookie).send({ rates }).expect(200);
  await h.http().post(`${root}/${listingId}/publish`).set('Cookie', owner.cookie).expect(200);
  return { owner, companyId, listingId, root };
}
const stay = (u: TestUser, listingId: string, checkIn: string, checkOut: string, guests = 2, extra: object = {}) =>
  h.http().post(`${A}/stays`).set('Cookie', u.cookie).set('Idempotency-Key', key()).send({ listingId, checkIn, checkOut, guests, ...extra });

describe('property hosts', () => {
  it('a host can only list stays, and a trip operator cannot list stays', async () => {
    const hst = await host();
    await h.http().post(hst.root).set('Cookie', hst.owner.cookie)
      .send({ category: 'hiking', bookingMode: 'FIXED_DATE', city: 'Ehden', translations: { en: { title: 'A hike', description: LONG } } }).expect(422);
    const op = await h.approvedCompany();
    const r = await h.http().post(`${A}/companies/${op.companyId}/listings`).set('Cookie', op.owner.cookie)
      .send({ category: 'stays', bookingMode: 'NIGHTLY', city: 'Ehden', translations: { en: { title: 'A chalet', description: LONG } } }).expect(422);
    expect(r.body.code).toBe('operators_cannot_list_stays');
    // Stay price cards only take nightly kinds, and trips can't take them.
    await h.http().put(`${hst.root}/${hst.listingId}/rates`).set('Cookie', hst.owner.cookie).send({ rates: [{ kind: 'ADULT', amount: 100, currency: 'USD' }] }).expect(422);
    await h.http().post(`${hst.root}/${hst.listingId}/slots`).set('Cookie', hst.owner.cookie).send({ startsAt: new Date(Date.now() + 86_400_000).toISOString(), capacity: 2 }).expect(409);
  });

  it('a business signing up as a host gets a HOST business', async () => {
    const e = `host-${Date.now()}@example.test`;
    await h.http().post(`${A}/auth/register`).send({ email: e, password: 'a-long-host-password-1', businessName: 'Tannourine Cabins', businessKind: 'HOST' }).expect(202);
    const u = await h.db.user.findUniqueOrThrow({ where: { email: e }, include: { memberships: { include: { company: true } } } });
    expect(u.memberships[0]!.company).toMatchObject({ kind: 'HOST', name: 'Tannourine Cabins', categories: ['stays'] });
  });
});

describe('booking a stay', () => {
  it('quotes nights, weekend nights and cleaning; the public calendar shows the booked nights', async () => {
    const hst = await host({ night: 8000, weekend: 11000, cleaning: 2500 });
    // Find the next Thursday after the base date so the stay covers Thu, Fri, Sat nights.
    let d = base();
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 4) d = shiftDay(d, 1);
    const q = await h.http().post(`${A}/public/listings/${hst.listingId}/stay-quote`).send({ checkIn: d, checkOut: shiftDay(d, 3), guests: 2 }).expect(200);
    expect(q.body.quote).toMatchObject({ nights: 3, weekendNights: 2, nightsMinor: '30000', cleaningMinor: '2500', totalMinor: '32500', available: true });

    const u = await h.newUser();
    const b = await stay(u, hst.listingId, d, shiftDay(d, 3), 2, { contactName: 'Maya Haddad', contactPhone: '+96170184522' }).expect(201);
    expect(b.body.booking).toMatchObject({ status: 'HELD', totalMinor: '32500', stay: { checkIn: d, checkOut: shiftDay(d, 3), nights: 3, guests: 2 } });

    const cal = await h.http().get(`${A}/public/listings/${hst.listingId}/stay-calendar`).query({ from: shiftDay(d, -1), to: shiftDay(d, 5) }).expect(200);
    expect(cal.body.unavailable).toEqual([{ from: d, to: shiftDay(d, 3) }]);
    expect(cal.body.rules).toMatchObject({ checkInTime: '14:00', checkOutTime: '11:00' });
    const again = await h.http().post(`${A}/public/listings/${hst.listingId}/stay-quote`).send({ checkIn: shiftDay(d, 1), checkOut: shiftDay(d, 2), guests: 2 }).expect(200);
    expect(again.body.quote.available).toBe(false);
  });

  it('never double-books: overlapping stays are refused, back-to-back stays are fine', async () => {
    const hst = await host();
    const d = base();
    const [a, b2, c] = await Promise.all([h.newUser(), h.newUser(), h.newUser()]);
    await stay(a, hst.listingId, d, shiftDay(d, 3)).expect(201);
    const clash = await stay(b2, hst.listingId, shiftDay(d, 2), shiftDay(d, 4)).expect(409);
    expect(clash.body.code).toBe('dates_unavailable');
    await stay(b2, hst.listingId, shiftDay(d, -2), shiftDay(d, 1)).expect(409); // overlaps the start
    await stay(c, hst.listingId, shiftDay(d, 3), shiftDay(d, 5)).expect(201); // checks in the day the first guest leaves
  });

  it('under a race of 12 guests for the same nights, exactly one wins', async () => {
    const hst = await host();
    const d = base();
    const users = await Promise.all(Array.from({ length: 12 }, () => h.newUser()));
    const res = await Promise.all(users.map((u) => stay(u, hst.listingId, d, shiftDay(d, 2))));
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(11);
    expect(await h.db.booking.count({ where: { listingId: hst.listingId, status: { in: ['HELD', 'CONFIRMED'] } } })).toBe(1);
  });

  it('cancelling a stay frees its nights again', async () => {
    const hst = await host();
    const d = base();
    const [a, b2] = await Promise.all([h.newUser(), h.newUser()]);
    const first = await stay(a, hst.listingId, d, shiftDay(d, 2)).expect(201);
    await stay(b2, hst.listingId, d, shiftDay(d, 2)).expect(409);
    await h.http().post(`${A}/bookings/${first.body.booking.id}/cancel`).set('Cookie', a.cookie).send({}).expect(200);
    await stay(b2, hst.listingId, d, shiftDay(d, 2)).expect(201);
  });

  it('enforces minimum nights and the guest limit, and refuses past dates', async () => {
    const hst = await host({ minNights: 2, maxGuests: 3 });
    const u = await h.newUser();
    const d = base();
    expect((await stay(u, hst.listingId, d, shiftDay(d, 1)).expect(422)).body.code).toBe('below_min_nights');
    expect((await stay(u, hst.listingId, d, shiftDay(d, 2), 4).expect(422)).body.code).toBe('too_many_guests');
    expect((await stay(u, hst.listingId, shiftDay(beirutToday(), -3), shiftDay(beirutToday(), -1)).expect(422)).body.code).toBe('check_in_in_past');
  });

  it('a recorded deposit confirms the stay; the host sees the guest on the calendar', async () => {
    const hst = await host({ night: 10000 });
    const u = await h.newUser();
    const d = base();
    const b = await stay(u, hst.listingId, d, shiftDay(d, 2), 2, { contactName: 'Karim Nassar', contactPhone: '+9613457219' }).expect(201);
    expect(b.body.booking.deposit.requiredMinor).toBe('20000');
    const dep = await h.http().post(`${A}/companies/${hst.companyId}/bookings/${b.body.booking.id}/deposits`).set('Cookie', hst.owner.cookie)
      .send({ method: 'OMT', amount: 20000, currency: 'USD', reference: 'OMT-778812' }).expect(201);
    expect(dep.body.confirmed).toBe(true);
    const cal = await h.http().get(`${hst.root}/${hst.listingId}/stays`).set('Cookie', hst.owner.cookie).expect(200);
    expect(cal.body.entries).toEqual([expect.objectContaining({ kind: 'STAY', from: d, to: shiftDay(d, 2), booking: expect.objectContaining({ status: 'CONFIRMED', guestName: 'Karim Nassar', guests: 2, nights: 2 }) })]);
  });
});

describe('host blocks', () => {
  it('blocked nights cannot be booked; a block cannot cover a booked night; unblocking frees them', async () => {
    const hst = await host();
    const d = base();
    const blk = await h.http().post(`${hst.root}/${hst.listingId}/stays/blocks`).set('Cookie', hst.owner.cookie).send({ from: d, to: shiftDay(d, 3), note: 'Family visit' }).expect(201);
    const u = await h.newUser();
    await stay(u, hst.listingId, shiftDay(d, 1), shiftDay(d, 2)).expect(409);
    await stay(u, hst.listingId, shiftDay(d, 5), shiftDay(d, 7)).expect(201);
    expect((await h.http().post(`${hst.root}/${hst.listingId}/stays/blocks`).set('Cookie', hst.owner.cookie).send({ from: shiftDay(d, 6), to: shiftDay(d, 8) }).expect(409)).body.code).toBe('dates_unavailable');
    await h.http().delete(`${hst.root}/${hst.listingId}/stays/blocks/${blk.body.block.id}`).set('Cookie', hst.owner.cookie).expect(204);
    await stay(u, hst.listingId, shiftDay(d, 1), shiftDay(d, 2)).expect(201);
  });

  it('another business cannot see or change a property calendar', async () => {
    const hst = await host();
    const other = await h.approvedCompany();
    await h.http().get(`${A}/companies/${other.companyId}/listings/${hst.listingId}/stays`).set('Cookie', other.owner.cookie).expect(404);
    await h.http().get(`${hst.root}/${hst.listingId}/stays`).set('Cookie', other.owner.cookie).expect(404);
  });
});
