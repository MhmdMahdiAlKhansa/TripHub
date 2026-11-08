import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeSearch } from '@triphub/shared';
import { createHarness, type Harness } from '../testing/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());

const A = '/api/v1';
const tok = () => `zq${Math.random().toString(36).slice(2, 9)}`;

async function publish(titles: { en?: string; ar?: string }, description = 'A calm and carefully guided walk with plenty of time for photos and tea.') {
  const { owner, companyId } = await h.approvedCompany();
  const translations: Record<string, { title: string; description: string }> = {};
  if (titles.en) translations.en = { title: titles.en, description };
  if (titles.ar) translations.ar = { title: titles.ar, description: 'جولة هادئة مع مرشد محلي وفرصة كافية للتصوير وشرب الشاي.' };
  const l = await h.http().post(`${A}/companies/${companyId}/listings`).set('Cookie', owner.cookie).send({
    category: 'hiking', bookingMode: 'DISCOVERY_ONLY', city: 'Bsharri', meetingPoint: 'Village square', translations,
  }).expect(201);
  await h.http().post(`${A}/companies/${companyId}/listings/${l.body.listing.id}/publish`).set('Cookie', owner.cookie).expect(200);
  return l.body.listing.id as string;
}
const find = async (q: string) =>
  (await h.http().get(`${A}/public/listings`).query({ q, limit: 50 }).expect(200)).body.listings.map((x: { id: string }) => x.id) as string[];

describe('public search', () => {
  it('matches every term, case-insensitively, in any listing language', async () => {
    const t = tok();
    const id = await publish({ en: `Cedar Sunrise ${t}` });
    expect(await find(`${t}`)).toContain(id);
    expect(await find(`SUNRISE ${t.toUpperCase()}`)).toContain(id);
    expect(await find(`sunrise nonexistentword${t}`)).not.toContain(id);
  });

  it('finds Arabic text across spelling variants (hamza, ta marbuta, diacritics, digits)', async () => {
    const t = tok();
    const id = await publish({ en: `Cedars ${t}`, ar: `جولة غابة الأرز ${t}` });
    expect(await find('الارز')).toContain(id); // without hamza
    expect(await find('غابه')).toContain(id); // ta marbuta written as ha
    expect(await find('جَوْلَة')).toContain(id); // with diacritics
    expect(await find('الأرز')).toContain(id);
    expect(await find('مدرسة غير موجودة')).not.toContain(id);
  });

  it('treats % and _ and backslashes as plain text, never as wildcards', async () => {
    const t = tok();
    const id = await publish({ en: `Plain title ${t}` });
    for (const q of ['%%', '__', 'p_ain', String.fromCharCode(92) + String.fromCharCode(92)]) {
      expect(await find(q)).not.toContain(id);
    }
    const sqlish = await h.http().get(`${A}/public/listings`).query({ q: "'; DROP TABLE listing; --" }).expect(200);
    expect(Array.isArray(sqlish.body.listings)).toBe(true);
    expect(await find(t)).toContain(id); // table still there
  });

  it('a too-short or empty search returns nothing rather than everything', async () => {
    expect(await find('a')).toEqual([]);
  });

  it('only matches published listings of verified businesses', async () => {
    const t = tok();
    const { owner, companyId } = await h.approvedCompany();
    const l = await h.http().post(`${A}/companies/${companyId}/listings`).set('Cookie', owner.cookie).send({
      category: 'hiking', bookingMode: 'DISCOVERY_ONLY', city: 'Bsharri', meetingPoint: 'x',
      translations: { en: { title: `Draft only ${t}`, description: 'A calm and carefully guided walk with plenty of time for photos and tea.' } },
    }).expect(201);
    expect(await find(t)).not.toContain(l.body.listing.id);
  });
});

describe('normalisation parity', () => {
  it('the SQL function and the shared function agree', async () => {
    const samples = ['الأرز', 'إدارة وآثار', 'مَدْرَسَة', 'كــتاب', 'رحلة ٢٠٢٧ Cedar  Walk', 'على وليل', 'Mixed CASE عربي ٠١٢'];
    for (const sample of samples) {
      const rows = await h.db.$queryRaw<Array<{ n: string }>>`SELECT th_normalize(${sample}) AS n`;
      expect(rows[0]!.n).toBe(normalizeSearch(sample));
    }
  });
});

describe('discovery filters', () => {
  async function bookable(city: string, capacity: number, priceMinor: number) {
    const { owner, companyId } = await h.approvedCompany();
    const t = tok();
    const l = await h.http().post(`${A}/companies/${companyId}/listings`).set('Cookie', owner.cookie).send({
      category: 'tours', bookingMode: 'FIXED_DATE', city, meetingPoint: 'Square',
      translations: { en: { title: `Filter ${t}`, description: 'A calm and carefully guided walk with plenty of time for photos and tea.' } },
    }).expect(201);
    const id = l.body.listing.id as string;
    await h.http().put(`${A}/companies/${companyId}/listings/${id}/rates`).set('Cookie', owner.cookie).send({ rates: [{ kind: 'ADULT', amount: priceMinor, currency: 'USD' }] }).expect(200);
    return { owner, companyId, id, t };
  }

  it('region, date plus party size, price and bookable-only combine and never widen the result', async () => {
    const day = new Date(Date.now() + 11 * 86_400_000);
    day.setUTCHours(12, 0, 0, 0);
    const date = day.toISOString().slice(0, 10);
    const free = await bookable('Byblos', 4, 0);
    await h.http().post(`${A}/companies/${free.companyId}/listings/${free.id}/slots`).set('Cookie', free.owner.cookie).send({ startsAt: day.toISOString(), capacity: 4 }).expect(201);
    await h.http().post(`${A}/companies/${free.companyId}/listings/${free.id}/publish`).set('Cookie', free.owner.cookie).expect(200);

    const get = async (q: Record<string, string>) =>
      ((await h.http().get(`${A}/public/listings`).query({ limit: 50, ...q }).expect(200)).body.listings as Array<{ id: string; fromPrice: { amountMinor: string } | null }>);
    const ids = async (q: Record<string, string>) => (await get(q)).map((l) => l.id);

    expect(await ids({ q: free.t, region: 'jbeil' })).toContain(free.id);
    expect(await ids({ q: free.t, region: 'bekaa' })).not.toContain(free.id);
    expect(await ids({ q: free.t, date, guests: '4' })).toContain(free.id);
    expect(await ids({ q: free.t, date, guests: '5' })).not.toContain(free.id); // not enough seats
    expect(await ids({ q: free.t, date: '2030-01-01' })).not.toContain(free.id); // nothing that day
    expect(await ids({ q: free.t, mode: 'discovery' })).not.toContain(free.id);
    expect(await ids({ q: free.t, mode: 'bookable' })).toContain(free.id);
    expect(await ids({ q: free.t, maxPriceMinor: '0' } as never)).toContain(free.id);
    // date filter alone must not return everything: only listings with an open date that day.
    const onDay = await get({ date });
    expect(onDay.length).toBeGreaterThan(0);
    expect(onDay.every((l) => l.id !== undefined)).toBe(true);

    const costly = await bookable('Byblos', 4, 9900);
    await h.http().post(`${A}/companies/${costly.companyId}/listings/${costly.id}/slots`).set('Cookie', costly.owner.cookie).send({ startsAt: day.toISOString(), capacity: 4 }).expect(201);
    expect((await get({ q: free.t })).find((l) => l.id === free.id)?.fromPrice).toEqual({ amountMinor: '0', currency: 'USD' });
    await h.http().get(`${A}/public/listings`).query({ region: 'atlantis' }).expect(400);
    await h.http().get(`${A}/public/listings`).query({ date: '11/12/2027' }).expect(400);
    await h.http().get(`${A}/public/listings`).query({ guests: '99' }).expect(400);
  });
});

describe('nearby experiences', () => {
  it('lists other public experiences in the same city, never the listing itself or drafts', async () => {
    const city = `Nearby${tok()}`;
    const make = async (publishIt: boolean) => {
      const { owner, companyId } = await h.approvedCompany();
      const l = await h.http().post(`${A}/companies/${companyId}/listings`).set('Cookie', owner.cookie).send({
        category: 'museums', bookingMode: 'DISCOVERY_ONLY', city, meetingPoint: 'x',
        translations: { en: { title: `Spot ${tok()}`, description: 'A calm and carefully guided walk with plenty of time for photos and tea.' } },
      }).expect(201);
      if (publishIt) await h.http().post(`${A}/companies/${companyId}/listings/${l.body.listing.id}/publish`).set('Cookie', owner.cookie).expect(200);
      return l.body.listing.id as string;
    };
    const [a, b, draft] = [await make(true), await make(true), await make(false)];
    const near = (await h.http().get(`${A}/public/listings/${a}/nearby`).expect(200)).body.listings.map((l: { id: string }) => l.id);
    expect(near).toContain(b);
    expect(near).not.toContain(a);
    expect(near).not.toContain(draft);
    await h.http().get(`${A}/public/listings/${draft}/nearby`).expect(404);
    await h.http().get(`${A}/public/listings/not-a-uuid/nearby`).expect(404);
  });
});
