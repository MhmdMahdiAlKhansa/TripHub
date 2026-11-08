import { describe, expect, it } from 'vitest';
import { normalizeSearch, searchTerms } from './search';

describe('search normalisation', () => {
  it('makes Arabic spelling variants equal', () => {
    expect(normalizeSearch('الأرز')).toBe(normalizeSearch('الارز'));
    expect(normalizeSearch('إدارة')).toBe(normalizeSearch('اداره'));
    expect(normalizeSearch('مَدْرَسَة')).toBe(normalizeSearch('مدرسه'));
    expect(normalizeSearch('على')).toBe(normalizeSearch('علي'));
    expect(normalizeSearch('كــتاب')).toBe('كتاب');
  });
  it('maps Arabic-Indic digits and lower-cases Latin', () => {
    expect(normalizeSearch('رحلة ٢٠٢٧ Cedar')).toBe('رحله 2027 cedar');
  });
  it('splits into a small set of meaningful terms', () => {
    expect(searchTerms('  Cedar   a  walk walk ')).toEqual(['cedar', 'walk']);
    expect(searchTerms('a b c d e f g h i j kk ll mm nn oo pp').length).toBeLessThanOrEqual(6);
  });
});
