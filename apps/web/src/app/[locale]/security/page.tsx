import { PageHero } from '../../../components/PageHero';
import { notFound } from 'next/navigation';
import { SecurityPanel } from '../../../components/SecurityPanel';
import { isLocale } from '../../../i18n/locale';
import { createT } from '../../../i18n/messages';

export default async function Security({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createT(locale);
  return (
    <div className="space-y-6">
      <PageHero title={t('sec.title')} />
      <SecurityPanel
        locale={locale}
        labels={{
          signIn: t('sec.signIn'), loginCta: t('auth.loginCta'), working: t('auth.working'), mfaOff: t('sec.mfaOff'), mfaOn: t('sec.mfaOn'),
          enable: t('sec.enable'), secretLabel: t('sec.secretLabel'), confirmCode: t('sec.confirmCode'), confirm: t('sec.confirm'),
          recovery: t('sec.recovery'), disable: t('sec.disable'), password: t('sec.password'), code: t('auth.code'), error: t('sec.error'), done: t('sec.done'),
        }}
      />
    </div>
  );
}
