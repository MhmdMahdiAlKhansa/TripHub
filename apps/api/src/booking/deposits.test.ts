import 'reflect-metadata';
import { sendTripReminders } from '@triphub/database';
import { OPERATOR_DEPOSIT_HOURS } from '@triphub/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from '../testing/harness';

let h: Harness; // payments OFF: the operator collects deposits directly
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

const LONG = 'A calm and carefully guided walk with plenty of time for photos and tea.';
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000 + Math.floor(Math.random() * 1000) * 1000).toISOString();
let k = 0;
const key = () => `dep-${Date.now()}-${k++}-${Math.random().toString(36).slice(2, 8)}`;

async function trip(opts: { price: number; depositPercent?: number; pickupPoints?: string[]; startsInDays?: number }) {
  const { owner, companyId } = await h.approvedCompany();
  const base = `/api/v1/companies/${companyId}/listings`;
  const l = await h.http().post(base).set('Cookie', owner.cookie).send({
    category: 'hiking', bookingMode: 'FIXED_DATE', city: 'Bsharri', meetingPoint: 'Village square',
    pickupPoints: opts.pickupPoints ?? [], depositPercent: opts.depositPercent ?? 100,
    translations: { en: { title: 'Qadisha day hike', description: LONG } },
  }).expect(201);
  const listingId = l.body.listing.id as string;
  await h.http().put(`${base}/${listingId}/rates`).set('Cookie', owner.cookie).send({ rates: [{ kind: 'ADULT', amount: opts.price, currency: 'USD' }] }).expect(200);
  await h.http().post(`${base}/${listingId}/publish`).set('Cookie', owner.cookie).expect(200);
  const s = await h.http().post(`${base}/${listingId}/slots`).set('Cookie', owner.cookie).send({ startsAt: inDays(opts.startsInDays ?? 7), capacity: 4 }).expect(201);
  return { owner, companyId, listingId, slotId: s.body.slot.id as string };
}
const book = (u: TestUser, f: { listingId: string; slotId: string }, extra: object = {}) =>
  h.http().post('/api/v1/bookings').set('Cookie', u.cookie).set('Idempotency-Key', key()).send({ listingId: f.listingId, slotId: f.slotId, lines: [{ kind: 'ADULT', qty: 1 }], ...extra });
const deposit = (f: { owner: TestUser; companyId: string }, bookingId: string, body: object) =>
  h.http().post(`/api/v1/companies/${f.companyId}/bookings/${bookingId}/deposits`).set('Cookie', f.owner.cookie).send(body);

describe('operator-collected deposits (Whish / OMT / cash)', () => {
  it('a priced trip is held for the deposit, and the seat is confirmed once the operator records enough', async () => {
    const f = await trip({ price: 4000, depositPercent: 50 }); // $40, deposit $20
    const u = await h.newUser();
    const b = await book(u, f).expect(201);
    expect(b.body.booking.status).toBe('HELD');
    expect(b.body.booking.deposit).toMatchObject({ requiredMinor: '2000', receivedMinor: '0', depositMet: false });
    const holdMs = new Date(b.body.booking.holdExpiresAt).getTime() - Date.now();
    expect(holdMs).toBeGreaterThan((OPERATOR_DEPOSIT_HOURS - 1) * 3_600_000); // held for days, not minutes

    const half = await deposit(f, b.body.booking.id, { method: 'CASH', amount: 1000, currency: 'USD', note: 'paid at the shop' }).expect(201);
    expect(half.body).toMatchObject({ confirmed: false, summary: { receivedMinor: '1000', depositMet: false } });
    const rest = await deposit(f, b.body.booking.id, { method: 'WHISH', amount: 1000, currency: 'USD', reference: 'WH-12345' }).expect(201);
    expect(rest.body).toMatchObject({ confirmed: true, summary: { receivedMinor: '2000', remainingMinor: '2000', depositMet: true } });

    const mine = await h.http().get(`/api/v1/bookings/${b.body.booking.id}`).set('Cookie', u.cookie).expect(200);
    expect(mine.body.booking.status).toBe('CONFIRMED');
    expect(mine.body.booking.deposit.items).toHaveLength(2);
    expect(await h.db.hold.findFirstOrThrow({ where: { bookingId: b.body.booking.id } })).toMatchObject({ status: 'CONSUMED' });
    expect(await h.db.notification.count({ where: { userId: u.id, kind: 'booking.confirmed' } })).toBe(1);
    expect(await h.db.notification.count({ where: { userId: u.id, kind: 'deposit.received' } })).toBe(1);
  });

  it('refuses the wrong currency, zero amounts, other businesses, and cancelled bookings; deposits are append-only', async () => {
    const f = await trip({ price: 2500 });
    const u = await h.newUser();
    const id = (await book(u, f).expect(201)).body.booking.id as string;
    await deposit(f, id, { method: 'OMT', amount: 1000, currency: 'LBP' }).expect(409);
    await deposit(f, id, { method: 'OMT', amount: 0, currency: 'USD' }).expect(400);
    const other = await h.approvedCompany();
    await deposit(other, id, { method: 'CASH', amount: 1000, currency: 'USD' }).expect(404);
    const ok = await deposit(f, id, { method: 'CASH', amount: 500, currency: 'USD' }).expect(201);
    await expect(h.db.deposit.delete({ where: { id: ok.body.deposit.id } })).rejects.toThrow(/append-only/);
    await h.http().post(`/api/v1/bookings/${id}/cancel`).set('Cookie', u.cookie).send({}).expect(200);
    await deposit(f, id, { method: 'CASH', amount: 2000, currency: 'USD' }).expect(409);
    const csv = await h.http().get(`/api/v1/companies/${f.companyId}/bookings-export.csv`).set('Cookie', f.owner.cookie).expect(200);
    expect(csv.text).toContain('deposit_received_minor');
    expect(csv.text).toMatch(/,"?500"?,/);
  });

  it('a seat whose deposit never arrives is released when the hold lapses, and offered to the waitlist', async () => {
    const f = await trip({ price: 3000 });
    const [a, w] = await Promise.all([h.newUser(), h.newUser()]);
    await h.db.slot.update({ where: { id: f.slotId }, data: { capacity: 1 } });
    const held = (await book(a, f).expect(201)).body.booking;
    await h.http().post('/api/v1/waitlist').set('Cookie', w.cookie).send({ slotId: f.slotId, seats: 1 }).expect(201);
    await h.db.hold.update({ where: { bookingId: held.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await book(await h.newUser(), f); // any booking attempt sweeps lapsed holds on the slot first
    const after = await h.db.booking.findUniqueOrThrow({ where: { id: held.id } });
    expect(after.status).toBe('EXPIRED');
    expect((await h.db.waitlistEntry.findFirstOrThrow({ where: { slotId: f.slotId, customerId: w.id } })).status).toBe('OFFERED');
  });
});

describe('participant details', () => {
  it('requires one of the listing pickup points, stores the emergency contact, and shows both to the operator', async () => {
    const f = await trip({ price: 0, pickupPoints: ['Hamra, Beirut', 'Jounieh highway'] });
    const u = await h.newUser();
    const bad = await book(u, f, { pickupPoint: 'Tripoli' }).expect(422);
    expect(bad.body.code).toBe('pickup_point_required');
    await book(u, f).expect(422);
    const ok = await book(u, f, { pickupPoint: 'Hamra, Beirut', contactName: 'Maya Haddad', contactPhone: '+96170123456', emergencyContactName: 'Rami Haddad', emergencyContactPhone: '+96171234567' }).expect(201);
    expect(ok.body.booking).toMatchObject({ status: 'CONFIRMED', pickupPoint: 'Hamra, Beirut', emergencyContact: { name: 'Rami Haddad', phone: '+96171234567' } });
    const list = await h.http().get(`/api/v1/companies/${f.companyId}/bookings`).set('Cookie', f.owner.cookie).expect(200);
    expect(list.body.bookings[0]).toMatchObject({ pickupPoint: 'Hamra, Beirut', emergencyContactName: 'Rami Haddad', emergencyContactPhone: '+96171234567' });
    const pub = await h.http().get(`/api/v1/public/listings/${f.listingId}`).expect(200);
    expect(pub.body.listing.pickupPoints).toEqual(['Hamra, Beirut', 'Jounieh highway']);
  });
});

describe('day-before reminder', () => {
  it('reminds each confirmed booking exactly once, only inside the window, never for cancelled ones', async () => {
    const f = await trip({ price: 0, startsInDays: 1 }); // starts in ~24 h
    const [a, c] = await Promise.all([h.newUser(), h.newUser()]);
    const ba = (await book(a, f, { pickupPoint: undefined }).expect(201)).body.booking;
    const bc = (await book(c, f).expect(201)).body.booking;
    await h.http().post(`/api/v1/bookings/${bc.id}/cancel`).set('Cookie', c.cookie).send({}).expect(200);
    const far = await trip({ price: 0, startsInDays: 10 });
    const bf = (await book(a, far).expect(201)).body.booking;

    const first = await sendTripReminders(h.db);
    expect(first).toBeGreaterThanOrEqual(1);
    const again = await sendTripReminders(h.db);
    expect(await h.db.notification.count({ where: { userId: a.id, kind: 'booking.reminder' } })).toBe(1);
    expect(await h.db.notification.count({ where: { userId: c.id, kind: 'booking.reminder' } })).toBe(0);
    expect((await h.db.booking.findUniqueOrThrow({ where: { id: ba.id } })).reminderSentAt).not.toBeNull();
    expect((await h.db.booking.findUniqueOrThrow({ where: { id: bf.id } })).reminderSentAt).toBeNull();
    void again;
  });
});
