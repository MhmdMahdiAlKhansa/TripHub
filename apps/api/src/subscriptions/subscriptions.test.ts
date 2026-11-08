import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from '../testing/harness';

let h: Harness;
let fin: TestUser;
beforeAll(async () => {
  h = await createHarness();
  fin = await h.staff('FINANCE');
});
afterAll(async () => h.close());

const LONG = 'A calm and carefully guided walk with plenty of time for photos and tea.';
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000 + Math.floor(Math.random() * 100000) * 1000).toISOString();
const key = () => `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const ref = () => `PAY-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const A = '/api/v1';
type Co = { owner: TestUser; companyId: string };

const sub = (c: Co) => h.http().get(`${A}/companies/${c.companyId}/subscription`).set('Cookie', c.owner.cookie);
const startTrial = (c: Co, bps = 1000) =>
  h.http().post(`${A}/companies/${c.companyId}/subscription/trial`).set('Cookie', c.owner.cookie).send({ acknowledgedCommissionBps: bps });
const requestPlan = (c: Co, plan: string, cycle = 'MONTHLY', addOns: object = {}) =>
  h.http().post(`${A}/companies/${c.companyId}/subscription/request`).set('Cookie', c.owner.cookie).send({ plan, cycle, addOns });
const fulfil = (requestId: string, u: TestUser = fin, body: object = { method: 'WHISH', reference: ref() }) =>
  h.http().post(`${A}/admin/subscription-requests/${requestId}/fulfil`).set('Cookie', u.cookie).send(body);

/** Publishes one free bookable listing; returns its response so limits can be asserted. */
async function publishOne(c: Co) {
  const l = await h.http().post(`${A}/companies/${c.companyId}/listings`).set('Cookie', c.owner.cookie).send({
    category: 'hiking', bookingMode: 'FIXED_DATE', city: 'Bsharri', meetingPoint: 'Village square',
    translations: { en: { title: 'Cedar Forest Walk', description: LONG } },
  }).expect(201);
  const id = l.body.listing.id as string;
  await h.http().put(`${A}/companies/${c.companyId}/listings/${id}/rates`).set('Cookie', c.owner.cookie)
    .send({ rates: [{ kind: 'ADULT', amount: 0, currency: 'USD' }] }).expect(200);
  return { id, res: await h.http().post(`${A}/companies/${c.companyId}/listings/${id}/publish`).set('Cookie', c.owner.cookie) };
}
const openRequestId = async (c: Co) => (await sub(c)).body.openRequest.id as string;
const setSub = (c: Co, data: object) => h.db.subscription.update({ where: { companyId: c.companyId }, data });

describe('plans', () => {
  it('lists the public catalog with prices in force, and Enterprise as negotiated', async () => {
    const r = await h.http().get(`${A}/plans`).expect(200);
    const by = Object.fromEntries(r.body.plans.map((p: { code: string }) => [p.code, p]));
    expect(by.STARTER).toMatchObject({ monthlyMinor: '1900', commissionBps: 1000, listingLimit: 5, teamLimit: 2 });
    expect(by.GROWTH).toMatchObject({ monthlyMinor: '4900', commissionBps: 700 });
    expect(by.PRO).toMatchObject({ monthlyMinor: '9900', commissionBps: 400, listingLimit: null });
    expect(by.ENTERPRISE).toMatchObject({ monthlyMinor: null, commissionBps: null });
  });

  it('price history is append-only', async () => {
    await expect(h.db.planPrice.updateMany({ data: { monthlyMinor: 1n } })).rejects.toThrow();
    await expect(h.db.planPrice.deleteMany({})).rejects.toThrow();
  });
});

describe('free trial', () => {
  it('needs an approved business, an acknowledged commission, and happens only once', async () => {
    const draft = await h.newUser();
    const created = await h.http().post(`${A}/companies`).set('Cookie', draft.cookie).send({ name: 'Draft Co', slug: `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` }).expect(201);
    await startTrial({ owner: draft, companyId: created.body.company.id }).expect(409);

    const c = await h.approvedCompany({ trial: false });
    expect((await sub(c)).body.trial).toMatchObject({ eligible: true, used: false });
    await startTrial(c, 0).expect(422); // must acknowledge the real rate
    const ok = await startTrial(c).expect(200);
    expect(ok.body.subscription).toMatchObject({ plan: 'TRIAL', status: 'TRIALING', commissionBps: 1000 });
    const days = (new Date(ok.body.subscription.trialEndsAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    await startTrial(c).expect(409);
    expect((await sub(c)).body.trial.used).toBe(true);
  });

  it('closes 14 days after approval, and billing needs the billing permission', async () => {
    const c = await h.approvedCompany({ trial: false });
    await h.db.company.update({ where: { id: c.companyId }, data: { approvedAt: new Date(Date.now() - 15 * 86_400_000) } });
    await startTrial(c).expect(409);
    expect((await sub(c)).body.trial.eligible).toBe(false);

    const c2 = await h.approvedCompany({ trial: false });
    const staffUser = await h.newUser();
    await h.http().post(`${A}/companies/${c2.companyId}/invitations`).set('Cookie', c2.owner.cookie).send({ email: staffUser.email, role: 'BOOKING_STAFF' }).expect(202);
    await h.http().post(`${A}/invitations/accept`).set('Cookie', staffUser.cookie).send({ token: h.lastToken(staffUser.email, 'company-invitation') }).expect(200);
    await h.http().post(`${A}/companies/${c2.companyId}/subscription/trial`).set('Cookie', staffUser.cookie).send({ acknowledgedCommissionBps: 1000 }).expect(403);
  });
});

describe('enforcement', () => {
  it('without a subscription nothing can be published or booked', async () => {
    const c = await h.approvedCompany({ trial: false });
    const p = await publishOne(c);
    expect(p.res.status).toBe(409);
    expect(p.res.body.code).toBe('subscription_required');
  });

  it('an expired trial stops new bookings and publishing but never touches existing ones', async () => {
    const c = await h.approvedCompany();
    const p = await publishOne(c);
    expect(p.res.status).toBe(200);
    const slot = await h.http().post(`${A}/companies/${c.companyId}/listings/${p.id}/slots`).set('Cookie', c.owner.cookie).send({ startsAt: inDays(7), capacity: 5 }).expect(201);
    const cust = await h.newUser();
    const book = () => h.http().post(`${A}/bookings`).set('Cookie', cust.cookie).set('Idempotency-Key', key())
      .send({ listingId: p.id, slotId: slot.body.slot.id, lines: [{ kind: 'ADULT', qty: 1 }] });
    const first = (await book().expect(201)).body.booking;

    await setSub(c, { trialEndsAt: new Date(Date.now() - 1000) });
    const r = await book();
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('business_not_accepting_bookings');
    expect((await publishOne(c)).res.status).toBe(409);
    // Existing booking is still manageable.
    await h.http().post(`${A}/companies/${c.companyId}/bookings/${first.id}/cancel`).set('Cookie', c.owner.cookie).send({}).expect(200);
    expect((await sub(c)).body.subscription.status).toBe('EXPIRED');
  });

  it('plan limits cap active listings; add-ons raise them; nothing is deleted', async () => {
    const c = await h.approvedCompany();
    await setSub(c, { planCode: 'STARTER', status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000), commissionBps: 1000 });
    for (let i = 0; i < 5; i++) expect((await publishOne(c)).res.status).toBe(200);
    const sixth = await publishOne(c);
    expect(sixth.res.status).toBe(409);
    expect(sixth.res.body).toMatchObject({ code: 'plan_limit_reached', limit: 'listings', max: 5 });

    await setSub(c, { addOns: { EXTRA_LISTING_PACK: 1 } });
    expect((await publishOne(c)).res.status).toBe(200);
    expect((await sub(c)).body.usage.activeListings).toBe(6);

    // Downgrading to a smaller allowance keeps everything published but blocks adding more.
    await setSub(c, { addOns: {} });
    expect((await sub(c)).body.usage.activeListings).toBe(6);
    expect((await publishOne(c)).res.status).toBe(409);
  });

  it('plan limits cap the team size', async () => {
    const c = await h.approvedCompany();
    await setSub(c, { planCode: 'STARTER', status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000), commissionBps: 1000 });
    const invite = (email: string) => h.http().post(`${A}/companies/${c.companyId}/invitations`).set('Cookie', c.owner.cookie).send({ email, role: 'MANAGER' });
    await invite(`a-${Date.now()}@example.test`).expect(202); // owner + 1 pending = 2 = Starter's limit
    const over = await invite(`b-${Date.now()}@example.test`);
    expect(over.status).toBe(409);
    expect(over.body).toMatchObject({ code: 'plan_limit_reached', limit: 'team', max: 2 });
  });
});

describe('paid plans (manual verified payment)', () => {
  it('trials never convert on their own; finance fulfils an explicit request and the price is snapshotted', async () => {
    const c = await h.approvedCompany();
    await requestPlan(c, 'ENTERPRISE').expect(400);
    const rq = await requestPlan(c, 'GROWTH', 'MONTHLY', { MARKETING: 1 }).expect(200);
    expect(rq.body.openRequest).toMatchObject({ plan: 'GROWTH' });
    expect((await sub(c)).body.subscription.plan).toBe('TRIAL'); // asking changes nothing

    const id = await openRequestId(c);
    const quote = await h.http().get(`${A}/admin/subscription-requests/${id}/quote`).set('Cookie', fin.cookie).expect(200);
    expect(quote.body.amountMinor).toBe('6100'); // 4900 + 1200 marketing

    const verifier = await h.staff('VERIFIER');
    await fulfil(id, verifier).expect(403);
    await fulfil(id, c.owner).expect(404); // not platform staff
    const shared = ref();
    const inv = (await fulfil(id, fin, { method: 'WHISH', reference: shared }).expect(200)).body.invoice;
    expect(inv).toMatchObject({ plan: 'GROWTH', amountMinor: '6100', paymentReference: shared });
    await fulfil(id).expect(409); // already fulfilled

    const s = (await sub(c)).body;
    expect(s.subscription).toMatchObject({ plan: 'GROWTH', status: 'ACTIVE', commissionBps: 700, monthlyMinor: '6100' });
    expect(s.openRequest).toBeNull();
    const end = new Date(s.subscription.currentPeriodEnd).getTime();
    expect(end).toBeGreaterThan(Date.now() + 27 * 86_400_000);

    // New bookings are sold at the contract's commission.
    const p = await publishOne(c);
    const slot = await h.http().post(`${A}/companies/${c.companyId}/listings/${p.id}/slots`).set('Cookie', c.owner.cookie).send({ startsAt: inDays(7), capacity: 5 }).expect(201);
    const cust = await h.newUser();
    const b = (await h.http().post(`${A}/bookings`).set('Cookie', cust.cookie).set('Idempotency-Key', key())
      .send({ listingId: p.id, slotId: slot.body.slot.id, lines: [{ kind: 'ADULT', qty: 1 }] }).expect(201)).body.booking;
    expect(b.snapshot.commissionBps).toBe(700);

    // The same transfer reference cannot pay two invoices.
    await requestPlan(c, 'GROWTH').expect(200);
    await fulfil(await openRequestId(c), fin, { method: 'WHISH', reference: shared }).expect(409);
  });

  it('renewal extends from the current end; annual billing gets the discount; the invoice list is private', async () => {
    const c = await h.approvedCompany();
    await requestPlan(c, 'GROWTH').expect(200);
    await fulfil(await openRequestId(c)).expect(200);
    const first = new Date((await sub(c)).body.subscription.currentPeriodEnd).getTime();

    await requestPlan(c, 'GROWTH', 'ANNUAL').expect(200);
    const inv = (await fulfil(await openRequestId(c)).expect(200)).body.invoice;
    expect(inv.amountMinor).toBe('49980'); // 4900 x 12 less 15%
    const second = new Date((await sub(c)).body.subscription.currentPeriodEnd).getTime();
    expect(second).toBeGreaterThan(first + 364 * 86_400_000);

    const list = await h.http().get(`${A}/companies/${c.companyId}/subscription/invoices`).set('Cookie', c.owner.cookie).expect(200);
    expect(list.body.invoices).toHaveLength(2);
    const other = await h.approvedCompany();
    await h.http().get(`${A}/companies/${c.companyId}/subscription/invoices`).set('Cookie', other.owner.cookie).expect(404);
    await expect(h.db.invoice.deleteMany({ where: { companyId: c.companyId } })).rejects.toThrow();
  });

  it('overdue: 7 days of grace still sell, then new bookings stop; renewal restores them', async () => {
    const c = await h.approvedCompany();
    await requestPlan(c, 'STARTER').expect(200);
    await fulfil(await openRequestId(c)).expect(200);
    const p = await publishOne(c);
    const slot = await h.http().post(`${A}/companies/${c.companyId}/listings/${p.id}/slots`).set('Cookie', c.owner.cookie).send({ startsAt: inDays(20), capacity: 5 }).expect(201);
    const cust = await h.newUser();
    const book = () => h.http().post(`${A}/bookings`).set('Cookie', cust.cookie).set('Idempotency-Key', key())
      .send({ listingId: p.id, slotId: slot.body.slot.id, lines: [{ kind: 'ADULT', qty: 1 }] });

    await setSub(c, { currentPeriodEnd: new Date(Date.now() - 3 * 86_400_000) });
    expect((await sub(c)).body.subscription.status).toBe('PAST_DUE');
    await book().expect(201);

    await setSub(c, { currentPeriodEnd: new Date(Date.now() - 8 * 86_400_000) });
    expect((await sub(c)).body.subscription.status).toBe('SUSPENDED');
    expect((await book()).status).toBe(409);

    await requestPlan(c, 'STARTER').expect(200);
    await fulfil(await openRequestId(c)).expect(200);
    expect((await sub(c)).body.subscription.status).toBe('ACTIVE');
    await book().expect(201);
  });

  it('cancelling keeps access to the end of the paid period; cancelling a trial ends it now', async () => {
    const paid = await h.approvedCompany();
    await requestPlan(paid, 'STARTER').expect(200);
    await fulfil(await openRequestId(paid)).expect(200);
    const after = await h.http().post(`${A}/companies/${paid.companyId}/subscription/cancel`).set('Cookie', paid.owner.cookie).expect(200);
    expect(after.body.subscription).toMatchObject({ cancelAtPeriodEnd: true, status: 'ACTIVE' });
    expect((await publishOne(paid)).res.status).toBe(200);

    const trial = await h.approvedCompany();
    const t = await h.http().post(`${A}/companies/${trial.companyId}/subscription/cancel`).set('Cookie', trial.owner.cookie).expect(200);
    expect(t.body.subscription.storedStatus).toBe('CANCELLED');
    expect((await publishOne(trial)).res.status).toBe(409);
    await h.http().post(`${A}/companies/${trial.companyId}/subscription/cancel`).set('Cookie', trial.owner.cookie).expect(409);
  });

  it('a platform user who belongs to the business cannot fulfil its request', async () => {
    const c = await h.approvedCompany();
    await requestPlan(c, 'STARTER').expect(200);
    const insider = await h.staff('FINANCE');
    await h.db.membership.create({ data: { companyId: c.companyId, userId: insider.id, role: 'MANAGER', status: 'ACTIVE' } });
    await fulfil(await openRequestId(c), insider).expect(403);
  });
});
