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
