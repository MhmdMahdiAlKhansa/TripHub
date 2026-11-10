import { expect, test } from '@playwright/test';

test('a customer signs in with a 6-digit code from the (development) mailbox, and a wrong code is refused', async ({ page, request }) => {
  const email = `e2e-code-${Date.now()}@example.test`;
  const password = 'a-long-e2e-password-1';
  await page.goto('/en/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Almost there')).toBeVisible();
  const mails = async () => ((await (await request.get('/api/v1/dev/mailbox')).json()) as { mails: Array<{ to: string; template: string; link: string; code?: string }> }).mails;
  await page.goto((await mails()).find((m) => m.to === email && m.template === 'verify-email')!.link);
  await expect(page.getByText('Your email is verified')).toBeVisible();

  await page.goto('/en/login');
  const box = page.getByRole('region', { name: 'Or get a one-time sign-in code' });
  await box.getByLabel('Address to send the code to').fill(email);
  await box.getByRole('button', { name: 'Email me a code' }).click();
  await expect(box.getByRole('status')).toContainText('6-digit code');
  await box.getByLabel('6-digit code').fill('000000');
  await box.getByRole('button', { name: 'Sign in' }).click();
  await expect(box.getByRole('alert')).toContainText('wrong or expired');

  const code = (await mails()).find((m) => m.to === email && m.template === 'login-code')?.code;
  expect(code).toMatch(/^\d{6}$/);
  await box.getByLabel('6-digit code').fill(code === '000000' ? '111111' : code!);
  await box.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/profile/);
  await expect(page.getByText(email)).toBeVisible();
});
