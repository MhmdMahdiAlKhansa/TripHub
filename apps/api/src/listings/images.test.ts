import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createHarness, type Harness } from '../testing/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());

const A = '/api/v1';
const PNG = (n = 0) => sharp({ create: { width: 8 + n, height: 8, channels: 3, background: { r: n * 20, g: 120, b: 90 } } }).png().toBuffer();
const LONG = 'A calm and carefully guided walk with plenty of time for photos and tea.';

async function listing(publish = false) {
  const { owner, companyId } = await h.approvedCompany();
  const l = await h.http().post(`${A}/companies/${companyId}/listings`).set('Cookie', owner.cookie).send({
    category: 'hiking', bookingMode: 'DISCOVERY_ONLY', city: 'Bsharri', meetingPoint: 'Square',
    translations: { en: { title: 'Cedar Walk', description: LONG } },
  }).expect(201);
  const id = l.body.listing.id as string;
  if (publish) await h.http().post(`${A}/companies/${companyId}/listings/${id}/publish`).set('Cookie', owner.cookie).expect(200);
  return { owner, companyId, id };
}
const put = (c: { owner: { cookie: string }; companyId: string; id: string }, body: Buffer, type = 'image/png', alt = 'A trail') =>
  h.http().put(`${A}/companies/${c.companyId}/listings/${c.id}/images`).query({ alt }).set('Cookie', c.owner.cookie).set('Content-Type', type).send(body);

describe('listing images', () => {
  it('accepts real images, serves them publicly only once published, with safe headers', async () => {
    const c = await listing();
    const up = (await put(c, await PNG(1)).expect(200)).body.image;
    expect(up).toMatchObject({ alt: 'A trail', position: 0, contentType: 'image/webp' });
    await h.http().get(up.url).expect(404); // draft: not public
    await h.http().post(`${A}/companies/${c.companyId}/listings/${c.id}/publish`).set('Cookie', c.owner.cookie).expect(200);
    const res = await h.http().get(up.url).expect(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.headers['cache-control']).toContain('immutable');
    const pub = (await h.http().get(`${A}/public/listings/${c.id}`).expect(200)).body.listing;
    expect(pub.images).toEqual([{ id: up.id, url: up.url, alt: 'A trail' }]);
  });

  it('rejects non-images, documents, disguised files and oversize; limits the gallery', async () => {
    const c = await listing();
    await put(c, Buffer.from('%PDF-1.7\nxx'), 'application/pdf').expect(415);
    await put(c, Buffer.from('MZ not an image'), 'image/png').expect(415);
    await put(c, Buffer.alloc(0)).expect(415);
    await h.http().put(`${A}/companies/${c.companyId}/listings/${c.id}/images`).set('Cookie', c.owner.cookie).set('Content-Type', 'application/json').send({}).expect(415);
    for (let i = 0; i < 8; i++) await put(c, await PNG(i)).expect(200);
    const nine = await put(c, await PNG(9)).expect(409);
    expect(nine.body.code).toBe('too_many_images');
  });

  it('is limited to the owning business and its editors; delete removes it from the public', async () => {
    const c = await listing(true);
    const other = await h.approvedCompany();
    await h.http().put(`${A}/companies/${other.companyId}/listings/${c.id}/images`).set('Cookie', other.owner.cookie).set('Content-Type', 'image/png').send(await PNG()).expect(404);
    const up = (await put(c, await PNG(3)).expect(200)).body.image;
    await h.http().delete(`${A}/companies/${other.companyId}/listings/${c.id}/images/${up.id}`).set('Cookie', other.owner.cookie).expect(404);
    await h.http().get(up.url).expect(200);
    await h.http().delete(`${A}/companies/${c.companyId}/listings/${c.id}/images/${up.id}`).set('Cookie', c.owner.cookie).expect(204);
    await h.http().get(up.url).expect(404);
    expect((await h.http().get(`${A}/companies/${c.companyId}/listings/${c.id}/images`).set('Cookie', c.owner.cookie)).body.images).toHaveLength(0);
    await h.http().put(`${A}/companies/${c.companyId}/listings/${c.id}/images`).set('Content-Type', 'image/png').send(await PNG()).expect(401);
  });
});

describe('image processing', () => {
  it('re-encodes to WebP, strips metadata, limits size, resizes on demand and rejects fakes and bombs', async () => {
    const c = await listing(true);
    // A large JPEG carrying EXIF (including a GPS-like comment) comes back small, WebP and metadata-free.
    const big = await sharp({ create: { width: 3200, height: 2400, channels: 3, background: '#0c8458' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-copyright-marker', ImageDescription: 'gps 33.8,35.5' } })
      .toBuffer();
    expect((await sharp(big).metadata()).exif).toBeTruthy();
    const up = (await put(c, big, 'image/jpeg').expect(200)).body.image;
    const served = (await h.http().get(up.url).buffer(true).expect(200)).body as Buffer;
    const meta = await sharp(served).metadata();
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(2000);
    expect(meta.exif).toBeUndefined();
    expect(served.includes(Buffer.from('secret-copyright-marker'))).toBe(false);

    const small = (await h.http().get(`${up.url}?w=320`).buffer(true).expect(200)).body as Buffer;
    expect((await sharp(small).metadata()).width).toBe(320);
    await h.http().get(`${up.url}?w=999`).expect(400);

    // Starts like a PNG but is not decodable.
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
    const r = await put(c, fake).expect(415);
    expect(r.body.code).toBe('invalid_image');
    // A tiny file that claims a huge canvas (decompression bomb) is refused instead of exhausting memory.
    const bomb = await sharp({ create: { width: 9000, height: 9000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    await put(c, bomb).expect(415);
  });
});
