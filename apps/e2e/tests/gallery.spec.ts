import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('photo lightbox opens, moves, closes with Escape and returns focus; nearby experiences are listed', async ({ page, request }) => {
  // The real login rate limit (10 per minute) can trip when many browser tests sign in back to back: wait it out.
  let login = await request.post('/api/v1/auth/login', { data: { email: 'owner@demo.triphub.test', password: 'Demo-Password-123!' } });
  for (let i = 0; i < 3 && login.status() === 429; i++) {
    await new Promise((r) => setTimeout(r, (Number(login.headers()['retry-after']) || 20) * 1000));
    login = await request.post('/api/v1/auth/login', { data: { email: 'owner@demo.triphub.test', password: 'Demo-Password-123!' } });
  }
  expect(login.ok()).toBeTruthy();
  const companies = (await (await request.get('/api/v1/companies')).json()).companies as Array<{ id: string; slug: string }>;
  const cid = companies.find((c) => c.slug === 'demo-cedar-guides')!.id;
  // The demo business is on the free trial (10 active listings): archive leftovers from earlier runs first.
  const mine = ((await (await request.get(`/api/v1/companies/${cid}/listings`)).json()) as { listings: Array<{ id: string; status: string; translations: Record<string, { title: string }> }> }).listings;
  for (const l of mine) {
    if (l.status === 'PUBLISHED' && /^Gallery /.test(l.translations.en?.title ?? '')) await request.post(`/api/v1/companies/${cid}/listings/${l.id}/archive`);
  }
  const city = `Gallerytown${Date.now().toString(36)}`;
  const make = async (title: string, photos: number) => {
    const l = await request.post(`/api/v1/companies/${cid}/listings`, {
      data: { category: 'museums', bookingMode: 'DISCOVERY_ONLY', city, meetingPoint: 'Square', translations: { en: { title, description: 'A calm and carefully guided walk with plenty of time for photos and tea.' } } },
    });
    const id = ((await l.json()) as { listing: { id: string } }).listing.id;
    for (let i = 0; i < photos; i++) {
      const up = await request.put(`/api/v1/companies/${cid}/listings/${id}/images?alt=${encodeURIComponent(`Photo ${i + 1} of ${title}`)}`, { headers: { 'content-type': 'image/png' }, data: PNG });
      expect(up.ok()).toBeTruthy();
    }
    expect((await request.post(`/api/v1/companies/${cid}/listings/${id}/publish`)).ok()).toBeTruthy();
    return id;
  };
  const main = await make(`Gallery main ${city}`, 3);
  await make(`Gallery sibling ${city}`, 0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/en/listings/${main}`);
  const first = page.getByRole('button', { name: /Open photo 1 of 3/ });
  await first.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('1 of 3');
  await page.keyboard.press('ArrowRight');
  await expect(dialog).toContainText('2 of 3');
  await dialog.getByRole('button', { name: 'Next photo' }).click();
  await expect(dialog).toContainText('3 of 3');
  await dialog.getByRole('button', { name: 'Next photo' }).click();
  await expect(dialog).toContainText('1 of 3'); // wraps
  const axe = await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(first).toBeFocused();

  await expect(page.getByRole('heading', { name: 'More experiences nearby' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(`Gallery sibling ${city}`) })).toBeVisible();
});
