import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const PASSWORD = 'a-long-roles-password-1';

function sql(statement: string) {
  if (process.env.E2E_DATABASE_URL) execFileSync('psql', [process.env.E2E_DATABASE_URL, '-c', statement], { stdio: 'pipe' });
  else execFileSync('docker', ['exec', process.env.PG_CONTAINER ?? 'triphub-postgres-1', 'psql', '-U', 'triphub', '-d', 'triphub', '-c', statement], { stdio: 'pipe' });
}

async function signUpAndVerify(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext, email: string) {
  await request.post('/api/v1/auth/register', { data: { email, password: PASSWORD } });
  const mails = ((await (await request.get('/api/v1/dev/mailbox')).json()) as { mails: Array<{ to: string; template: string; link: string }> }).mails;
  const link = new URL(mails.find((m) => m.to === email && m.template === 'verify-email')!.link);
  await request.post('/api/v1/auth/verify-email', { data: { token: link.searchParams.get('token') } });
}

async function signIn(page: import('@playwright/test').Page, email: string, password = PASSWORD) {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('each business role gets its own desk, tabs and colour, and the public site chrome is gone', async ({ page, request }) => {
  const stamp = Date.now();
  const members: Array<{ role: string; email: string; title: string; tabs: string[]; absent: string[] }> = [
    { role: 'BOOKING_STAFF', email: `door-${stamp}@example.test`, title: 'Door desk', tabs: ['Bookings and check-in'], absent: ['Money', 'Team', 'Listings'] },
    { role: 'FINANCE', email: `money-${stamp}@example.test`, title: 'Money desk', tabs: ['Money'], absent: ['Bookings and check-in', 'Team', 'Listings'] },
    { role: 'MANAGER', email: `ops-${stamp}@example.test`, title: 'Operations desk', tabs: ['Bookings and check-in', 'Listings', 'Insights and promotions'], absent: ['Money', 'Team'] },
  ];
  for (const m of members) {
    await signUpAndVerify(page, request, m.email);
    sql(`INSERT INTO membership ("companyId","userId",role,status,"updatedAt") SELECT c.id, u.id, '${m.role}', 'ACTIVE', now() FROM company c, "user" u WHERE c.slug = 'demo-cedar-guides' AND u.email = '${m.email}'`);
  }
  for (const m of members) {
    await signIn(page, m.email);
    await expect(page).toHaveURL(/\/en\/business\/[0-9a-f-]{36}$/); // one business: straight into it
    await expect(page.getByRole('heading', { name: m.title })).toBeVisible();
    if (m.tabs.length > 1) for (const tab of m.tabs) await expect(page.getByRole('tab', { name: tab })).toBeVisible();
    else await expect(page.getByRole('tab')).toHaveCount(0); // a single-purpose desk has nothing to switch between
    for (const tab of m.absent) await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveCount(0);
    // Workspace frame: no marketing navigation or traveller bottom bar.
    await expect(page.getByRole('link', { name: 'Public site' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
    await page.request.post('/api/v1/auth/logout');
  }
  // The owner sees everything.
  await signIn(page, 'owner@demo.triphub.test', 'Demo-Password-123!');
  await page.goto('/en/business');
  await page.getByRole('listitem').filter({ hasText: 'DEMO Cedar Guides' }).getByRole('link', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Your business' })).toBeVisible();
  for (const tab of ['Bookings and check-in', 'Listings', 'Money', 'Insights and promotions', 'Team', 'Business profile']) await expect(page.getByRole('tab', { name: tab })).toBeVisible();
});

test('a customer keeps the public site and lands on their trips', async ({ page, request }) => {
  const email = `trav-${Date.now()}@example.test`;
  await signUpAndVerify(page, request, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/en\/profile/);
  await expect(page.getByRole('link', { name: 'Explore' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Public site' })).toHaveCount(0);
});
