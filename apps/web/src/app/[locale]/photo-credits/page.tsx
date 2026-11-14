import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import credits from '../../../content/photo-credits.json';
import { PageHero } from '../../../components/PageHero';
import { isLocale } from '../../../i18n/locale';
import { createT } from '../../../i18n/messages';

export const metadata: Metadata = { title: 'Photo credits' };

type Credit = { title: string; author: string; license: string; licenseUrl: string | null; source: string };

/** Attribution for the free-licensed photographs of real places (Wikimedia Commons). */
export default async function PhotoCredits({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createT(locale);
  const rows = Object.values(credits as Record<string, Credit>);
  return (
    <article className="space-y-8">
      <PageHero title={t('credits.title')} subtitle={t('credits.lead')} />
      <ul className="max-w-3xl space-y-4">
        {rows.map((c) => (
          <li key={c.source} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="font-semibold" dir="ltr">{c.title}</p>
            <p className="text-sm text-[var(--muted)]">
              {t('credits.by')} <span dir="ltr">{c.author}</span> · {t('credits.licence')}:{' '}
              {c.licenseUrl ? <a className="text-[var(--brand)] underline" href={c.licenseUrl} rel="noopener noreferrer">{c.license}</a> : c.license} ·{' '}
              <a className="text-[var(--brand)] underline" href={c.source} rel="noopener noreferrer">{t('credits.source')}</a>
            </p>
          </li>
        ))}
      </ul>
    </article>
  );
}
