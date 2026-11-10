import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, PASSWORD, type Harness } from '../testing/harness';

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });
const A = '/api/v1/auth';
const LONG = 'A calm and carefully guided walk with plenty of time for photos and tea.';
let k = 0;

async function bookedFree() {
  const { owner, companyId } = await h.approvedCompany();
  const base = `/api/v1/companies/${companyId}/listings`;
  const l = await h.http().post(base).set('Cookie', owner.cookie).send({ category: 'hiking', bookingMode: 'FIXED_DATE', city: 'Bsharri', meetingPoint: 'Square', translations: { en: { title: 'Cedar Walk', description: LONG } } }).expect(201);
  const id = l.body.listing.id as string;
  await h.http().put(`${base}/${id}/rates`).set('Cookie', owner.cookie).send({ rates: [{ kind: 'ADULT', amount: 0, currency: 'USD' }] }).expect(200);
  await h.http().post(`${base}/${id}/publish`).set('Cookie', owner.cookie).expect(200);
  const s = await h.http().post(`${base}/${id}/slots`).set('Cookie', owner.cookie).send({ startsAt: new Date(Date.now() + 7 * 86_400_000 + k * 1000).toISOString(), capacity: 5 }).expect(201);
  return { listingId: id, slotId: s.body.slot.id as string };
}

describe('privacy: export and delete my account', () => {
  it('exports my own data, never secrets, and requires a session', async () => {
    await h.http().get(`${A}/me/export`).expect(401);
    const u = await h.newUser();
    const r = await h.http().get(`${A}/me/export`).set('Cookie', u.cookie).expect(200);
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.body.account).toMatchObject({ email: u.email, hasPassword: true });
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|tokenHash|mfaSecret/);
  });

  it('refuses without the exact confirmation or the right password', async () => {
    const u = await h.newUser();
    await h.http().post(`${A}/me/delete`).set('Cookie', u.cookie).send({ password: PASSWORD }).expect(400);
    await h.http().post(`${A}/me/delete`).set('Cookie', u.cookie).send({ confirm: 'DELETE', password: 'wrong password!!' }).expect(401);
    expect((await h.db.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe('ACTIVE');
  });

  it('anonymises the account, ends every session, and the old login stops working', async () => {
    const u = await h.newUser();
    const f = await bookedFree();
    const b = await h.http().post('/api/v1/bookings').set('Cookie', u.cookie).set('Idempotency-Key', `idem-${Date.now()}-${k++}`)
      .send({ listingId: f.listingId, slotId: f.slotId, lines: [{ kind: 'ADULT', qty: 1 }], contactName: 'Maya', contactPhone: '+96170000000' });
    expect([200, 201]).toContain(b.status);
    // A confirmed future booking blocks deletion.
    const blocked = await h.http().post(`${A}/me/delete`).set('Cookie', u.cookie).send({ confirm: 'DELETE', password: PASSWORD });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code ?? blocked.body.message?.code).toBe('open_bookings');
    await h.db.booking.updateMany({ where: { customerId: u.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });

    await h.http().post(`${A}/me/delete`).set('Cookie', u.cookie).send({ confirm: 'DELETE', password: PASSWORD }).expect(204);
    const row = await h.db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row).toMatchObject({ status: 'DELETED', passwordHash: null, displayName: null, googleSub: null });
    expect(row.email).toBe(`deleted-${u.id}@deleted.invalid`);
    const kept = await h.db.booking.findFirstOrThrow({ where: { customerId: u.id } });
    expect(kept).toMatchObject({ contactName: null, contactPhone: null }); // the booking itself is kept
    await h.http().get(`${A}/me`).set('Cookie', u.cookie).expect(401);
    await h.http().post(`${A}/login`).send({ email: u.email, password: PASSWORD }).expect(401);
    expect(await h.db.auditEvent.count({ where: { action: 'account.deleted', actorId: u.id } })).toBe(1);
  });

  it('will not delete the only owner of a business', async () => {
    const { owner } = await h.approvedCompany();
    const r = await h.http().post(`${A}/me/delete`).set('Cookie', owner.cookie).send({ confirm: 'DELETE', password: PASSWORD });
    expect(r.status).toBe(409);
    expect((await h.db.user.findUniqueOrThrow({ where: { id: owner.id } })).status).toBe('ACTIVE');
  });
});

describe('email health view for staff', () => {
  it('is visible to support staff, hides full addresses, and is closed to customers', async () => {
    const support = await h.staff('SUPPORT');
    const r = await h.http().get('/api/v1/admin/email').set('Cookie', support.cookie).expect(200);
    expect(r.body.counts).toBeTypeOf('object');
    for (const f of r.body.failed as Array<{ toEmail: string }>) expect(f.toEmail).toMatch(/^.{2}\*\*\*@/);
    const u = await h.newUser();
    await h.http().get('/api/v1/admin/email').set('Cookie', u.cookie).expect(404);
  });
});
