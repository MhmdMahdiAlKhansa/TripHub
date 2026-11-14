import type { Locale } from '@triphub/shared';
import Link from 'next/link';
import type { T } from '../i18n/messages';
import { AuthLinks } from './AuthLinks';
import { HeaderShell } from './HeaderShell';
import { LocaleSwitcher } from './LocaleSwitcher';
import { ThemeToggle } from './ThemeToggle';

export function SiteHeader({ locale, t }: { locale: Locale; t: T }) {
  const links = [
    { href: `/${locale}`, label: t('nav.home') },
    { href: `/${locale}/explore`, label: t('nav.explore') },
    { href: `/${locale}/saved`, label: t('nav.saved') },
    { href: `/${locale}/business`, label: t('nav.businesses') },
  ];
  return (
    <HeaderShell>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2">
        <Link href={`/${locale}`} className="flex items-center gap-2 text-[var(--brand)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/triphub-mark.svg" alt="" width={40} height={40} className="h-10 w-10" />
          <span className="text-lg font-bold text-[var(--fg)]">{t('brand.name')}</span>
        </Link>
        <nav aria-label={t('nav.main')} className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-full px-4 py-2 text-sm font-medium hover:bg-[var(--surface-2)]">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <LocaleSwitcher current={locale} label={t('common.language')} text={t('common.switchTo')} />
          <ThemeToggle label={t('theme.toggle')} />
          <AuthLinks locale={locale} labels={{ login: t('nav.login'), signup: t('nav.signup'), profile: t('nav.profile'), staffDesk: t('nav.staffDesk'), myBusiness: t('nav.myBusiness') }} />
        </div>
      </div>
    </HeaderShell>
  );
}
