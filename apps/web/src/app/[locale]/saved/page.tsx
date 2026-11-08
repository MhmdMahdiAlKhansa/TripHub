import { PageHero } from '../../../components/PageHero';
import { EmptyState } from '@triphub/ui';
import { notFound } from 'next/navigation';
import { isLocale } from '../../../i18n/locale';
import { createT } from '../../../i18n/messages';

export default async function Saved({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createT(locale);
  return (
    <div className="space-y-6">
      <PageHero title={t('saved.title')} />
      <EmptyState title={t('saved.emptyTitle')} body={t('saved.emptyBody')} />
    </div>
  );
}
