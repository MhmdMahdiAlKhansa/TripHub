import Link from 'next/link';
import type { T } from '../i18n/messages';
import { LocaleSwitcher } from './LocaleSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { WorkspaceSignOut } from './WorkspaceSignOut';

/** Top bar of the staff and business workspaces: no marketing hero, no traveller navigation. */
export function WorkspaceBar({ locale, t }: { locale: 'en' | 'ar'; t: T }) {
  return (
    <header className="band-deep sticky top-0 z-40 px-4 py-2">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <Link href={`/${locale}`} className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/triphub-mark.svg" alt="" width={32} height={32} className="h-8 w-8" />
          <span className="font-bold">{t('brand.name')}</span>
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold">{t('ws.badge')}</span>
        </Link>
        <nav aria-label={t('ws.nav')} className="flex flex-wrap items-center gap-1 text-sm font-semibold">
          <Link href={`/${locale}`} className="inline-flex min-h-11 items-center rounded-full px-3 hover:bg-white/10">{t('ws.publicSite')}</Link>
          <Link href={`/${locale}/profile`} className="inline-flex min-h-11 items-center rounded-full px-3 hover:bg-white/10">{t('ws.myAccount')}</Link>
          <LocaleSwitcher current={locale} label={t('common.language')} text={t('common.switchTo')} />
          <ThemeToggle label={t('theme.toggle')} />
          <WorkspaceSignOut locale={locale} label={t('auth.logout')} />
        </nav>
      </div>
    </header>
  );
}
