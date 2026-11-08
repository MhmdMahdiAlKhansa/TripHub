'use client';

import type { Locale } from '@triphub/shared';
import { usePathname } from 'next/navigation';
import { LOCALE_COOKIE, switchLocalePath } from '../i18n/locale';

export function LocaleSwitcher({ current, label, text }: { current: Locale; label: string; text: string }) {
  const pathname = usePathname() ?? `/${current}`;
  const target: Locale = current === 'ar' ? 'en' : 'ar';

  return (
    <a
      href={switchLocalePath(pathname, target)}
      hrefLang={target}
      lang={target}
      aria-label={`${label}: ${text}`}
      onClick={() => {
        document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=31536000; samesite=lax`;
      }}
      className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold hover:bg-[var(--surface-2)]"
    >
      {text}
    </a>
  );
}
