import { expect, test } from '@playwright/test';

// Needs a web build made with NEXT_PUBLIC_MAP_STYLE_URL (see README). Skipped otherwise, because a
// production build deliberately shows no map until a licensed tile provider is configured.
test.skip(!process.env.E2E_MAP, 'map provider not configured for this build');

test('a listing with coordinates shows an interactive map with a keyboard-focusable marker', async ({ page, request }) => {
  const login = await request.post('/api/v1/auth/login', { data: { email: 'owner@demo.triphub.test', password: 'Demo-Password-123!' } });
  expect(login.ok()).toBeTruthy();
  const cid = ((await (await request.get('/api/v1/companies')).json()) as { companies: Array<{ id: string; slug: string }> }).companies.find((c) => c.slug === 'demo-cedar-guides')!.id;
  const l = await request.post(`/api/v1/companies/${cid}/listings`, {
    data: { category: 'hiking', bookingMode: 'DISCOVERY_ONLY', city: 'Bsharri', latitude: 34.25, longitude: 36.01, meetingPoint: 'Square', translations: { en: { title: `Map walk ${Date.now()}`, description: 'A calm and carefully guided walk with plenty of time for photos and tea.' } } },
  });
  const id = ((await l.json()) as { listing: { id: string } }).listing.id;
  expect((await request.post(`/api/v1/companies/${cid}/listings/${id}/publish`)).ok()).toBeTruthy();
  try {
    await page.goto(`/en/listings/${id}`);
    const region = page.getByRole('group', { name: 'Where it happens' });
    await expect(region).toBeVisible();
    await expect(region.getByRole('button', { name: /Map walk/ })).toBeVisible();
  } finally {
    await request.post(`/api/v1/companies/${cid}/listings/${id}/archive`);
  }
});
