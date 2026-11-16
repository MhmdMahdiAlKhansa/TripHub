import { expect, test } from '@playwright/test';

const PW = 'Demo-Password-123!';

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('a traveller finds a stay near a hike, sees the price for their nights, and books them', async ({ page }) => {
  // The Qadisha hike page suggests places to stay in the same area.
  await page.goto('/en/explore?q=Qadisha+Valley+and+Mar+Elisha');
  await page.getByRole('link', { name: /Qadisha Valley and Mar Elisha/ }).first().click();
  const near = page.getByRole('region', { name: 'Stay nearby' });
  await expect(near).toBeVisible();
  await near.getByRole('link', { name: /Hasroun/ }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: /Hasroun/ })).toBeVisible();
  await expect(page.getByText('Sleeps 6')).toBeVisible();
  const propertyUrl = page.url();

  await signIn(page, 'customer@demo.triphub.test');
  await expect(page).toHaveURL(/\/en\/profile/);
  await page.goto(propertyUrl);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const start = 200 + Math.floor(Math.random() * 120); // far ahead and random, so repeated runs do not collide
  await page.getByLabel('Check-in').fill(day(start));
  await page.getByLabel('Check-out').fill(day(start + 2));
  await page.getByRole('spinbutton', { name: /^Guests/ }).fill('3');
  await expect(page.getByText(/^2 nights/)).toBeVisible(); // the price breakdown
  await page.getByRole('button', { name: 'Book these nights' }).click();
  await expect(page.getByRole('status')).toContainText('Your nights are held');

  // The same nights can no longer be booked.
  await page.reload();
  await page.getByLabel('Check-in').fill(day(start + 1));
  await page.getByLabel('Check-out').fill(day(start + 3));
  await expect(page.getByText('Some of these nights are already taken')).toBeVisible();
});

test('a property host has their own desk: properties, prices and a calendar with stays and blocked dates', async ({ page }) => {
  await signIn(page, 'host@demo.triphub.test');
  await expect(page).toHaveURL(/\/en\/business\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Your property business' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Stays and arrivals' })).toBeVisible();
  await page.getByRole('tab', { name: 'Properties' }).click();
  await page.getByRole('link', { name: 'Manage listings' }).click();
  await expect(page.getByRole('heading', { name: 'Properties', level: 1 })).toBeVisible();
  const card = page.getByRole('listitem').filter({ hasText: 'Triple-arch stone house in Hasroun' }).first();
  await expect(card.getByText('Lea Khoury')).toBeVisible();
  await expect(card.getByText(/Blocked: Family visiting/)).toBeVisible();
  await expect(card.getByLabel('Per night')).toHaveValue('90.00');
  // Block some nights far in the future, then unblock them.
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const from = 330 + Math.floor(Math.random() * 20);
  await card.getByLabel('From (first night)').fill(day(from));
  await card.getByLabel('To (morning after the last night)').fill(day(from + 2));
  await card.getByLabel('Private note (optional)').fill('Painting the bedrooms');
  await card.getByRole('button', { name: 'Block these dates' }).click();
  await expect(card.getByText(/Painting the bedrooms/)).toBeVisible();
  await card.getByRole('listitem').filter({ hasText: 'Painting the bedrooms' }).getByRole('button', { name: 'Unblock' }).click();
  await expect(card.getByText(/Painting the bedrooms/)).toHaveCount(0);
});

test('signing up as a host creates a property business', async ({ page, request }) => {
  const email = `e2e-host-${Date.now()}@example.test`;
  await page.goto('/en/for-business');
  await page.getByLabel('We host guests at a property (chalet, guesthouse, cabin)').check();
  await page.getByLabel('Business name').fill('Ehden Pine Cabins');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-long-e2e-password-1');
  await page.getByRole('button', { name: 'Create business account' }).click();
  await expect(page.getByText('Almost there')).toBeVisible();
  const mails = ((await (await request.get('/api/v1/dev/mailbox')).json()) as { mails: Array<{ to: string; template: string; link: string }> }).mails;
  await page.goto(mails.find((m) => m.to === email && m.template === 'verify-email')!.link);
  await page.goto('/en/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-long-e2e-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your property business' })).toBeVisible();
});
