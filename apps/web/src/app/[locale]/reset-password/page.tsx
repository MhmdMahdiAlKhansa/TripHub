import { PageHero } from '../../../components/PageHero';
import { notFound } from 'next/navigation';
import { ResetForm } from '../../../components/ResetForm';
import { isLocale } from '../../../i18n/locale';
import { createT } from '../../../i18n/messages';

export default async function Reset({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createT(locale);
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 200);
  return (
    <div className="space-y-6">
      <PageHero title={t('auth.resetTitle')} />
      <ResetForm
        mode="confirm"
        token={token}
        locale={locale}
        labels={{ email: t('auth.email'), newPassword: t('auth.newPassword'), passwordHint: t('auth.passwordHint'), cta: t('auth.resetCta'), working: t('auth.working'), done: t('auth.resetDone'), failed: t('auth.resetFailed'), generic: t('auth.errorGeneric'), signIn: t('auth.loginCta') }}
      />
    </div>
  );
}
