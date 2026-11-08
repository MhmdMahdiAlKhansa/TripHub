import { PageHero } from '../../../components/PageHero';
import { notFound } from 'next/navigation';
import { DevMailbox } from '../../../components/DevMailbox';
import { isLocale } from '../../../i18n/locale';
import { createT } from '../../../i18n/messages';

export default async function DevMailboxPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Not part of the product: hidden entirely in production builds.
  if (!isLocale(locale) || process.env.NODE_ENV === 'production') notFound();
  const t = createT(locale);
  return (
    <div className="space-y-6">
      <PageHero title={t('dev.title')} />
      <DevMailbox labels={{ note: t('dev.note'), empty: t('dev.empty'), off: t('dev.off') }} />
    </div>
  );
}
