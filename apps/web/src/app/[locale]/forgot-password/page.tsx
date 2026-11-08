import { PageHero } from '../../../components/PageHero';
import { notFound } from 'next/navigation';
import { ResetForm } from '../../../components/ResetForm';
import { isLocale } from '../../../i18n/locale';
import { createT } from '../../../i18n/messages';

export default async function Forgot({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createT(locale);
  return (
    <div className="space-y-6">
      <PageHero title={t('auth.forgotTitle')} />
      <ResetForm
        mode="request"
        locale={locale}
        labels={{ email: t('auth.email'), newPassword: t('auth.newPassword'), passwordHint: t('auth.passwordHint'), cta: t('auth.forgotCta'), working: t('auth.working'), done: t('auth.forgotDone'), failed: t('auth.resetFailed'), generic: t('auth.errorGeneric'), signIn: t('auth.loginCta') }}
      />
    </div>
  );
}
