import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from '../testing/harness';

let hp: Harness;
let fin: TestUser;
beforeAll(async () => {
  hp = await createHarness({ features: { payments: true } });
  fin = await hp.staff('FINANCE');
});
afterAll(async () => hp.close());

const LONG = 'A calm and carefully guided walk with plenty of time for photos and tea.';
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000 + Math.floor(Math.random() * 100000) * 1000).toISOString();
const uniq = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const key = () => `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const A = '/api/v1';

async function shop() {
  const { owner, companyId } = await hp.approvedCompany();
  const l = await hp.http().post(`${A}/companies/${companyId}/listings`).set('Cookie', owner.cookie).send({
    category: 'hiking', bookingMode: 'FIXED_DATE', city: 'Bsharri', meetingPoint: 'Square',
    translations: { en: { title: 'Cedar Walk', description: LONG } },
  }).expect(201);
  const listingId = l.body.listing.id as string;
  await hp.http().put(`${A}/companies/${companyId}/listings/${listingId}/rates`).set('Cookie', owner.cookie)
    .send({ rates: [{ kind: 'ADULT', amount: 2500, currency: 'USD' }] }).expect(200);
  await hp.http().post(`${A}/companies/${companyId}/listings/${listingId}/publish`).set('Cookie', owner.cookie).expect(200);
  const s = await hp.http().post(`${A}/companies/${companyId}/listings/${listingId}/slots`).set('Cookie', owner.cookie)
    .send({ startsAt: inDays(7), capacity: 30 }).expect(201);
  return { owner, companyId, listingId, slotId: s.body.slot.id as string };
}
type S = Awaited<ReturnType<typeof shop>>;
const mk = (s: S, body: object) => hp.http().post(`${A}/companies/${s.companyId}/promo-codes`).set('Cookie', s.owner.cookie).send(body);
const book = (s: S, u: TestUser, qty: number, promoCode?: string) =>
  hp.http().post(`${A}/bookings`).set('Cookie', u.cookie).set('Idempotency-Key', key())
    .send({ listingId: s.listingId, slotId: s.slotId, lines: [{ kind: 'ADULT', qty }], ...(promoCode ? { promoCode } : {}) });

describe('promo codes', () => {
  it('discounts the booking server-side; the payment, ledger and commission use the net amount', async () => {
    const s = await shop();
    const code = `SAVE${uniq()}`;
    await mk(s, { code, kind: 'PERCENT', percentBps: 1000 }).expect(201);
    const quote = await hp.http().post(`${A}/public/listings/${s.listingId}/quote`).send({ lines: [{ kind: 'ADULT', qty: 2 }], promoCode: code.toLowerCase() }).expect(200);
    expect(quote.body).toMatchObject({ grossMinor: '5000', discountMinor: '500', totalMinor: '4500' });

    const u = await hp.newUser();
    const b = (await book(s, u, 2, code).expect(201)).body.booking;
    expect(b.totalMinor).toBe('4500');
    expect(b.snapshot.promo).toEqual({ code, discountMinor: '500', grossMinor: '5000' });
    const pay = (await hp.http().post(`${A}/bookings/${b.id}/payments`).set('Cookie', u.cookie).send({ method: 'WHISH', reference: `R-${key()}` }).expect(201)).body.payment;
    expect(pay.amountMinor).toBe('4500');
    await hp.http().post(`${A}/admin/payments/${pay.id}/verify`).set('Cookie', fin.cookie).expect(200);
    const lines = await hp.db.ledgerLine.findMany({ where: { account: { type: 'COMPANY_PAYABLE', companyId: s.companyId } } });
    expect(lines.reduce((n, l) => n + l.amountMinor, 0n)).toBe(-4050n); // 4500 less 10% commission on the net
  });

  it('one use per customer; a cap is respected under a race; invalid codes say why', async () => {
    const s = await shop();
    const code = `ONCE${uniq()}`;
    await mk(s, { code, kind: 'FIXED', amountMinor: '300', currency: 'USD', maxRedemptions: 1 }).expect(201);
    const [a, b] = await Promise.all([hp.newUser(), hp.newUser()]);
    const res = await Promise.all([book(s, a, 1, code), book(s, b, 1, code)]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 422]);
    expect((res.find((r) => r.status === 422)!.body)).toMatchObject({ code: 'promo_invalid', reason: 'exhausted' });
    const winner = res.find((r) => r.status === 201)!.body.booking;
    expect(winner.totalMinor).toBe('2200');
    expect((await hp.db.promoCode.findFirstOrThrow({ where: { code, companyId: s.companyId } })).redeemed).toBe(1);

    const again = await book(s, a, 1, code); // same customer again
    expect(again.status).toBe(422);
    const bogus = await book(s, b, 1, 'NOPE123');
    expect(bogus.body).toMatchObject({ code: 'promo_invalid', reason: 'not_found' });
  });

  it('a lapsed or cancelled unpaid booking gives the redemption back', async () => {
    const s = await shop();
    const code = `BACK${uniq()}`;
    await mk(s, { code, kind: 'PERCENT', percentBps: 5000, maxRedemptions: 1 }).expect(201);
    const u = await hp.newUser();
    const first = (await book(s, u, 1, code).expect(201)).body.booking;
    await hp.http().post(`${A}/bookings/${first.id}/cancel`).set('Cookie', u.cookie).send({}).expect(200);
    expect((await hp.db.promoCode.findFirstOrThrow({ where: { code, companyId: s.companyId } })).redeemed).toBe(0);
    const second = await book(s, u, 1, code).expect(201);
    expect(second.body.booking.totalMinor).toBe('1250');
  });

  it('respects activation, validity window, listing scope and currency', async () => {
    const s = await shop();
    const other = await shop();
    const u = await hp.newUser();
    const off = `OFF${uniq()}`;
    const old = `OLD${uniq()}`;
    const scoped = `ONLY${uniq()}`;
    const lbp = `LBP${uniq()}`;
    const offId = (await mk(s, { code: off, kind: 'PERCENT', percentBps: 1000 }).expect(201)).body.promo.id;
    await hp.http().patch(`${A}/companies/${s.companyId}/promo-codes/${offId}`).set('Cookie', s.owner.cookie).send({ active: false }).expect(200);
    await mk(s, { code: old, kind: 'PERCENT', percentBps: 1000, validFrom: new Date(Date.now() - 2 * 86_400_000).toISOString(), validTo: new Date(Date.now() - 86_400_000).toISOString() }).expect(201);
    await mk(s, { code: scoped, kind: 'PERCENT', percentBps: 1000, listingId: other.listingId }).expect(404); // not this business's listing
    await mk(s, { code: lbp, kind: 'FIXED', amountMinor: '100000', currency: 'LBP' }).expect(201);
    expect((await book(s, u, 1, off)).body.reason).toBe('inactive');
    expect((await book(s, u, 1, old)).body.reason).toBe('expired');
    expect((await book(s, u, 1, lbp)).body.reason).toBe('no_discount'); // LBP code, USD listing
    // A code from another business is simply unknown here.
    const foreign = `FOR${uniq()}`;
    await mk(other, { code: foreign, kind: 'PERCENT', percentBps: 1000 }).expect(201);
    expect((await book(s, u, 1, foreign)).body.reason).toBe('not_found');
  });

  it('is a marketing feature with plan limits, private to the business and its managers', async () => {
    const s = await shop();
    for (let i = 0; i < 3; i++) await mk(s, { code: `LIM${i}${uniq()}`, kind: 'PERCENT', percentBps: 500 }).expect(201); // trial: 3 active
    const over = await mk(s, { code: `LIM9${uniq()}`, kind: 'PERCENT', percentBps: 500 }).expect(409);
    expect(over.body).toMatchObject({ code: 'plan_limit_reached', limit: 'promo_codes', max: 3 });
    // The marketing add-on lifts the limit.
    await hp.db.subscription.update({ where: { companyId: s.companyId }, data: { addOns: { MARKETING: 1 } } });
    await mk(s, { code: `LIM8${uniq()}`, kind: 'PERCENT', percentBps: 500 }).expect(201);

    await mk(s, { code: 'bad code', kind: 'PERCENT', percentBps: 500 }).expect(400);
    await mk(s, { code: `X${uniq()}`, kind: 'PERCENT', percentBps: 10_001 }).expect(400);
    const noPlan = await hp.approvedCompany({ trial: false });
    const r = await hp.http().post(`${A}/companies/${noPlan.companyId}/promo-codes`).set('Cookie', noPlan.owner.cookie).send({ code: `NP${uniq()}`, kind: 'PERCENT', percentBps: 500 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('marketing_not_included');

    const staffUser = await hp.newUser();
    await hp.http().post(`${A}/companies/${s.companyId}/invitations`).set('Cookie', s.owner.cookie).send({ email: staffUser.email, role: 'BOOKING_STAFF' }).expect(202);
    await hp.http().post(`${A}/invitations/accept`).set('Cookie', staffUser.cookie).send({ token: hp.lastToken(staffUser.email, 'company-invitation') }).expect(200);
    await hp.http().get(`${A}/companies/${s.companyId}/promo-codes`).set('Cookie', staffUser.cookie).expect(403);
    const other = await shop();
    await hp.http().get(`${A}/companies/${s.companyId}/promo-codes`).set('Cookie', other.owner.cookie).expect(404);
  });
});
