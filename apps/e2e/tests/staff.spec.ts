import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as OTPAuth from 'otpauth';

const PASSWORD = 'a-long-staff-password-1';

/** Grants a platform role directly in the local database, exactly as the runbook describes. */
function grantRole(email: string, role: string) {
  const sql = `UPDATE "user" SET "platformRole" = '${role}' WHERE email = '${email.replace(/'/g, "''")}'`;
  if (process.env.E2E_DATABASE_URL) {
    execFileSync('psql', [process.env.E2E_DATABASE_URL, '-c', sql], { stdio: 'pipe' }); // CI: a plain Postgres service
  } else {
    execFileSync('docker', ['exec', process.env.PG_CONTAINER ?? 'triphub-postgres-1', 'psql', '-U', 'triphub', '-d', 'triphub', '-c', sql], { stdio: 'pipe' });
  }
}

test('a finance staff member signs in with two-step verification and sees every work queue', async ({ page }) => {
  test.setTimeout(120_000);
  const email = `staff-${Date.now()}@example.test`;
  const req = page.request;

  // Register + verify through the local-only dev mailbox.
  expect((await req.post('/api/v1/auth/register', { data: { email, password: PASSWORD } })).status()).toBe(202);
  const mails = ((await (await req.get('/api/v1/dev/mailbox')).json()) as { mails: Array<{ to: string; template: string; link: string }> }).mails;
  const link = new URL(mails.find((m) => m.to === email && m.template === 'verify-email')!.link);
  expect((await req.post('/api/v1/auth/verify-email', { data: { token: link.searchParams.get('token') } })).ok()).toBeTruthy();
  expect((await req.post('/api/v1/auth/login', { data: { email, password: PASSWORD } })).ok()).toBeTruthy();

  // Two-step verification with a real TOTP code.
  const setup = (await (await req.post('/api/v1/auth/mfa/setup')).json()) as { secret: string };
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.secret), digits: 6, period: 30 });
  expect((await req.post('/api/v1/auth/mfa/enable', { data: { code: totp.generate() } })).ok()).toBeTruthy();
  grantRole(email, 'FINANCE');

  // A fresh browser sign-in needs the second factor.
  await req.post('/api/v1/auth/logout');
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Enter your authentication code')).toBeVisible();
  // A TOTP code can be used once per 30-second step; the step used for enabling is spent, so wait for the next one.
  await page.waitForTimeout(31_000);
  await page.getByLabel('Authentication code').fill(totp.generate());
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/profile/);

  await page.getByRole('link', { name: 'Staff console' }).click();
  for (const name of ['Staff console', 'Payment proofs awaiting verification', 'Refunds', 'Payouts', 'Subscription requests', 'Reviews']) {
    await expect(page.getByRole('heading', { name }).first()).toBeVisible();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

test('an ordinary customer is told the staff area is not for them', async ({ page }) => {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill('customer@demo.triphub.test');
  await page.getByLabel('Password').fill('Demo-Password-123!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/en\/profile/);
  await page.goto('/en/admin');
  await expect(page.getByText('This area is for TripHub staff only.')).toBeVisible();
  expect((await page.request.get('/api/v1/admin/payments')).status()).toBe(404);
});
