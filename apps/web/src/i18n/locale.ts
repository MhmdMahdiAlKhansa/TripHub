import { LOCALES, RTL_LOCALES, type Locale } from '@triphub/shared';

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'th_locale';

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

export const dirOf = (locale: Locale): 'rtl' | 'ltr' => (RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr');

/** Cookie wins (explicit choice), then the best Accept-Language match, then the default. */
export function negotiateLocale(opts: { cookie?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(opts.cookie)) return opts.cookie;
  const ranked = (opts.acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { lang: (tag ?? '').toLowerCase().split('-')[0] ?? '', q: q ? Number(q.split('=')[1]) : 1 };
    })
    .filter((x) => x.lang && Number.isFinite(x.q) && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const r of ranked) if (isLocale(r.lang)) return r.lang;
  return DEFAULT_LOCALE;
}

/** Replace (or add) the locale segment of a path, keeping the rest. */
export function switchLocalePath(pathname: string, to: Locale): string {
  const segs = pathname.split('/').filter(Boolean);
  if (segs[0] && isLocale(segs[0])) segs.shift();
  return `/${[to, ...segs].join('/')}`;
}
