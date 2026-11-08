import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from '../testing/harness';

let h: Harness;
let support: TestUser;
beforeAll(async () => {
  h = await createHarness();
  support = await h.staff('SUPPORT');
});
afterAll(async () => h.close());

const LONG = 'A calm and carefully guided walk with plenty of time for photos and tea.';
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000 + Math.floor(Math.random() * 100000) * 1000).toISOString();
const key = () => `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const A = '/api/v1';

async function listing() {
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
    .send({ startsAt: inDays(7), capacity: 20 }).expect(201);
  return { owner, companyId, listingId, slotId: s.body.slot.id as string };
}
type L = Awaited<ReturnType<typeof listing>>;

async function booked(l: L, customer?: TestUser) {
  const c = customer ?? (await h.newUser());
  const b = (await h.http().post(`${A}/bookings`).set('Cookie', c.cookie).set('Idempotency-Key', key())
    .send({ listingId: l.listingId, slotId: l.slotId, lines: [{ kind: 'ADULT', qty: 1 }] }).expect(201)).body.booking;
  return { c, b };
}
const complete = (l: L, id: string) => h.http().post(`${A}/companies/${l.companyId}/bookings/${id}/complete`).set('Cookie', l.owner.cookie);
const review = (u: TestUser, id: string, body: object = { rating: 5, comment: 'Wonderful guide, great views.' }) =>
  h.http().post(`${A}/me/bookings/${id}/review`).set('Cookie', u.cookie).send(body);
const past = (l: L) => h.db.slot.update({ where: { id: l.slotId }, data: { startsAt: new Date(Date.now() - 86_400_000) } });

describe('completion and reviews', () => {
  it('only a completed, own booking can be reviewed, once, and the content cannot change', async () => {
    const l = await listing();
    const { c, b } = await booked(l);
    await review(c, b.id).expect(409); // not completed
    await complete(l, b.id).expect(409); // trip has not started
    await past(l);
    expect((await complete(l, b.id).expect(200)).body.booking.status).toBe('COMPLETED');
    await complete(l, b.id).expect(409);

    const stranger = await h.newUser();
    await review(stranger, b.id).expect(404);
    await review(c, b.id, { rating: 6 }).expect(400);
    await review(c, b.id, { rating: 0 }).expect(400);
    await review(c, b.id, { rating: 4.5 }).expect(400);
    const ok = await review(c, b.id, { rating: 4, comment: 'Lovely day out.' }).expect(201);
    expect(ok.body.review).toMatchObject({ rating: 4, status: 'VISIBLE' });
    await review(c, b.id).expect(409);

    await expect(h.db.review.update({ where: { id: ok.body.review.id }, data: { rating: 5 } })).rejects.toThrow();
    await expect(h.db.review.delete({ where: { id: ok.body.review.id } })).rejects.toThrow();
  });

  it('the database refuses a review without a genuine completed booking', async () => {
    const l = await listing();
    const { c, b } = await booked(l);
    await expect(
      h.db.review.create({ data: { bookingId: b.id, listingId: l.listingId, companyId: l.companyId, customerId: c.id, rating: 5 } }),
    ).rejects.toThrow();
  });

  it('shows verified reviews and an average publicly; hidden ones disappear with a recorded reason', async () => {
    const l = await listing();
    await past(l);
    const reviewIds: string[] = [];
    // Create three completed bookings directly (the slot is already in the past), then review through the API.
    for (const rating of [5, 4, 2]) {
      const c = await h.newUser();
      const row = await h.db.booking.create({
        data: {
          reference: `TH-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
          companyId: l.companyId, listingId: l.listingId, slotId: l.slotId, customerId: c.id,
          status: 'COMPLETED', quantity: 1, currency: 'USD', totalMinor: 0n, snapshot: {},
          idempotencyKey: key(), requestHash: 'x',
        },
      });
      const r = await review(c, row.id, { rating, comment: `Rating ${rating} experience.` }).expect(201);
      reviewIds.push(r.body.review.id);
    }
    const pub = await h.http().get(`${A}/public/listings/${l.listingId}/reviews`).expect(200);
    expect(pub.body.summary).toEqual({ count: 3, average: 3.7 });
    expect(pub.body.reviews.every((r: { verifiedBooking: boolean }) => r.verifiedBooking)).toBe(true);
    expect(JSON.stringify(pub.body)).not.toContain('@'); // no emails leak

    const low = reviewIds[2]!;
    const mod = (u: TestUser, body: object) => h.http().post(`${A}/admin/reviews/${low}/moderate`).set('Cookie', u.cookie).send(body);
    await mod(support, { status: 'HIDDEN' }).expect(400); // reason required
    await mod(l.owner, { status: 'HIDDEN', reason: 'I dislike this review.' }).expect(404); // business cannot moderate
    await mod(support, { status: 'HIDDEN', reason: 'Contains personal information.' }).expect(200);
    const after = await h.http().get(`${A}/public/listings/${l.listingId}/reviews`).expect(200);
    expect(after.body.summary).toEqual({ count: 2, average: 4.5 });
    const audit = await h.db.auditEvent.findFirst({ where: { action: 'review.hidden', entityId: low } });
    expect(audit?.meta).toMatchObject({ reason: 'Contains personal information.' });
    await mod(support, { status: 'VISIBLE', reason: 'Restored after review by lead.' }).expect(200);
    expect((await h.http().get(`${A}/public/listings/${l.listingId}/reviews`)).body.summary.count).toBe(3);

    const mine = await h.http().get(`${A}/companies/${l.companyId}/reviews`).set('Cookie', l.owner.cookie).expect(200);
    expect(mine.body.reviews).toHaveLength(3);
    const other = await h.approvedCompany();
    await h.http().get(`${A}/companies/${l.companyId}/reviews`).set('Cookie', other.owner.cookie).expect(404);
  });
});

describe('favorites and profile', () => {
  it('saves and removes favorites, only for public listings, privately per user', async () => {
    const l = await listing();
    const u = await h.newUser();
    const v = await h.newUser();
    await h.http().put(`${A}/me/favorites/${l.listingId}`).set('Cookie', u.cookie).expect(204);
    await h.http().put(`${A}/me/favorites/${l.listingId}`).set('Cookie', u.cookie).expect(204); // idempotent
    const mine = await h.http().get(`${A}/me/favorites`).set('Cookie', u.cookie).expect(200);
    expect(mine.body.listings).toHaveLength(1);
    expect((await h.http().get(`${A}/me/favorites`).set('Cookie', v.cookie)).body.listings).toHaveLength(0);

    await h.http().put(`${A}/me/favorites/00000000-0000-4000-8000-000000000000`).set('Cookie', u.cookie).expect(404);
    await h.http().post(`${A}/companies/${l.companyId}/listings/${l.listingId}/pause`).set('Cookie', l.owner.cookie).expect(200);
    expect((await h.http().get(`${A}/me/favorites`).set('Cookie', u.cookie)).body.listings).toHaveLength(0); // hidden, not deleted
    await h.http().delete(`${A}/me/favorites/${l.listingId}`).set('Cookie', u.cookie).expect(204);
    await h.http().get(`${A}/me/favorites`).expect(401);
  });

  it('updates only the display name and language', async () => {
    const u = await h.newUser();
    const r = await h.http().patch(`${A}/me/profile`).set('Cookie', u.cookie).send({ displayName: 'Maya K', locale: 'ar' }).expect(200);
    expect(r.body.user).toMatchObject({ displayName: 'Maya K', locale: 'ar' });
    await h.http().patch(`${A}/me/profile`).set('Cookie', u.cookie).send({ email: 'x@example.test' }).expect(400);
    await h.http().patch(`${A}/me/profile`).set('Cookie', u.cookie).send({ platformRole: 'ADMIN' }).expect(400);
    await h.http().patch(`${A}/me/profile`).set('Cookie', u.cookie).send({}).expect(400);
    await h.http().patch(`${A}/me/profile`).set('Cookie', u.cookie).send({ locale: 'fr' }).expect(400);
  });
});

describe('in-app notifications', () => {
  it('tells the right person about a waitlist offer, privately, and can be marked read', async () => {
    const l = await listing();
    // Fill the slot (capacity 20) so a second customer has to queue.
    const big = await h.newUser();
    await h.http().post(`${A}/bookings`).set('Cookie', big.cookie).set('Idempotency-Key', key())
      .send({ listingId: l.listingId, slotId: l.slotId, lines: [{ kind: 'ADULT', qty: 20 }] }).expect(201);
    const waiter = await h.newUser();
    const other = await h.newUser();
    await h.http().post(`${A}/waitlist`).set('Cookie', waiter.cookie).send({ slotId: l.slotId, seats: 1 }).expect(201);
    expect((await h.http().get(`${A}/me/notifications`).set('Cookie', waiter.cookie)).body.unread).toBe(0);

    const bookings = (await h.http().get(`${A}/bookings`).set('Cookie', big.cookie)).body.bookings;
    await h.http().post(`${A}/companies/${l.companyId}/bookings/${bookings[0].id}/cancel`).set('Cookie', l.owner.cookie).send({}).expect(200);

    const n = (await h.http().get(`${A}/me/notifications`).set('Cookie', waiter.cookie).expect(200)).body;
    expect(n.unread).toBe(1);
    expect(n.notifications[0]).toMatchObject({ kind: 'waitlist.offer', read: false });
    // The customer whose booking the business cancelled is told too; strangers see nothing.
    expect((await h.http().get(`${A}/me/notifications`).set('Cookie', big.cookie)).body.notifications.map((x: { kind: string }) => x.kind)).toContain('booking.cancelled_by_business');
    expect((await h.http().get(`${A}/me/notifications`).set('Cookie', other.cookie)).body.unread).toBe(0);

    const id = n.notifications[0].id as string;
    await h.http().post(`${A}/me/notifications/${id}/read`).set('Cookie', other.cookie).expect(404); // not theirs
    await h.http().post(`${A}/me/notifications/${id}/read`).set('Cookie', waiter.cookie).expect(204);
    await h.http().post(`${A}/me/notifications/${id}/read`).set('Cookie', waiter.cookie).expect(204); // idempotent
    expect((await h.http().get(`${A}/me/notifications`).set('Cookie', waiter.cookie)).body.unread).toBe(0);
    await h.http().post(`${A}/me/notifications/read-all`).set('Cookie', waiter.cookie).expect(204);
    await h.http().get(`${A}/me/notifications`).expect(401);
  });
});

describe('review moderation list', () => {
  it('lets only moderators list reviews by visibility', async () => {
    await h.http().get(`${A}/admin/reviews`).set('Cookie', support.cookie).expect(200);
    await h.http().get(`${A}/admin/reviews?status=HIDDEN`).set('Cookie', support.cookie).expect(200);
    await h.http().get(`${A}/admin/reviews?status=ALL`).set('Cookie', support.cookie).expect(400);
    const plain = await h.newUser();
    await h.http().get(`${A}/admin/reviews`).set('Cookie', plain.cookie).expect(404);
  });
});
