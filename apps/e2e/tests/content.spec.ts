import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = [
  ['about', 'About TripHub and Lebanon', 'عن TripHub ولبنان'],
  ['help', 'Help and frequently asked questions', 'المساعدة والأسئلة الشائعة'],
  ['terms', 'Terms of use (draft)', 'شروط الاستخدام (مسودة)'],
  ['privacy', 'Privacy notice (draft)', 'إشعار الخصوصية (مسودة)'],
] as const;

for (const [slug, en, ar] of PAGES) {
  for (const [locale, title] of [['en', en], ['ar', ar]] as const) {
    test(`/${locale}/${slug} renders and is accessible`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/${locale}/${slug}`);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      if (slug === 'terms' || slug === 'privacy') await expect(page.getByRole('note')).toBeVisible(); // draft warning is always shown
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    });
  }
}

test('the footer links reach the policy pages, and unknown pages are a real 404', async ({ page }) => {
  await page.goto('/en');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Help' }).click();
  await expect(page).toHaveURL(/\/en\/help$/);
  expect((await page.goto('/en/not-a-page'))?.status()).toBe(404);
});
