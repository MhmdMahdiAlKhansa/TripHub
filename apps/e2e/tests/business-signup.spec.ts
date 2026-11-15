import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('a business signs up directly: one form creates the account and the business, and the owner lands in their workspace', async ({ page, request }) => {
  const email = `e2e-biz-${Date.now()}@example.test`;
  const password = 'a-long-e2e-password-1';
  await page.goto('/en');
  await page.getByRole('link', { name: 'For businesses' }).first().click();
  await expect(page).toHaveURL(/\/en\/for-business/);
  await expect(page.getByRole('heading', { name: 'Create your business account' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plans' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  await page.getByLabel('Business name').fill('Jbeil Sea Kayak Club');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create business account' }).click();
  await expect(page.getByText('Almost there')).toBeVisible();

  const mails = ((await (await request.get('/api/v1/dev/mailbox')).json()) as { mails: Array<{ to: string; template: string; link: string }> }).mails;
  await page.goto(mails.find((m) => m.to === email && m.template === 'verify-email')!.link);
  await expect(page.getByText('Your email is verified')).toBeVisible();
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The new owner goes straight to their own business desk.
  await expect(page).toHaveURL(/\/en\/business\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Your business' })).toBeVisible();
  await page.getByRole('tab', { name: 'Business profile' }).click();
  await expect(page.getByLabel('Business name')).toHaveValue('Jbeil Sea Kayak Club');
});

test('a new (unverified) business can draft a listing and is told clearly why it cannot publish yet', async ({ page, request }) => {
  const email = `e2e-draft-${Date.now()}@example.test`;
  const password = 'a-long-e2e-password-1';
  await request.post('/api/v1/auth/register', { data: { email, password, businessName: 'Batroun Bike Tours' } });
  const mails = ((await (await request.get('/api/v1/dev/mailbox')).json()) as { mails: Array<{ to: string; template: string; link: string }> }).mails;
  await request.post('/api/v1/auth/verify-email', { data: { token: new URL(mails.find((m) => m.to === email && m.template === 'verify-email')!.link).searchParams.get('token') } });
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/business\/[0-9a-f-]{36}$/);
  await page.getByRole('tab', { name: 'Listings' }).click();
  await page.getByRole('link', { name: 'Manage listings' }).click();

  // The page says up front that the business must be verified first.
  await expect(page.getByRole('note')).toContainText('must be verified');
  const title = `Batroun coast ride ${Date.now()}`;
  const create = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create draft' }) });
  await create.getByLabel('Title (English)').fill(title);
  await create.getByLabel(/Description \(English/).fill('An easy ride along the Batroun coast with a stop for lemonade in the old town.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('status').first()).toContainText('Draft created');
  const card = page.getByRole('listitem').filter({ hasText: title }).first();
  await card.getByRole('button', { name: 'Publish' }).click();
  await expect(card.getByRole('alert')).toContainText('not verified yet');
});
