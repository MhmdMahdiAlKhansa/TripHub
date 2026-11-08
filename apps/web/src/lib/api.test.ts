import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, formatMoney } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('apiGet', () => {
  it('returns data on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ a: 1 }), { status: 200 })));
    expect(await apiGet<{ a: number }>('/x')).toEqual({ ok: true, data: { a: 1 } });
  });
  it('reports the status (so 404 can differ from a failure) and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    expect(await apiGet('/x')).toEqual({ ok: false, status: 404 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await apiGet('/x')).toEqual({ ok: false, status: 0 });
  });
});

describe('formatMoney', () => {
  it('formats minor units for display in both locales', () => {
    expect(formatMoney('1900', 'USD', 'en')).toBe('$19.00');
    expect(formatMoney('0', 'USD', 'en')).toBe('$0.00');
    expect(formatMoney('150000', 'LBP', 'en')).toContain('LBP');
    expect(formatMoney('1900', 'USD', 'ar')).toMatch(/١٩|19/);
  });
});
