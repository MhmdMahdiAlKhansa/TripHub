import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('a business owner signs in, sees plan and bookings, and creates a priced-free listing draft', async ({ page }) => {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill('owner@demo.triphub.test');
  await page.getByLabel('Password').fill('Demo-Password-123!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/profile/);

  await page.getByRole('link', { name: 'Business workspace' }).click();
  await page.getByRole('listitem').filter({ hasText: 'DEMO Cedar Guides' }).getByRole('link', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Subscription' })).toBeVisible();
  await expect(page.getByText('Free trial')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible();
  const dash = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(dash.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  await page.getByRole('link', { name: 'Manage listings' }).click();
  const title = `DEMO E2E draft ${Date.now()}`;
  const create = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create draft' }) });
  await create.getByLabel('Title (English)').fill(title);
  await create.getByLabel(/Description \(English/).fill('A calm and carefully guided walk with plenty of time for photos and tea along the valley.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('status').first()).toContainText('Saved.');
  await expect(page.getByText(title)).toBeVisible();
  const card = page.getByRole('listitem').filter({ hasText: title });
  await card.getByText('Edit details').click();
  await card.getByLabel('City', { exact: true }).last().fill('Tannourine');
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').first()).toContainText('Saved.');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await card.locator('input[type=file][name=photo]').setInputFiles({ name: 'trail.png', mimeType: 'image/png', buffer: png });
  await card.getByLabel('Describe the photo (for screen readers)').fill('A trail through cedar trees');
  await card.getByRole('button', { name: 'Add photo' }).click();
  await expect(card.getByRole('img', { name: 'A trail through cedar trees' })).toBeAttached();
  const list = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(list.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  // A draft is not public.
  const res = await page.request.get(`/api/v1/public/listings?q=${encodeURIComponent(title)}`);
  expect((await res.json()).listings).toHaveLength(0);
});

test('a customer cannot open someone else\'s business workspace data', async ({ page }) => {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill('customer@demo.triphub.test');
  await page.getByLabel('Password').fill('Demo-Password-123!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/profile/);
  await page.getByRole('link', { name: 'Business workspace' }).click();
  await expect(page.getByText('You are not part of any business yet.')).toBeVisible();
});
