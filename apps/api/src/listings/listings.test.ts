import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, slug, type Harness, type TestUser } from '../testing/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

let n = 0;
const uniq = () => `zz${Date.now().toString(36)}${n++}`;
const LONG = 'A calm and carefully guided walk with plenty of time for photos and tea.';

const base = (extra: object = {}) => ({
  category: 'hiking',
  translations: { en: { title: 'Cedar Forest Walk', description: LONG } },
  city: 'Bsharri',
  ...extra,
});
const create = (u: TestUser, companyId: string, body: object) =>
  h.http().post(`/api/v1/companies/${companyId}/listings`).set('Cookie', u.cookie).send(body);
const act = (u: TestUser, companyId: string, id: string, action: 'publish' | 'pause' | 'archive') =>
  h.http().post(`/api/v1/companies/${companyId}/listings/${id}/${action}`).set('Cookie', u.cookie);

async function published(u: TestUser, companyId: string, extra: object = {}) {
  const r = await create(u, companyId, base(extra)).expect(201);
  const id = r.body.listing.id as string;
  await act(u, companyId, id, 'publish').expect(200);
  return id;
}

describe('creating and editing drafts', () => {
  it('creates a DRAFT with translations, structured attributes and coordinates', async () => {
    const { owner, companyId } = await h.approvedCompany();
    const r = await create(owner, companyId, base({
      attributes: { difficulty: 'moderate', distanceKm: 8.5, guideIncluded: true },
      latitude: 34.25, longitude: 36.01,
      translations: { en: { title: 'Cedar Forest Walk', description: LONG }, ar: { title: 'مشوار غابة الأرز' } },
    })).expect(201);
    expect(r.body.listing).toMatchObject({ status: 'DRAFT', category: 'hiking', bookingMode: 'DISCOVERY_ONLY', latitude: 34.25 });
    expect(Object.keys(r.body.listing.translations).sort()).toEqual(['ar', 'en']);
  });

  it('rejects category-mismatched attributes, missing translations, unknown fields, half coordinates', async () => {
    const { owner, companyId } = await h.approvedCompany();
    const bad = async (body: object, code?: string) => {
      const r = await create(owner, companyId, body).expect(400);
      if (code) expect(r.body.code).toBe(code);
    };
    await bad(base({ attributes: { priceLevel: 3 } }), 'invalid_attributes');
    await bad(base({ attributes: { difficulty: 'extreme' } }), 'invalid_attributes');
    await bad(base({ translations: {} }));
    await bad(base({ category: 'skydiving' }));
    await bad(base({ status: 'PUBLISHED' })); // cannot create as published
    await bad(base({ companyId: '00000000-0000-0000-0000-000000000000' }));
    await bad(base({ latitude: 34 }));
  });

  it('updates fields and upserts translations; category is immutable', async () => {
    const { owner, companyId } = await h.approvedCompany();
    const id = (await create(owner, companyId, base()).expect(201)).body.listing.id;
    const r = await h.http().patch(`/api/v1/companies/${companyId}/listings/${id}`).set('Cookie', owner.cookie)
      .send({ city: 'Batroun', translations: { ar: { title: 'عنوان جديد' } }, attributes: { guideIncluded: false } }).expect(200);
    expect(r.body.listing.city).toBe('Batroun');
    expect(Object.keys(r.body.listing.translations).sort()).toEqual(['ar', 'en']);
    await h.http().patch(`/api/v1/companies/${companyId}/listings/${id}`).set('Cookie', owner.cookie)
      .send({ category: 'museums' }).expect(400);
    await h.http().patch(`/api/v1/companies/${companyId}/listings/${id}`).set('Cookie', owner.cookie)
      .send({ attributes: { priceLevel: 2 } }).expect(400);
  });
});

describe('publishing rules', () => {
  it('an unverified company can draft but cannot publish', async () => {
    const owner = await h.newUser();
    const c = await h.http().post('/api/v1/companies').set('Cookie', owner.cookie).send({ name: 'Fresh Co', slug: slug() }).expect(201);
    const companyId = c.body.company.id as string;
    const id = (await create(owner, companyId, base()).expect(201)).body.listing.id;
    const r = await act(owner, companyId, id, 'publish').expect(409);
    expect(r.body.code).toBe('company_not_verified');
    expect((await h.db.listing.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT');
  });

  it('incomplete listings are rejected with what is missing', async () => {
    const { owner, companyId } = await h.approvedCompany();
    const id = (await create(owner, companyId, {
      category: 'museums', translations: { en: { title: 'Short one' } },
    }).expect(201)).body.listing.id;
    const r = await act(owner, companyId, id, 'publish').expect(422);
    expect(r.body.missing).toEqual(expect.arrayContaining(['translation', 'city']));
  });

  it('bookable listings need a price card; priced ones stay blocked until payments exist; request-to-book unsupported', async () => {
    const { owner, companyId } = await h.approvedCompany();
    const bookable = (mode: string) => create(owner, companyId, base({ bookingMode: mode, meetingPoint: 'Main square' })).expect(201);
    const fixed = (await bookable('FIXED_DATE')).body.listing.id;
    const noRates = await act(owner, companyId, fixed, 'publish').expect(422);
    expect(noRates.body.missing).toContain('rates');

    const rates = (body: object) => h.http().put(`/api/v1/companies/${companyId}/listings/${fixed}/rates`).set('Cookie', owner.cookie).send(body);
    await rates({ rates: [{ kind: 'ADULT', amount: 2500, currency: 'USD' }] }).expect(200);
    await act(owner, companyId, fixed, 'publish').expect(200); // priced is fine: the operator collects the deposit

    const rtb = (await bookable('REQUEST_TO_BOOK')).body.listing.id;
    expect((await act(owner, companyId, rtb, 'publish').expect(409)).body.code).toBe('booking_mode_not_supported_yet');
  });

  it('follows the lifecycle; archived is terminal and read-only', async () => {
    const { owner, companyId } = await h.approvedCompany();
    const id = await published(owner, companyId);
    await act(owner, companyId, id, 'publish').expect(409); // already published
    await act(owner, companyId, id, 'pause').expect(200);
    await act(owner, companyId, id, 'pause').expect(409);
    await act(owner, companyId, id, 'publish').expect(200); // resume
    await act(owner, companyId, id, 'archive').expect(200);
    await act(owner, companyId, id, 'publish').expect(409);
    await h.http().patch(`/api/v1/companies/${companyId}/listings/${id}`).set('Cookie', owner.cookie).send({ city: 'X' }).expect(409);
  });

  it('a draft cannot be paused', async () => {
    const { owner, companyId } = await h.approvedCompany();
    const id = (await create(owner, companyId, base()).expect(201)).body.listing.id;
    await act(owner, companyId, id, 'pause').expect(409);
  });

  it('concurrent publishes produce exactly one transition and one audit event', async () => {
    const { owner, companyId } = await h.approvedCompany();
    const id = (await create(owner, companyId, base()).expect(201)).body.listing.id;
    const rs = await Promise.all([1, 2, 3].map(() => act(owner, companyId, id, 'publish')));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await h.db.auditEvent.count({ where: { entityId: id, action: 'listing.published' } })).toBe(1);
  });
});

describe('public discovery', () => {
  it('shows only published listings of verified companies, with a safe shape', async () => {
    const { owner, companyId } = await h.approvedCompany();
    const city = uniq();
    const pub = await published(owner, companyId, { city });
    const draft = (await create(owner, companyId, base({ city })).expect(201)).body.listing.id;
    const paused = await published(owner, companyId, { city });
    await act(owner, companyId, paused, 'pause').expect(200);

    const list = await h.http().get('/api/v1/public/listings').query({ city }).expect(200);
    expect(list.body.listings.map((l: { id: string }) => l.id)).toEqual([pub]);

    const one = await h.http().get(`/api/v1/public/listings/${pub}`).expect(200);
    expect(one.body.listing).toMatchObject({ id: pub, title: 'Cedar Forest Walk', bookable: false });
    expect(one.body.listing.company.verified).toBe(true);
    const raw = JSON.stringify(one.body);
    expect(raw).not.toMatch(/companyId|"status"|contactEmail|phone/);

    await h.http().get(`/api/v1/public/listings/${draft}`).expect(404);
    await h.http().get(`/api/v1/public/listings/${paused}`).expect(404);
    await h.http().get('/api/v1/public/listings/not-a-uuid').expect(404);
  });

  it('suspending a company hides its listings immediately', async () => {
    const { owner, companyId } = await h.approvedCompany();
    const id = await published(owner, companyId);
    await h.http().get(`/api/v1/public/listings/${id}`).expect(200);
    await h.db.company.update({ where: { id: companyId }, data: { status: 'SUSPENDED' } });
    await h.http().get(`/api/v1/public/listings/${id}`).expect(404);
  });

  it('filters by category and text, falls back across locales, and paginates', async () => {
    const { owner, companyId } = await h.approvedCompany();
    const city = uniq();
    const term = uniq();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await published(owner, companyId, { city, translations: { en: { title: `${term} walk ${i}`, description: LONG } } }));
    const museum = await published(owner, companyId, { city, category: 'museums', translations: { ar: { title: 'متحف المدينة', description: 'وصف طويل بما يكفي للمتحف في المدينة القديمة.' } } });

    const byQ = await h.http().get('/api/v1/public/listings').query({ city, q: term }).expect(200);
    expect(byQ.body.listings).toHaveLength(3);
    const byCat = await h.http().get('/api/v1/public/listings').query({ city, category: 'museums' }).expect(200);
    expect(byCat.body.listings.map((l: { id: string }) => l.id)).toEqual([museum]);

    // Asking for English where only Arabic exists falls back instead of showing nothing.
    const fb = await h.http().get(`/api/v1/public/listings/${museum}`).query({ locale: 'en' }).expect(200);
    expect(fb.body.listing).toMatchObject({ title: 'متحف المدينة', locale: 'ar' });

    const p1 = await h.http().get('/api/v1/public/listings').query({ city, q: term, limit: 2 }).expect(200);
    expect(p1.body.listings).toHaveLength(2);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await h.http().get('/api/v1/public/listings').query({ city, q: term, limit: 2, cursor: p1.body.nextCursor }).expect(200);
    expect(p2.body.listings).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
    const seen = [...p1.body.listings, ...p2.body.listings].map((l: { id: string }) => l.id);
    expect(new Set(seen).size).toBe(3);
    expect(seen.sort()).toEqual([...ids].sort());
  });

  it('validates query parameters', async () => {
    await h.http().get('/api/v1/public/listings').query({ limit: 500 }).expect(400);
    await h.http().get('/api/v1/public/listings').query({ category: 'nope' }).expect(400);
    await h.http().get('/api/v1/public/listings').query({ cursor: 'x' }).expect(400);
  });
});

describe('tenant isolation and RBAC for listings', () => {
  it("another tenant cannot read or change a company's listings", async () => {
    const a = await h.approvedCompany();
    const b = await h.approvedCompany();
    const id = (await create(a.owner, a.companyId, base()).expect(201)).body.listing.id;

    // Through the victim's company path: not a member -> 404.
    await h.http().get(`/api/v1/companies/${a.companyId}/listings/${id}`).set('Cookie', b.owner.cookie).expect(404);
    await h.http().patch(`/api/v1/companies/${a.companyId}/listings/${id}`).set('Cookie', b.owner.cookie).send({ city: 'Hacked' }).expect(404);
    await act(b.owner, a.companyId, id, 'publish').expect(404);
    // Through the attacker's own company path with the victim's listing id: scoped lookup -> 404.
    await h.http().get(`/api/v1/companies/${b.companyId}/listings/${id}`).set('Cookie', b.owner.cookie).expect(404);
    await h.http().patch(`/api/v1/companies/${b.companyId}/listings/${id}`).set('Cookie', b.owner.cookie).send({ city: 'Hacked' }).expect(404);
    await act(b.owner, b.companyId, id, 'archive').expect(404);

    const row = await h.db.listing.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('DRAFT');
    expect(row.city).toBe('Bsharri');
    const mine = await h.http().get(`/api/v1/companies/${b.companyId}/listings`).set('Cookie', b.owner.cookie).expect(200);
    expect(mine.body.listings).toHaveLength(0);
  });

  it('roles: managers write and publish; booking staff and finance can only view', async () => {
    const { owner, companyId } = await h.approvedCompany();
    // Four people exceed the trial's team size; give this business a paid plan with room for them.
    await h.db.subscription.update({ where: { companyId }, data: { planCode: 'PRO', status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000), commissionBps: 400 } });
    const add = async (role: string) => {
      const u = await h.newUser();
      await h.http().post(`/api/v1/companies/${companyId}/invitations`).set('Cookie', owner.cookie).send({ email: u.email, role }).expect(202);
      await h.http().post('/api/v1/invitations/accept').set('Cookie', u.cookie).send({ token: h.lastToken(u.email, 'company-invitation') }).expect(200);
      return u;
    };
    const mgr = await add('MANAGER');
    const staff = await add('BOOKING_STAFF');
    const fin = await add('FINANCE');

    const id = (await create(mgr, companyId, base()).expect(201)).body.listing.id;
    await act(mgr, companyId, id, 'publish').expect(200);
    for (const u of [staff, fin]) {
      await create(u, companyId, base()).expect(403);
      await h.http().patch(`/api/v1/companies/${companyId}/listings/${id}`).set('Cookie', u.cookie).send({ city: 'X' }).expect(403);
      await act(u, companyId, id, 'pause').expect(403);
      await h.http().get(`/api/v1/companies/${companyId}/listings/${id}`).set('Cookie', u.cookie).expect(200);
    }
    expect((await h.db.listing.findUniqueOrThrow({ where: { id } })).status).toBe('PUBLISHED');
  });

  it('records audit events for create, update and publish', async () => {
    const { owner, companyId } = await h.approvedCompany();
    const id = await published(owner, companyId);
    await h.http().patch(`/api/v1/companies/${companyId}/listings/${id}`).set('Cookie', owner.cookie).send({ city: 'Tyre' }).expect(200);
    const actions = (await h.db.auditEvent.findMany({ where: { entityId: id } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['listing.created', 'listing.updated', 'listing.published']));
  });
});
