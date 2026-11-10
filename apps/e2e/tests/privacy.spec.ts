import { expect, test } from '@playwright/test';

test('a customer downloads their data, then deletes their account and can no longer sign in', async ({ page, request }) => {
  const email = `e2e-privacy-${Date.now()}@example.test`;
  const password = 'a-long-e2e-password-1';
  await page.goto('/en/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Almost there')).toBeVisible();
  const box = await request.get('/api/v1/dev/mailbox');
  const mail = ((await box.json()) as { mails: Array<{ to: string; template: string; link: string }> }).mails.find((m) => m.to === email && m.template === 'verify-email');
  await page.goto(mail!.link);
  await expect(page.getByText('Your email is verified')).toBeVisible();
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/profile/);

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download my data' }).click();
  expect((await download).suggestedFilename()).toBe('triphub-my-data.json');

  await page.getByRole('button', { name: 'Delete my account' }).click();
  const confirm = page.getByRole('button', { name: 'Delete my account' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/Your password/).fill(password);
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await confirm.click();
  await expect(page).toHaveURL(/\/$|\/en\/?$/);

  await page.goto('/en/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('form [role=alert]')).toContainText(/incorrect/i);
});
