import { PageHero } from '../../../components/PageHero';
import { notFound } from 'next/navigation';
import { VerifyEmail } from '../../../components/VerifyEmail';
import { isLocale } from '../../../i18n/locale';
import { createT } from '../../../i18n/messages';

export default async function VerifyEmailPage({
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
  const token = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 200) ?? '';
  return (
    <div className="space-y-6">
      <PageHero title={t('auth.verifyTitle')} />
      <VerifyEmail
        token={token}
        locale={locale}
        labels={{ verifying: t('auth.verifying'), ok: t('auth.verified'), failed: t('auth.verifyFailed'), signIn: t('auth.loginCta') }}
      />
    </div>
  );
}
