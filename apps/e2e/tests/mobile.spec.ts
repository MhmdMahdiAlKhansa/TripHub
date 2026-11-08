import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

for (const path of ['/en', '/ar', '/en/explore', '/ar/explore', '/en/login', '/ar/register']) {
  test(`${path}: fits a phone screen with no sideways scrolling`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('the phone bottom navigation is shown and reaches Explore', async ({ page }) => {
  await page.goto('/en');
  const nav = page.getByRole('navigation').last();
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Explore' }).click();
  await expect(page).toHaveURL(/\/en\/explore/);
});

test('primary buttons and fields are at least 44px tall for touch', async ({ page }) => {
  await page.goto('/en/login');
  for (const el of [page.getByLabel('Email'), page.getByLabel('Password'), page.getByRole('button', { name: 'Sign in' })]) {
    const box = await el.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
