import { PageHero } from '../../../components/PageHero';
import { notFound } from 'next/navigation';
import { BusinessList } from '../../../components/BusinessList';
import { isLocale } from '../../../i18n/locale';
import { createT } from '../../../i18n/messages';

export default async function Business({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createT(locale);
  return (
    <div className="space-y-6">
      <PageHero title={t('biz.title')} />
      <BusinessList
        locale={locale}
        labels={{ createTitle: t('biz.createTitle'), createName: t('biz.createName'), createCta: t('biz.createCta'), createError: t('biz.createError'), companies: t('biz.companies'), none: t('biz.none'), open: t('biz.open'), signIn: t('biz.signIn'), loginCta: t('auth.loginCta'), working: t('auth.working') }}
      />
    </div>
  );
}
