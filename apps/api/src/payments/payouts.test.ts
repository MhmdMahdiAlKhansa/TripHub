import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from '../testing/harness';

let hp: Harness;
let h0: Harness;
let fin1: TestUser;
let fin2: TestUser;
let fin3: TestUser;
beforeAll(async () => {
  hp = await createHarness({ features: { payments: true } });
  h0 = await createHarness();
  fin1 = await hp.staff('FINANCE');
  fin2 = await hp.staff('FINANCE');
  fin3 = await hp.staff('FINANCE');
});
afterAll(async () => {
  await hp.close();
  await h0.close();
});

const LONG = 'A calm and carefully guided walk with plenty of time for photos and tea.';
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000 + Math.floor(Math.random() * 100000) * 1000).toISOString();
const uniq = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const A = '/api/v1';

/** A business with one verified 5000-cent booking (4500 payable after 10% commission). */
async function earned() {
  const { owner, companyId } = await hp.approvedCompany();
  const l = await hp.http().post(`${A}/companies/${companyId}/listings`).set('Cookie', owner.cookie).send({
    category: 'hiking', bookingMode: 'FIXED_DATE', city: 'Bsharri', meetingPoint: 'Village square',
    translations: { en: { title: 'Cedar Forest Walk', description: LONG } },
  }).expect(201);
  const listingId = l.body.listing.id as string;
  await hp.http().put(`${A}/companies/${companyId}/listings/${listingId}/rates`).set('Cookie', owner.cookie)
    .send({ rates: [{ kind: 'ADULT', amount: 2500, currency: 'USD' }] }).expect(200);
  await hp.http().post(`${A}/companies/${companyId}/listings/${listingId}/publish`).set('Cookie', owner.cookie).expect(200);
  const s = await hp.http().post(`${A}/companies/${companyId}/listings/${listingId}/slots`).set('Cookie', owner.cookie)
    .send({ startsAt: inDays(7), capacity: 5 }).expect(201);
  const customer = await hp.newUser();
  const booking = (await hp.http().post(`${A}/bookings`).set('Cookie', customer.cookie).set('Idempotency-Key', uniq())
    .send({ listingId, slotId: s.body.slot.id, lines: [{ kind: 'ADULT', qty: 2 }] }).expect(201)).body.booking;
  const payment = (await hp.http().post(`${A}/bookings/${booking.id}/payments`).set('Cookie', customer.cookie)
    .send({ method: 'WHISH', reference: `R-${uniq()}` }).expect(201)).body.payment;
  await hp.http().post(`${A}/admin/payments/${payment.id}/verify`).set('Cookie', fin1.cookie).expect(200);
  return { owner, companyId, slotId: s.body.slot.id as string };
}
type C = { owner: TestUser; companyId: string; slotId: string };
const tripHappened = (c: C) => hp.db.slot.update({ where: { id: c.slotId }, data: { startsAt: new Date(Date.now() - 3 * 86_400_000) } });
const payable = async (c: C) => (await hp.http().get(`${A}/admin/companies/${c.companyId}/payable`).set('Cookie', fin1.cookie).expect(200)).body;
const request = (c: C, amountMinor: string, u: TestUser = fin1) =>
  hp.http().post(`${A}/admin/companies/${c.companyId}/payouts`).set('Cookie', u.cookie).send({ amountMinor, currency: 'USD' });
const act = (u: TestUser, id: string, what: 'approve' | 'reject' | 'paid', body: object = {}) =>
  hp.http().post(`${A}/admin/payouts/${id}/${what}`).set('Cookie', u.cookie).send(body);
const owedLedger = async (c: C) => {
  const rows = await hp.db.ledgerLine.findMany({ where: { account: { type: 'COMPANY_PAYABLE', companyId: c.companyId, currency: 'USD' } } });
  return -rows.reduce((s, r) => s + r.amountMinor, 0n);
};

describe('payable balance', () => {
  it('earnings stay inside the hold window until after the trip, and earmarked money cannot be requested twice', async () => {
    const c = await earned();
    expect(await payable(c)).toMatchObject({ owedMinor: '4500', heldMinor: '4500', eligibleMinor: '0' });
    const early = await request(c, '100').expect(409);
    expect(early.body.code).toBe('exceeds_eligible_balance');

    await tripHappened(c);
    expect(await payable(c)).toMatchObject({ owedMinor: '4500', heldMinor: '0', eligibleMinor: '4500' });
    await request(c, '4501').expect(409);
    await request(c, '4000').expect(201);
    expect(await payable(c)).toMatchObject({ earmarkedMinor: '4000', eligibleMinor: '500' });
    await request(c, '1000').expect(409); // already earmarked
    await request(c, '500').expect(201);

    const concurrent = await earned();
    await tripHappened(concurrent);
    const rs = await Promise.all([request(concurrent, '3000'), request(concurrent, '3000'), request(concurrent, '3000')]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await payable(concurrent)).eligibleMinor).toBe('1500');
  });

  it('validates amounts', async () => {
    const c = await earned();
    await tripHappened(c);
    await request(c, '0').expect(400);
    await request(c, '-5').expect(400);
    await request(c, '12.5').expect(400);
    await hp.http().post(`${A}/admin/companies/${c.companyId}/payouts`).set('Cookie', fin1.cookie).send({ amountMinor: 100, currency: 'USD' }).expect(400);
  });
});

describe('payout lifecycle', () => {
  it('three different people; the ledger moves only when the transfer is attested', async () => {
    const c = await earned();
    await tripHappened(c);
    const p = (await request(c, '4000').expect(201)).body.payout;
    expect(p).toMatchObject({ status: 'REQUESTED', state: 'under_review' });

    await act(fin1, p.id, 'approve').expect(403); // requester
    await act(fin2, p.id, 'approve').expect(200);
    expect(await owedLedger(c)).toBe(4500n); // approval alone moves no money
    await act(fin2, p.id, 'paid', { payoutReference: 'OMT-1111' }).expect(403); // approver
    await act(fin1, p.id, 'paid', { payoutReference: 'OMT-1111' }).expect(403); // requester
    const ref = `OMT-${uniq()}`;
    const paid = (await act(fin3, p.id, 'paid', { payoutReference: ref }).expect(200)).body.payout;
    expect(paid).toMatchObject({ status: 'PAID', state: 'paid', payoutReference: ref });
    await act(fin3, p.id, 'paid', { payoutReference: ref }).expect(409);

    expect(await owedLedger(c)).toBe(500n);
    const bal = await hp.http().get(`${A}/admin/ledger/balances`).set('Cookie', fin1.cookie).expect(200);
    expect(bal.body.totalsByCurrency.USD).toBe('0');

    const mine = await hp.http().get(`${A}/companies/${c.companyId}/payouts`).set('Cookie', c.owner.cookie).expect(200);
    expect(mine.body.balances.USD).toMatchObject({ owedMinor: '500', eligibleMinor: '500' });
    expect(mine.body.payouts[0]).toMatchObject({ state: 'paid' });
  });

  it('cannot be paid before approval; a rejected payout frees the earmark; references are unique', async () => {
    const c = await earned();
    await tripHappened(c);
    const p = (await request(c, '1000').expect(201)).body.payout;
    await act(fin2, p.id, 'paid', { payoutReference: 'OMT-2222' }).expect(409);
    await act(fin2, p.id, 'reject', { reason: 'Bank details unconfirmed.' }).expect(200);
    await act(fin3, p.id, 'approve').expect(409);
    expect((await payable(c)).earmarkedMinor).toBe('0');

    const shared = `OMT-${uniq()}`;
    const p1 = (await request(c, '500').expect(201)).body.payout;
    await act(fin2, p1.id, 'approve').expect(200);
    await act(fin3, p1.id, 'paid', { payoutReference: shared }).expect(200);
    const p2 = (await request(c, '500').expect(201)).body.payout;
    await act(fin2, p2.id, 'approve').expect(200);
    await act(fin3, p2.id, 'paid', { payoutReference: shared }).expect(409);
    expect((await hp.db.payout.findUniqueOrThrow({ where: { id: p2.id } })).status).toBe('APPROVED');
  });

  it('races on approval produce one winner and the database refuses tampering', async () => {
    const c = await earned();
    await tripHappened(c);
    const p = (await request(c, '1000').expect(201)).body.payout;
    const rs = await Promise.all([act(fin2, p.id, 'approve'), act(fin3, p.id, 'approve'), act(fin2, p.id, 'approve')]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    await expect(hp.db.payout.delete({ where: { id: p.id } })).rejects.toThrow();
    await expect(hp.db.payout.update({ where: { id: p.id }, data: { amountMinor: 5n } })).rejects.toThrow();
    await expect(hp.db.payout.update({ where: { id: p.id }, data: { status: 'REQUESTED' } })).rejects.toThrow();
  });
});

describe('access control and flags', () => {
  it('only finance with the permission, never a member of the business, and never across tenants', async () => {
    const c = await earned();
    await tripHappened(c);
    const verifier = await hp.staff('VERIFIER');
    await request(c, '100', verifier).expect(403);
    await request(c, '100', c.owner).expect(404);
    const insider = await hp.staff('FINANCE');
    await hp.db.membership.create({ data: { companyId: c.companyId, userId: insider.id, role: 'MANAGER', status: 'ACTIVE' } });
    await request(c, '100', insider).expect(403);

    const other = await hp.approvedCompany();
    await hp.http().get(`${A}/companies/${c.companyId}/payouts`).set('Cookie', other.owner.cookie).expect(404);
    await hp.http().post(`${A}/admin/payouts/${'0'.repeat(8)}-0000-4000-8000-000000000000/approve`).expect(401);
  });

  it('is unavailable while payments are off', async () => {
    const staff = await h0.staff('FINANCE');
    await h0.http().post(`${A}/admin/payouts/00000000-0000-4000-8000-000000000000/approve`).set('Cookie', staff.cookie).expect(409);
  });
});
