import Link from 'next/link';
import type { T } from '../i18n/messages';

/** Footer on every page: policy and help links, and an honest one-line description of what TripHub is. */
export function SiteFooter({ locale, t }: { locale: string; t: T }) {
  const links = [
    { href: `/${locale}/about`, label: t('footer.about') },
    { href: `/${locale}/help`, label: t('footer.help') },
    { href: `/${locale}/terms`, label: t('footer.terms') },
    { href: `/${locale}/privacy`, label: t('footer.privacy') },
  ];
  return (
    <footer className="band-deep mt-16 px-4 py-10 pb-24 md:pb-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-lg font-bold">{t('brand.name')}</p>
          <p className="max-w-md text-sm text-[#d6e6fa]">{t('footer.note')}</p>
        </div>
        <nav aria-label={t('footer.about')}>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
