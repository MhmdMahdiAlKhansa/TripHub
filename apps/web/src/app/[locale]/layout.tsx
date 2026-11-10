import '@fontsource-variable/noto-sans-arabic';
import '../globals.css';
import { LOCALES } from '@triphub/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BottomNav } from '../../components/BottomNav';
import { SiteFooter } from '../../components/SiteFooter';
import { SiteHeader } from '../../components/SiteHeader';
import { themeInitScript } from '../../components/ThemeToggle';
import { dirOf, isLocale } from '../../i18n/locale';
import { createT } from '../../i18n/messages';

export const generateStaticParams = () => LOCALES.map((locale) => ({ locale }));

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createT(locale);
  return {
    metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
    title: { default: t('brand.name'), template: `%s · ${t('brand.name')}` },
    description: t('hero.subtitle'),
    alternates: { languages: { en: '/en', ar: '/ar' } },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createT(locale);

  return (
    <html lang={locale} dir={dirOf(locale)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-full focus:bg-[var(--brand)] focus:px-4 focus:py-2 focus:text-[var(--on-brand)]"
        >
          {t('a11y.skip')}
        </a>
        <SiteHeader locale={locale} t={t} />
        <main id="main" className="mx-auto max-w-6xl px-4 pb-8 pt-24">
          {children}
        </main>
        <SiteFooter locale={locale} t={t} />
        <BottomNav
          locale={locale}
          ariaLabel={t('nav.main')}
          labels={{ home: t('nav.home'), explore: t('nav.explore'), saved: t('nav.saved'), profile: t('nav.profile') }}
        />
      </body>
    </html>
  );
}
