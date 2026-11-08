import 'reflect-metadata';
import { expireDueHolds } from '@triphub/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LedgerService } from '../ledger/ledger.service';
import { createHarness, type Harness, type TestUser } from '../testing/harness';

let h: Harness; // payments OFF (real default)
let hp: Harness; // payments ON
let finance: TestUser;
beforeAll(async () => {
  h = await createHarness();
  hp = await createHarness({ features: { payments: true } });
  finance = await hp.staff('FINANCE');
});
afterAll(async () => {
  await h.close();
  await hp.close();
});

const LONG = 'A calm and carefully guided walk with plenty of time for photos and tea.';
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000 + Math.floor(Math.random() * 100000) * 1000).toISOString();
let k = 0;
const key = () => `idem-${Date.now()}-${k++}-${Math.random().toString(36).slice(2, 8)}`;
let r = 0;
const ref = () => `REF-${Date.now().toString(36)}-${r++}-${Math.random().toString(36).slice(2, 7)}`;

interface Fixture { owner: TestUser; companyId: string; listingId: string; slotId: string }

async function fixture(opts: { capacity: number; price: number }): Promise<Fixture> {
  const { owner, companyId } = await hp.approvedCompany();
  const l = await hp.http().post(`/api/v1/companies/${companyId}/listings`).set('Cookie', owner.cookie).send({
    category: 'hiking', bookingMode: 'FIXED_DATE', city: 'Bsharri', meetingPoint: 'Village square',
    translations: { en: { title: 'Cedar Forest Walk', description: LONG } },
  }).expect(201);
  const listingId = l.body.listing.id as string;
  await hp.http().put(`/api/v1/companies/${companyId}/listings/${listingId}/rates`).set('Cookie', owner.cookie)
    .send({ rates: [{ kind: 'ADULT', amount: opts.price, currency: 'USD' }] }).expect(200);
  await hp.http().post(`/api/v1/companies/${companyId}/listings/${listingId}/publish`).set('Cookie', owner.cookie).expect(200);
  const s = await hp.http().post(`/api/v1/companies/${companyId}/listings/${listingId}/slots`).set('Cookie', owner.cookie)
    .send({ startsAt: inDays(7), capacity: opts.capacity }).expect(201);
  return { owner, companyId, listingId, slotId: s.body.slot.id };
}

const book = (u: TestUser, f: Fixture, qty = 1) =>
  hp.http().post('/api/v1/bookings').set('Cookie', u.cookie).set('Idempotency-Key', key())
    .send({ listingId: f.listingId, slotId: f.slotId, lines: [{ kind: 'ADULT', qty }] });
const pay = (u: TestUser, bookingId: string, body: object = { method: 'WHISH', reference: ref() }) =>
  hp.http().post(`/api/v1/bookings/${bookingId}/payments`).set('Cookie', u.cookie).send(body);
const verify = (u: TestUser, id: string) => hp.http().post(`/api/v1/admin/payments/${id}/verify`).set('Cookie', u.cookie);
const reject = (u: TestUser, id: string, reason = 'Transfer not found in our account.') =>
  hp.http().post(`/api/v1/admin/payments/${id}/reject`).set('Cookie', u.cookie).send({ reason });

/** A HELD booking with proof submitted. */
async function paid(opts: { capacity?: number; price?: number; qty?: number } = {}) {
  const f = await fixture({ capacity: opts.capacity ?? 5, price: opts.price ?? 2500 });
  const customer = await hp.newUser();
  const booking = (await book(customer, f, opts.qty ?? 2).expect(201)).body.booking;
  const payment = (await pay(customer, booking.id).expect(201)).body.payment;
  return { f, customer, booking, payment };
}

const entriesFor = (paymentId: string) =>
  h.db.journalEntry.findMany({ where: { paymentId }, include: { lines: { include: { account: true } } } });

describe('a payment proof is unverified evidence', () => {
  it('leaves the booking HELD, posts nothing to the ledger, and always uses the server-side amount', async () => {
    const { booking, payment } = await paid({ price: 2500, qty: 2 });
    expect(payment).toMatchObject({ status: 'PROOF_SUBMITTED', state: 'awaiting_verification', amountMinor: '5000', currency: 'USD' });
    const b = await h.db.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b.status).toBe('HELD');
    expect(await h.db.journalEntry.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it('the customer view never says confirmed while only a proof exists', async () => {
    const { customer, booking } = await paid();
    const v = await hp.http().get(`/api/v1/bookings/${booking.id}`).set('Cookie', customer.cookie).expect(200);
    expect(v.body.booking).toMatchObject({ status: 'HELD', confirmed: false });
    expect(v.body.booking.payments[0].state).toBe('awaiting_verification');
  });

  it('refuses everything while payments are disabled (the real default)', async () => {
    const f = await fixture({ capacity: 3, price: 2500 });
    const u = await hp.newUser();
    const b = (await book(u, f, 1).expect(201)).body.booking;
    await h.http().post(`/api/v1/bookings/${b.id}/payments`).set('Cookie', u.cookie).send({ method: 'WHISH', reference: ref() }).expect(409);
  });

  it('validates input and ownership', async () => {
    const f = await fixture({ capacity: 5, price: 2500 });
    const [a, b] = [await hp.newUser(), await hp.newUser()];
    const booking = (await book(a, f).expect(201)).body.booking;
    await pay(a, booking.id, { method: 'CARD', reference: ref() }).expect(400);
    await pay(a, booking.id, { method: 'WHISH', reference: 'no spaces allowed' }).expect(400);
    await pay(a, booking.id, { method: 'WHISH', reference: ref(), amountMinor: '1' }).expect(400); // client cannot set the amount
    await pay(b, booking.id).expect(404); // someone else's booking
    await hp.http().post(`/api/v1/bookings/${booking.id}/payments`).send({ method: 'WHISH' }).expect(401);
    const free = await fixture({ capacity: 5, price: 0 });
    const fb = (await book(a, free).expect(201)).body.booking;
    expect((await pay(a, fb.id).expect(409)).body.code).toBe('nothing_to_pay');
  });

  it('a payment reference can only be used once, and one proof may be pending per booking', async () => {
    const f = await fixture({ capacity: 5, price: 2500 });
    const [a, b] = [await hp.newUser(), await hp.newUser()];
    const ba = (await book(a, f).expect(201)).body.booking;
    const bb = (await book(b, f).expect(201)).body.booking;
    const shared = ref();
    await pay(a, ba.id, { method: 'WHISH', reference: shared }).expect(201);
    expect((await pay(b, bb.id, { method: 'WHISH', reference: shared }).expect(409)).body.code).toBe('reference_already_used');
    await pay(b, bb.id, { method: 'OMT', reference: shared }).expect(201); // different method is a different namespace
    expect((await pay(a, ba.id).expect(409)).body.code).toBe('payment_already_pending');
  });

  it('extends the hold once, never beyond the 30-minute platform cap', async () => {
    const f = await fixture({ capacity: 5, price: 2500 });
    const u = await hp.newUser();
    const booking = (await book(u, f).expect(201)).body.booking;
    const before = (await h.db.hold.findUniqueOrThrow({ where: { bookingId: booking.id } })).expiresAt.getTime();
    const sent = Date.now();
    await pay(u, booking.id).expect(201);
    const after = (await h.db.hold.findUniqueOrThrow({ where: { bookingId: booking.id } })).expiresAt.getTime();
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThanOrEqual(Date.now() + 30 * 60_000 + 1000);
    expect(after).toBeGreaterThanOrEqual(sent + 29 * 60_000);
  });
});

describe('verification and the ledger', () => {
  it('confirms the booking and posts a balanced entry: cash, company payable, commission', async () => {
    const { f, customer, booking, payment } = await paid({ price: 2500, qty: 2 }); // total 5000, 10% commission
    const res = await verify(finance, payment.id).expect(200);
    expect(res.body.payment).toMatchObject({ status: 'VERIFIED', state: 'verified' });

    const b = await h.db.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { hold: true } });
    expect(b.status).toBe('CONFIRMED');
    expect(b.hold?.status).toBe('CONSUMED');
    const view = await hp.http().get(`/api/v1/bookings/${booking.id}`).set('Cookie', customer.cookie).expect(200);
    expect(view.body.booking).toMatchObject({ status: 'CONFIRMED', confirmed: true });

    const [entry] = await entriesFor(payment.id);
    const by = Object.fromEntries(entry!.lines.map((l) => [l.account.type, l.amountMinor]));
    expect(by).toEqual({ PLATFORM_CASH: 5000n, COMPANY_PAYABLE: -4500n, PLATFORM_COMMISSION: -500n });
    expect(entry!.lines.reduce((s, l) => s + l.amountMinor, 0n)).toBe(0n);
    expect(entry!.lines.find((l) => l.account.type === 'COMPANY_PAYABLE')!.account.companyId).toBe(f.companyId);
  });

  it('uses the commission rate snapshotted at booking, not the current one', async () => {
    const { f, payment } = await paid({ price: 2500, qty: 2 });
    await h.db.company.update({ where: { id: f.companyId }, data: { commissionBps: 2500 } });
    await verify(finance, payment.id).expect(200);
    const [entry] = await entriesFor(payment.id);
    expect(entry!.lines.find((l) => l.account.type === 'PLATFORM_COMMISSION')!.amountMinor).toBe(-500n); // 10%, not 25%
  });

  it('only platform finance may verify or reject', async () => {
    const { customer, payment } = await paid();
    for (const role of ['ADMIN', 'VERIFIER', 'SUPPORT'] as const) {
      const s = await hp.staff(role);
      await verify(s, payment.id).expect(403);
      await reject(s, payment.id).expect(403);
    }
    await verify(customer, payment.id).expect(404); // ordinary users cannot even see the admin surface
    await hp.http().post(`/api/v1/admin/payments/${payment.id}/verify`).expect(401);
    const noMfa = await hp.newUser();
    await h.db.user.update({ where: { id: noMfa.id }, data: { platformRole: 'FINANCE' } });
    expect((await verify(noMfa, payment.id).expect(403)).body.code).toBe('mfa_required_for_staff');
    expect((await h.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PROOF_SUBMITTED');
  });

  it('verification needs a recent step-up', async () => {
    const { payment } = await paid();
    const fin = await hp.staff('FINANCE');
    await h.db.session.updateMany({ where: { userId: fin.id }, data: { stepUpAt: null } });
    expect((await verify(fin, payment.id).expect(403)).body.code).toBe('step_up_required');
  });

  it('separation of duties: nobody verifies their own payment or their own company\'s', async () => {
    const f = await fixture({ capacity: 5, price: 2500 });
    const selfFin = await hp.staff('FINANCE');
    const b = (await book(selfFin, f).expect(201)).body.booking;
    const p = (await pay(selfFin, b.id).expect(201)).body.payment;
    expect((await verify(selfFin, p.id).expect(403)).body.code).toBe('cannot_verify_own_payment');

    const memberFin = await hp.staff('FINANCE');
    await hp.http().post(`/api/v1/companies/${f.companyId}/invitations`).set('Cookie', f.owner.cookie).send({ email: memberFin.email, role: 'FINANCE' }).expect(202);
    await hp.http().post('/api/v1/invitations/accept').set('Cookie', memberFin.cookie).send({ token: hp.lastToken(memberFin.email, 'company-invitation') }).expect(200);
    expect((await verify(memberFin, p.id).expect(403)).body.code).toBe('conflict_of_interest');
    expect(await h.db.journalEntry.count({ where: { paymentId: p.id } })).toBe(0);
  });

  it('four simultaneous verifications produce exactly one decision and one ledger entry', async () => {
    const { payment } = await paid();
    const finances = await Promise.all([1, 2, 3, 4].map(() => hp.staff('FINANCE')));
    const rs = await Promise.all(finances.map((fin) => verify(fin, payment.id)));
    expect(rs.filter((x) => x.status === 200)).toHaveLength(1);
    expect(rs.filter((x) => x.status === 409)).toHaveLength(3);
    expect(await h.db.journalEntry.count({ where: { paymentId: payment.id } })).toBe(1);
    expect(await h.db.auditEvent.count({ where: { entityId: payment.id, action: 'payment.verified' } })).toBe(1);
  });

  it('a rejected payment leaves the booking HELD, posts nothing, and its reference stays blocked', async () => {
    const { customer, booking, payment } = await paid();
    await reject(finance, payment.id, 'short').expect(400);
    const res = await reject(finance, payment.id).expect(200);
    expect(res.body.payment).toMatchObject({ status: 'REJECTED', state: 'rejected' });
    expect((await h.db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('HELD');
    expect(await h.db.journalEntry.count({ where: { paymentId: payment.id } })).toBe(0);
    await verify(finance, payment.id).expect(409); // decided payments are final
    await pay(customer, booking.id, { method: 'WHISH', reference: payment.reference }).expect(409);
    await pay(customer, booking.id, { method: 'WHISH', reference: ref() }).expect(201); // a new attempt is allowed
  });

  it('an unrelated list endpoint is restricted by permission', async () => {
    await paid();
    const v = await hp.staff('VERIFIER');
    await hp.http().get('/api/v1/admin/payments').set('Cookie', v.cookie).expect(403);
    await hp.http().get('/api/v1/admin/ledger/balances').set('Cookie', v.cookie).expect(403);
    const list = await hp.http().get('/api/v1/admin/payments').set('Cookie', finance.cookie).expect(200);
    expect(list.body.payments.length).toBeGreaterThan(0);
    expect(list.body.payments[0].state).toBe('awaiting_verification');
  });
});

describe('verification when the booking has moved on', () => {
  it('revives an expired booking if its seats are still free', async () => {
    const { f, booking, payment } = await paid({ capacity: 5, qty: 2 });
    await h.db.hold.updateMany({ where: { bookingId: booking.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expireDueHolds(h.db, { slotId: f.slotId });
    expect((await h.db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('EXPIRED');
    expect((await h.db.slot.findUniqueOrThrow({ where: { id: f.slotId } })).reserved).toBe(0);

    await verify(finance, payment.id).expect(200);
    expect((await h.db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CONFIRMED');
    expect((await h.db.slot.findUniqueOrThrow({ where: { id: f.slotId } })).reserved).toBe(2);
    expect((await entriesFor(payment.id))[0]!.kind).toBe('PAYMENT_VERIFIED');
  });

  it('if the seats were taken meanwhile, the money is parked as owed back and never overbooks', async () => {
    const { f, customer, booking, payment } = await paid({ capacity: 2, qty: 2 });
    await h.db.hold.updateMany({ where: { bookingId: booking.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expireDueHolds(h.db, { slotId: f.slotId });
    const other = await hp.newUser();
    await book(other, f, 2).expect(201); // someone else now holds both seats
    void customer;

    const res = await verify(finance, payment.id).expect(200);
    expect(res.body.payment).toMatchObject({ status: 'VERIFIED_UNALLOCATED', state: 'verified_refund_due' });
    expect((await h.db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('EXPIRED');
    const slot = await h.db.slot.findUniqueOrThrow({ where: { id: f.slotId } });
    expect(slot.reserved).toBe(2);
    expect(slot.reserved).toBeLessThanOrEqual(slot.capacity);

    const [entry] = await entriesFor(payment.id);
    expect(entry!.kind).toBe('PAYMENT_UNALLOCATED');
    expect(Object.fromEntries(entry!.lines.map((l) => [l.account.type, l.amountMinor]))).toEqual({ PLATFORM_CASH: 5000n, REFUND_PAYABLE: -5000n });
  });

  it('a payment verified after the customer cancelled is owed back, not applied', async () => {
    const { customer, booking, payment } = await paid();
    await hp.http().post(`/api/v1/bookings/${booking.id}/cancel`).set('Cookie', customer.cookie).send({}).expect(200);
    const res = await verify(finance, payment.id).expect(200);
    expect(res.body.payment.status).toBe('VERIFIED_UNALLOCATED');
    expect((await h.db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CANCELLED');
  });
});

describe('ledger guarantees', () => {
  it('every currency nets to zero across the whole ledger', async () => {
    const res = await hp.http().get('/api/v1/admin/ledger/balances').set('Cookie', finance.cookie).expect(200);
    for (const total of Object.values(res.body.totalsByCurrency)) expect(total).toBe('0');
    expect(res.body.accounts.length).toBeGreaterThan(0);
  });

  it('posting is idempotent by key', async () => {
    const ledger = hp.app.get(LedgerService);
    const k2 = `test:${Date.now()}:${Math.random()}`;
    const post = () =>
      h.db.$transaction((tx) =>
        ledger.post(tx, {
          kind: 'TEST', idempotencyKey: k2, description: 'idempotency check', currency: 'USD',
          lines: [{ account: 'PLATFORM_CASH', amountMinor: 100n }, { account: 'REFUND_PAYABLE', amountMinor: -100n }],
        }),
      );
    const first = await post();
    const second = await post();
    expect(first.replay).toBe(false);
    expect(second).toEqual({ entryId: first.entryId, replay: true });
    expect(await h.db.journalEntry.count({ where: { idempotencyKey: k2 } })).toBe(1);
    expect(await h.db.ledgerLine.count({ where: { entryId: first.entryId } })).toBe(2);
  });

  it('refuses to build an unbalanced entry in code', async () => {
    const ledger = hp.app.get(LedgerService);
    await expect(
      h.db.$transaction((tx) =>
        ledger.post(tx, {
          kind: 'TEST', idempotencyKey: `bad:${Date.now()}`, description: 'x', currency: 'USD',
          lines: [{ account: 'PLATFORM_CASH', amountMinor: 100n }, { account: 'REFUND_PAYABLE', amountMinor: -99n }],
        }),
      ),
    ).rejects.toThrow(/balance/);
  });

  it('the database independently rejects an unbalanced entry at commit', async () => {
    await expect(
      h.db.$transaction(async (tx) => {
        const e = await tx.journalEntry.create({ data: { kind: 'X', idempotencyKey: `raw:${Date.now()}:${Math.random()}`, description: 'x' } });
        const acct = await tx.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_CASH', currency: 'USD', companyId: null } });
        await tx.ledgerLine.create({ data: { entryId: e.id, accountId: acct.id, amountMinor: 100n, currency: 'USD' } });
      }),
    ).rejects.toThrow();
  });

  it('the database rejects a line whose currency differs from its account', async () => {
    await expect(
      h.db.$transaction(async (tx) => {
        const e = await tx.journalEntry.create({ data: { kind: 'X', idempotencyKey: `cur:${Date.now()}:${Math.random()}`, description: 'x' } });
        const usd = await tx.ledgerAccount.findFirstOrThrow({ where: { type: 'PLATFORM_CASH', currency: 'USD', companyId: null } });
        await tx.ledgerLine.create({ data: { entryId: e.id, accountId: usd.id, amountMinor: 100n, currency: 'LBP' } });
      }),
    ).rejects.toThrow(/currency/);
  });

  it('journal entries and lines can never be changed or deleted', async () => {
    const { payment } = await paid();
    await verify(finance, payment.id).expect(200);
    const [entry] = await entriesFor(payment.id);
    await expect(h.db.ledgerLine.update({ where: { id: entry!.lines[0]!.id }, data: { amountMinor: 1n } })).rejects.toThrow(/append-only/);
    await expect(h.db.ledgerLine.delete({ where: { id: entry!.lines[0]!.id } })).rejects.toThrow(/append-only/);
    await expect(h.db.journalEntry.update({ where: { id: entry!.id }, data: { description: 'edited' } })).rejects.toThrow(/append-only/);
    await expect(h.db.journalEntry.delete({ where: { id: entry!.id } })).rejects.toThrow(/append-only/);
    await expect(h.db.$executeRawUnsafe('TRUNCATE "ledger_line"')).rejects.toThrow(/append-only/);
  });

  it('payment terms are immutable and a decided payment cannot change status', async () => {
    const { payment } = await paid();
    await expect(h.db.payment.update({ where: { id: payment.id }, data: { amountMinor: 1n } })).rejects.toThrow(/immutable/);
    await expect(h.db.payment.delete({ where: { id: payment.id } })).rejects.toThrow(/cannot be deleted/);
    await verify(finance, payment.id).expect(200);
    await expect(h.db.payment.update({ where: { id: payment.id }, data: { status: 'REJECTED' } })).rejects.toThrow(/cannot change status/);
  });
});
