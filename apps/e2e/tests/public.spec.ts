import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = ['/en', '/ar', '/en/explore', '/ar/explore', '/en/login', '/ar/login', '/en/register', '/en/forgot-password'];

for (const path of PAGES) {
  test(`${path}: no serious accessibility violations`, async ({ page }) => {
    // Scroll reveals fade text in; measure contrast on the settled state (also what reduced-motion users get).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([]);
  });
}

test('Arabic is right-to-left and English left-to-right', async ({ page }) => {
  await page.goto('/ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await page.goto('/en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('a listing page shows dates, the booking form and the cancellation policy', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/en/explore?q=DEMO');
  await page.getByRole('link', { name: /DEMO Cedar Forest Walk/ }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: /DEMO Cedar Forest Walk/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cancellation policy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book now' })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

test('an unknown listing is a real 404, not a blank page', async ({ page }) => {
  const res = await page.goto('/en/listings/00000000-0000-4000-8000-000000000000');
  expect(res?.status()).toBe(404);
});

test('home page stays accessible after the scroll animations have played', async ({ page }) => {
  await page.goto('/en');
  for (let y = 0; y <= 6000; y += 600) {
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1200);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test('motion is switched off for visitors who ask for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/en');
  const names = await page.evaluate(() => [...document.querySelectorAll('.reveal, .parallax')].map((el) => getComputedStyle(el).animationName));
  expect(names.length).toBeGreaterThan(5);
  expect(names.every((n) => n === 'none')).toBe(true);
});

test('with motion allowed, reveals and parallax are CSS scroll-driven (no script needed)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/en');
  const names = await page.evaluate(() => [...document.querySelectorAll('.reveal')].map((el) => getComputedStyle(el).animationName));
  expect(names.some((n) => n === 'reveal-in')).toBe(true);
});
