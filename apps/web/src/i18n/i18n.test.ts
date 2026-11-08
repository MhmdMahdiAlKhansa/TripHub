import { LOCALES } from '@triphub/shared';
import { describe, expect, it } from 'vitest';
import { dirOf, negotiateLocale, switchLocalePath } from './locale';
import { allCatalogs } from './messages';

describe('translation completeness', () => {
  const base = Object.keys(allCatalogs.en).sort();
  for (const locale of LOCALES) {
    it(`${locale} has exactly the same keys as en, with no empty values`, () => {
      expect(Object.keys(allCatalogs[locale]).sort()).toEqual(base);
      for (const [k, v] of Object.entries(allCatalogs[locale])) {
        expect(v.trim().length, `${locale}:${k} is empty`).toBeGreaterThan(0);
      }
    });
  }
  it('Arabic strings are actually translated (not copies of English), except the brand-neutral few', () => {
    const same = base.filter((k) => allCatalogs.ar[k] === allCatalogs.en[k]);
    expect(same).toEqual([]);
  });
});

describe('locale negotiation', () => {
  it('explicit cookie wins over Accept-Language', () => {
    expect(negotiateLocale({ cookie: 'en', acceptLanguage: 'ar' })).toBe('en');
  });
  it('picks the highest-q supported language', () => {
    expect(negotiateLocale({ acceptLanguage: 'fr;q=0.9,ar-LB;q=0.8,en;q=0.5' })).toBe('ar');
    expect(negotiateLocale({ acceptLanguage: 'ar;q=0.2,en;q=0.9' })).toBe('en');
  });
  it('falls back to English for unknown, empty or malformed input', () => {
    expect(negotiateLocale({ acceptLanguage: 'fr,de' })).toBe('en');
    expect(negotiateLocale({ cookie: 'xx', acceptLanguage: ';;;q=abc' })).toBe('en');
    expect(negotiateLocale({})).toBe('en');
  });
  it('ignores q=0 (explicitly refused) languages', () => {
    expect(negotiateLocale({ acceptLanguage: 'ar;q=0,en' })).toBe('en');
  });
});

describe('direction and path helpers', () => {
  it('Arabic is RTL, English LTR', () => {
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
  });
  it('switches locale segment preserving the rest of the path', () => {
    expect(switchLocalePath('/en/explore', 'ar')).toBe('/ar/explore');
    expect(switchLocalePath('/ar', 'en')).toBe('/en');
    expect(switchLocalePath('/explore', 'ar')).toBe('/ar/explore');
  });
});
