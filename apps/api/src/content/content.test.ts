import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from '../testing/harness';

let h: Harness;
let support: TestUser;
let finance: TestUser;
beforeAll(async () => {
  h = await createHarness();
  support = await h.staff('SUPPORT');
  finance = await h.staff('FINANCE');
});
afterAll(async () => h.close());
const A = '/api/v1';

async function listing(publish: boolean) {
  const { owner, companyId } = await h.approvedCompany();
  const l = await h.http().post(`${A}/companies/${companyId}/listings`).set('Cookie', owner.cookie).send({
    category: 'museums', bookingMode: 'DISCOVERY_ONLY', city: 'Beirut', meetingPoint: 'x',
    translations: { en: { title: `Feat ${Math.random().toString(36).slice(2, 8)}`, description: 'A calm and carefully guided walk with plenty of time for photos and tea.' } },
  }).expect(201);
  if (publish) await h.http().post(`${A}/companies/${companyId}/listings/${l.body.listing.id}/publish`).set('Cookie', owner.cookie).expect(200);
  return { owner, companyId, id: l.body.listing.id as string };
}

describe('featured experiences', () => {
  it('staff feature only public listings; the public list can ask for them', async () => {
    const pub = await listing(true);
    const draft = await listing(false);
    const feat = (u: TestUser, id: string, featured: boolean) => h.http().post(`${A}/admin/listings/${id}/feature`).set('Cookie', u.cookie).send({ featured });
    await feat(support, draft.id, true).expect(409);
    await feat(support, pub.id, true).expect(200);
    const list = (await h.http().get(`${A}/public/listings`).query({ featured: 'true', limit: 50 }).expect(200)).body.listings as Array<{ id: string; featured: boolean }>;
    expect(list.find((l) => l.id === pub.id)?.featured).toBe(true);
    expect(list.every((l) => l.featured)).toBe(true);
    await feat(support, pub.id, false).expect(200);
    expect((await h.http().get(`${A}/public/listings`).query({ featured: 'true', limit: 50 })).body.listings.map((l: { id: string }) => l.id)).not.toContain(pub.id);
    await h.http().get(`${A}/public/listings`).query({ featured: 'maybe' }).expect(400);

    await feat(finance, pub.id, true).expect(403); // wrong role
    await feat(pub.owner, pub.id, true).expect(404); // not staff
    await feat(support, '00000000-0000-4000-8000-000000000000', true).expect(404);
    expect(await h.db.auditEvent.count({ where: { action: 'listing.featured', entityId: pub.id } })).toBeGreaterThan(0);
  });
});

describe('indicative exchange rate', () => {
  it('finance sets a rate with a source; the public sees the latest, flagged indicative; history is append-only', async () => {
    const set = (u: TestUser, body: object) => h.http().post(`${A}/admin/fx`).set('Cookie', u.cookie).send(body);
    await set(finance, { lbpPerUsd: 90000, source: 'Central bank bulletin, first check' }).expect(201);
    await new Promise((r) => setTimeout(r, 20));
    await set(finance, { lbpPerUsd: 89500, source: 'Central bank bulletin, second check' }).expect(201);
    const pub = (await h.http().get(`${A}/public/fx`).expect(200)).body;
    expect(pub).toMatchObject({ indicative: true, rate: { lbpPerUsd: 89500 } });
    const hist = (await h.http().get(`${A}/admin/fx`).set('Cookie', finance.cookie).expect(200)).body.rates;
    expect(hist.length).toBeGreaterThanOrEqual(2);

    await set(finance, { lbpPerUsd: 5, source: 'too small' }).expect(400);
    await set(finance, { lbpPerUsd: 90000.5, source: 'not an integer' }).expect(400);
    await set(finance, { lbpPerUsd: 90000 }).expect(400);
    await set(support, { lbpPerUsd: 90000, source: 'support cannot set rates' }).expect(403);
    await expect(h.db.exchangeRate.deleteMany({})).rejects.toThrow();
    await expect(h.db.exchangeRate.updateMany({ data: { lbpPerUsd: 1000 } })).rejects.toThrow();
  });
});
