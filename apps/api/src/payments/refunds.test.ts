import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from '../testing/harness';

let hp: Harness;
let h0: Harness; // payments OFF
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

/** A confirmed booking: 2 x 2500 USD = 5000, 10% commission (500 / 4500). */
async function confirmed() {
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
  return { owner, companyId, customer, booking, payment };
}

type F = { owner: TestUser; companyId: string; booking: { id: string } };
const cancel = (f: F) => hp.http().post(`${A}/companies/${f.companyId}/bookings/${f.booking.id}/cancel`).set('Cookie', f.owner.cookie).send({});
const request = (f: F) =>
  hp.http().post(`${A}/companies/${f.companyId}/bookings/${f.booking.id}/refund`).set('Cookie', f.owner.cookie)
    .send({ reason: 'Customer cancelled; full refund agreed.' });
const act = (u: TestUser, id: string, what: 'approve' | 'reject' | 'paid', body: object = {}) =>
  hp.http().post(`${A}/admin/refunds/${id}/${what}`).set('Cookie', u.cookie).send(body);

const balance = async (type: string, currency: string, companyId?: string) => {
  const rows = await hp.db.ledgerLine.findMany({ where: { account: { type: type as never, currency, ...(companyId ? { companyId } : {}) } } });
  return rows.reduce((s, r) => s + r.amountMinor, 0n);
};

describe('refund lifecycle', () => {
  it('only a cancelled booking can be refunded; the full chain moves money truthfully', async () => {
    const f = await confirmed();
    await request(f).expect(409); // still confirmed
    await cancel(f).expect(200);
    expect(await balance('COMPANY_PAYABLE', 'USD', f.companyId)).toBe(-4500n);

    const created = (await request(f).expect(201)).body.refund;
    expect(created).toMatchObject({ status: 'REQUESTED', state: 'under_review', amountMinor: '5000' });
    await request(f).expect(409); // one refund per payment

    let view = await hp.http().get(`${A}/bookings/${f.booking.id}/refund`).set('Cookie', f.customer.cookie).expect(200);
    expect(view.body.refund.state).toBe('under_review');

    const approved = (await act(fin2, created.id, 'approve').expect(200)).body.refund;
    expect(approved).toMatchObject({ status: 'APPROVED', state: 'approved_awaiting_transfer' });
    expect(await balance('COMPANY_PAYABLE', 'USD', f.companyId)).toBe(0n);

    const paid = (await act(fin3, created.id, 'paid', { payoutReference: `OMT-${uniq()}` }).expect(200)).body.refund;
    expect(paid).toMatchObject({ status: 'PAID', state: 'refunded' });
    const bal = await hp.http().get(`${A}/admin/ledger/balances`).set('Cookie', fin1.cookie).expect(200);
    expect(bal.body.totalsByCurrency.USD).toBe('0');
    view = await hp.http().get(`${A}/bookings/${f.booking.id}/refund`).set('Cookie', f.customer.cookie).expect(200);
    expect(view.body.refund.state).toBe('refunded');
  });

  it('enforces separation of duties (requester, approver and payer differ)', async () => {
    const f = await confirmed();
    await cancel(f).expect(200);
    const r = (await hp.http().post(`${A}/admin/payments/${f.payment.id}/refund`).set('Cookie', fin1.cookie)
      .send({ reason: 'Opened by finance directly.' }).expect(201)).body.refund;
    await act(fin1, r.id, 'approve').expect(403);
    await act(fin2, r.id, 'approve').expect(200);
    await act(fin2, r.id, 'paid', { payoutReference: 'OMT-1234' }).expect(403);
    await act(fin1, r.id, 'paid', { payoutReference: 'OMT-1234' }).expect(403);
    await act(fin3, r.id, 'paid', { payoutReference: 'OMT-1234' }).expect(200);
    await act(fin3, r.id, 'paid', { payoutReference: 'OMT-1234' }).expect(409);
  });

  it('cannot be paid before approval, and approval happens exactly once under a race', async () => {
    const f = await confirmed();
    await cancel(f).expect(200);
    const r = (await request(f).expect(201)).body.refund;
    await act(fin2, r.id, 'paid', { payoutReference: 'OMT-9999' }).expect(409);
    const res = await Promise.all([act(fin2, r.id, 'approve'), act(fin3, r.id, 'approve'), act(fin2, r.id, 'approve')]);
    expect(res.map((x) => x.status).sort()).toEqual([200, 409, 409]);
    expect(await hp.db.journalEntry.count({ where: { idempotencyKey: `refund:${r.id}:approved` } })).toBe(1);
  });

  it('a rejected refund moves no money and cannot be approved later', async () => {
    const f = await confirmed();
    await cancel(f).expect(200);
    const r = (await request(f).expect(201)).body.refund;
    await act(fin2, r.id, 'reject', { reason: 'Not eligible under the agreed terms.' }).expect(200);
    await act(fin3, r.id, 'approve').expect(409);
    expect(await hp.db.journalEntry.count({ where: { idempotencyKey: { startsWith: `refund:${r.id}` } } })).toBe(0);
  });

  it('refunds verified-but-unallocated money without touching the business', async () => {
    const f = await confirmed();
    // Put the fixture into the unallocated state at data level (the natural path is covered in payments.test).
    await hp.db.$executeRawUnsafe('ALTER TABLE payment DISABLE TRIGGER payment_guard');
    try {
      await hp.db.payment.update({ where: { id: f.payment.id }, data: { status: 'VERIFIED_UNALLOCATED' } });
    } finally {
      await hp.db.$executeRawUnsafe('ALTER TABLE payment ENABLE TRIGGER payment_guard');
    }
    await request(f).expect(404); // the business has no say over unallocated money
    const r = (await hp.http().post(`${A}/admin/payments/${f.payment.id}/refund`).set('Cookie', fin1.cookie)
      .send({ reason: 'Seats were no longer available.' }).expect(201)).body.refund;
    const before = await hp.db.journalEntry.count({ where: { paymentId: f.payment.id } });
    await act(fin2, r.id, 'approve').expect(200);
    expect(await hp.db.journalEntry.count({ where: { paymentId: f.payment.id } })).toBe(before);
    await act(fin3, r.id, 'paid', { payoutReference: 'OMT-5555' }).expect(200);
    expect(await hp.db.journalEntry.count({ where: { paymentId: f.payment.id } })).toBe(before + 1);
  });
});

describe('refund access control and flags', () => {
  it('other tenants, customers and non-finance staff cannot act', async () => {
    const f = await confirmed();
    await cancel(f).expect(200);
    const other = await hp.approvedCompany();
    await hp.http().post(`${A}/companies/${other.companyId}/bookings/${f.booking.id}/refund`).set('Cookie', other.owner.cookie)
      .send({ reason: 'Not my booking at all.' }).expect(404);
    await hp.http().post(`${A}/companies/${f.companyId}/bookings/${f.booking.id}/refund`).set('Cookie', f.customer.cookie)
      .send({ reason: 'Customer is not a member.' }).expect(404);
    const r = (await request(f).expect(201)).body.refund;
    const verifier = await hp.staff('VERIFIER');
    await act(verifier, r.id, 'approve').expect(403);
    await act(f.customer, r.id, 'approve').expect(404);
    await hp.http().post(`${A}/admin/refunds/${r.id}/approve`).expect(401);
  });

  it('is unavailable while payments are off', async () => {
    const staff = await h0.staff('FINANCE');
    await h0.http().post(`${A}/admin/refunds/00000000-0000-4000-8000-000000000000/approve`).set('Cookie', staff.cookie).expect(409);
  });

  it('the database refuses to delete refunds or skip states', async () => {
    const f = await confirmed();
    await cancel(f).expect(200);
    const r = (await request(f).expect(201)).body.refund;
    await expect(hp.db.refund.delete({ where: { id: r.id } })).rejects.toThrow();
    await expect(
      hp.db.refund.update({ where: { id: r.id }, data: { status: 'PAID', paidBy: fin3.id, paidAt: new Date(), payoutReference: 'X-1234' } }),
    ).rejects.toThrow();
  });
});

describe('cancellation policy drives the refund', () => {
  const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);
  const moveSlot = async (bookingId: string, hours: number) => {
    const b = await hp.db.booking.findUniqueOrThrow({ where: { id: bookingId } });
    await hp.db.slot.update({ where: { id: b.slotId }, data: { startsAt: hoursFromNow(hours) } });
  };
  const customerCancel = (f: Awaited<ReturnType<typeof confirmed>>) =>
    hp.http().post(`${A}/bookings/${f.booking.id}/cancel`).set('Cookie', f.customer.cookie).send({});

  it('shows the policy and an estimate before cancelling, and snapshots the policy at booking', async () => {
    const f = await confirmed();
    expect(f.booking.snapshot.cancellationPolicy).toEqual({ code: 'MODERATE', version: 1 });
    const view = (await hp.http().get(`${A}/bookings/${f.booking.id}`).set('Cookie', f.customer.cookie)).body.booking;
    expect(view.cancellation).toEqual({ policy: 'MODERATE', refundIfCancelledNowMinor: '5000' });
    await moveSlot(f.booking.id, 48);
    const later = (await hp.http().get(`${A}/bookings/${f.booking.id}`).set('Cookie', f.customer.cookie)).body.booking;
    expect(later.cancellation.refundIfCancelledNowMinor).toBe('2500');
  });

  it('a customer cancelling inside the half-refund window gets half; the ledger reverses only that share', async () => {
    const f = await confirmed();
    await moveSlot(f.booking.id, 48);
    await customerCancel(f).expect(200);
    const r = (await request(f).expect(201)).body.refund;
    expect(r.amountMinor).toBe('2500');
    await act(fin2, r.id, 'approve').expect(200);
    // 2500 refunded: 250 commission and 2250 business share come back; the business keeps 2250 of 4500.
    expect(await balance('COMPANY_PAYABLE', 'USD', f.companyId)).toBe(-2250n);
    await act(fin3, r.id, 'paid', { payoutReference: `OMT-${uniq()}` }).expect(200);
    const bal = await hp.http().get(`${A}/admin/ledger/balances`).set('Cookie', fin1.cookie).expect(200);
    expect(bal.body.totalsByCurrency.USD).toBe('0');
  });

  it('too late for a refund: nothing is due, and the database refuses an oversized refund', async () => {
    const f = await confirmed();
    await moveSlot(f.booking.id, 2);
    await customerCancel(f).expect(200);
    const r = await request(f).expect(409);
    expect(r.body).toMatchObject({ code: 'no_refund_due', policy: 'MODERATE' });
    await expect(
      hp.db.refund.create({ data: { paymentId: f.payment.id, bookingId: f.booking.id, amountMinor: 5001n, currency: 'USD', reason: 'too much', requestedBy: fin1.id } }),
    ).rejects.toThrow();
  });

  it('when the business cancels, the customer is refunded in full whatever the policy or timing', async () => {
    const f = await confirmed();
    await moveSlot(f.booking.id, 2);
    await cancel(f).expect(200);
    expect((await request(f).expect(201)).body.refund.amountMinor).toBe('5000');
  });

  it('listings carry a policy (default moderate, changeable), and later edits never change an existing booking', async () => {
    const f = await confirmed();
    const b = await hp.db.booking.findUniqueOrThrow({ where: { id: f.booking.id } });
    const listing = await hp.http().get(`${A}/companies/${f.companyId}/listings/${b.listingId}`).set('Cookie', f.owner.cookie).expect(200);
    expect(listing.body.listing.cancellationPolicy).toBe('MODERATE');
    await hp.http().patch(`${A}/companies/${f.companyId}/listings/${b.listingId}`).set('Cookie', f.owner.cookie).send({ cancellationPolicy: 'NON_REFUNDABLE' }).expect(200);
    const pub = await hp.http().get(`${A}/public/listings/${b.listingId}`).expect(200);
    expect(pub.body.listing.cancellationPolicy).toBe('NON_REFUNDABLE');
    await hp.http().patch(`${A}/companies/${f.companyId}/listings/${b.listingId}`).set('Cookie', f.owner.cookie).send({ cancellationPolicy: 'WHENEVER' }).expect(400);
    await moveSlot(f.booking.id, 48);
    await customerCancel(f).expect(200);
    expect((await request(f).expect(201)).body.refund.amountMinor).toBe('2500'); // still the policy it was sold under
  });
});
