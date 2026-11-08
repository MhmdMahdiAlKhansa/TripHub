import { expect, test } from '@playwright/test';

const EMAIL = 'customer@demo.triphub.test';
const PASSWORD = 'Demo-Password-123!';

test('wrong password shows a clear error and does not sign in', async ({ page }) => {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill('definitely-wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form [role=alert]')).toContainText(/incorrect/i);
  await page.goto('/en/profile');
  await expect(page.getByText('You are not signed in')).toBeVisible();
});

test('sign in, book a free demo experience, see it in My bookings, cancel it, sign out', async ({ page }) => {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/profile/);
  await expect(page.getByText(EMAIL)).toBeVisible();

  await page.goto('/en/explore?q=DEMO+Cedar');
  await page.getByRole('link', { name: /DEMO Cedar Forest Walk/ }).first().click();
  await page.getByLabel('Adult', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Book now' }).click();
  await expect(page.getByRole('status')).toContainText('Your booking is confirmed.');
  const reference = (await page.getByRole('status').locator('strong').innerText()).trim();

  await page.getByRole('link', { name: 'View my bookings' }).click();
  const row = page.getByRole('listitem').filter({ hasText: reference });
  await expect(row).toContainText('Confirmed');
  await row.getByRole('button', { name: 'Show my check-in code' }).click();
  await expect(row.locator('code')).toContainText(reference);
  await expect(row.getByRole('link', { name: 'Add to calendar' })).toHaveAttribute('href', /calendar\.ics$/);
  await row.getByRole('button', { name: 'Cancel booking' }).click();
  await expect(row).toContainText('Cancelled');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/en\/?$/);
  await page.goto('/en/profile');
  await expect(page.getByText('You are not signed in')).toBeVisible();
});

test('signed-out visitors are asked to sign in before booking, and no booking is made', async ({ page }) => {
  await page.goto('/en/explore?q=DEMO+Cedar');
  await page.getByRole('link', { name: /DEMO Cedar Forest Walk/ }).first().click();
  await page.getByLabel('Adult', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Book now' }).click();
  await expect(page.getByText('Sign in to book.')).toBeVisible();
});
