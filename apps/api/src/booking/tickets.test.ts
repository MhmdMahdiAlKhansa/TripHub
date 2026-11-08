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

async function confirmed(opts: { contactName?: string } = {}) {
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
    .send({ startsAt: inDays(7), capacity: 10 }).expect(201);
  const customer = await h.newUser();
  const booking = (await h.http().post(`${A}/bookings`).set('Cookie', customer.cookie).set('Idempotency-Key', key())
    .send({ listingId, slotId: s.body.slot.id, lines: [{ kind: 'ADULT', qty: 2 }], ...opts }).expect(201)).body.booking;
  return { owner, companyId, customer, booking, slotId: s.body.slot.id as string };
}
const checkIn = (f: { owner: TestUser; companyId: string }, code: string, u: TestUser = f.owner) =>
  h.http().post(`${A}/companies/${f.companyId}/check-in`).set('Cookie', u.cookie).send({ code });
const startSoon = (slotId: string) => h.db.slot.update({ where: { id: slotId }, data: { startsAt: new Date(Date.now() + 3_600_000) } });

describe('tickets and check-in', () => {
  it('only a confirmed booking has a ticket, and only its owner can read it', async () => {
    const f = await confirmed();
    const t = (await h.http().get(`${A}/bookings/${f.booking.id}/ticket`).set('Cookie', f.customer.cookie).expect(200)).body.ticket;
    expect(t.code.startsWith(`${f.booking.reference}.`)).toBe(true);
    const stranger = await h.newUser();
    await h.http().get(`${A}/bookings/${f.booking.id}/ticket`).set('Cookie', stranger.cookie).expect(404);
    await h.http().post(`${A}/bookings/${f.booking.id}/cancel`).set('Cookie', f.customer.cookie).send({}).expect(200);
    await h.http().get(`${A}/bookings/${f.booking.id}/ticket`).set('Cookie', f.customer.cookie).expect(409);
  });

  it('checks a guest in once, inside the window, with a genuine code of the right business', async () => {
    const f = await confirmed();
    const code = (await h.http().get(`${A}/bookings/${f.booking.id}/ticket`).set('Cookie', f.customer.cookie)).body.ticket.code as string;
    await checkIn(f, code).expect(409); // a week early
    await startSoon(f.slotId);

    await checkIn(f, `${f.booking.reference}.${'0'.repeat(20)}`).expect(404); // forged
    await checkIn(f, f.booking.reference).expect(404);
    const other = await h.approvedCompany();
    await checkIn(other, code).expect(404); // another business cannot see it

    const ok = await checkIn(f, code).expect(200);
    expect(ok.body.checkedIn).toMatchObject({ reference: f.booking.reference, quantity: 2 });
    const again = await checkIn(f, code).expect(409);
    expect(again.body.code).toBe('already_checked_in');

    const raced = await confirmed();
    const rc = (await h.http().get(`${A}/bookings/${raced.booking.id}/ticket`).set('Cookie', raced.customer.cookie)).body.ticket.code as string;
    await startSoon(raced.slotId);
    const res = await Promise.all([checkIn(raced, rc), checkIn(raced, rc), checkIn(raced, rc)]);
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('cancelled bookings cannot be checked in; customers cannot check themselves in', async () => {
    const f = await confirmed();
    const code = (await h.http().get(`${A}/bookings/${f.booking.id}/ticket`).set('Cookie', f.customer.cookie)).body.ticket.code as string;
    await startSoon(f.slotId);
    await checkIn(f, code, f.customer).expect(404);
    await h.http().post(`${A}/companies/${f.companyId}/bookings/${f.booking.id}/cancel`).set('Cookie', f.owner.cookie).send({}).expect(200);
    await checkIn(f, code).expect(409);
  });
});

describe('calendar and export', () => {
  it('serves a valid iCalendar file to the booking owner only', async () => {
    const f = await confirmed();
    const res = await h.http().get(`${A}/bookings/${f.booking.id}/calendar.ics`).set('Cookie', f.customer.cookie).expect(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.text).toContain('BEGIN:VEVENT');
    expect(res.text).toContain(`UID:${f.booking.id}@triphub`);
    expect(res.text).toContain('SUMMARY:Cedar Forest Walk');
    const stranger = await h.newUser();
    await h.http().get(`${A}/bookings/${f.booking.id}/calendar.ics`).set('Cookie', stranger.cookie).expect(404);
  });

  it('exports only this business\'s bookings and neutralises spreadsheet formulas', async () => {
    const f = await confirmed({ contactName: '=HYPERLINK("http://evil.test")' });
    const mine = await confirmed();
    const csv = (await h.http().get(`${A}/companies/${f.companyId}/bookings-export.csv`).set('Cookie', f.owner.cookie).expect(200)).text;
    expect(csv).toContain(f.booking.reference);
    expect(csv).not.toContain(mine.booking.reference);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.test"")"`);
    expect(csv).not.toMatch(/(^|,)"=/m);
    await h.http().get(`${A}/companies/${f.companyId}/bookings-export.csv`).set('Cookie', f.customer.cookie).expect(404);
  });
});
