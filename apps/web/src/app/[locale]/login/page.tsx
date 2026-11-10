import { PageHero } from '../../../components/PageHero';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GoogleButton } from '../../../components/GoogleButton';
import { apiGet } from '../../../lib/api';
import { EmailCodeLogin } from '../../../components/EmailCodeLogin';
import { AuthForm } from '../../../components/AuthForm';
import { isLocale } from '../../../i18n/locale';
import { createT } from '../../../i18n/messages';

export default async function Login({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string | string[] }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createT(locale);
  const g = await apiGet<{ enabled: boolean }>('/auth/google/status');
  const raw = (await searchParams).error;
  const err = Array.isArray(raw) ? raw[0] : raw;
  const errors: Record<string, string> = {
    google_failed: t('auth.errorGoogle'), google_mfa: t('auth.errorGoogleMfa'), google_unverified: t('auth.errorGoogleUnverified'), google_blocked: t('auth.errorGoogleBlocked'),
  };
  return (
    <div className="space-y-6">
      <PageHero title={t('auth.loginTitle')} />
      {g.ok && g.data.enabled ? <GoogleButton locale={locale} label={t('auth.google')} or={t('auth.or')} error={err ? errors[err] : undefined} /> : null}
      <AuthForm
        mode="login"
        locale={locale}
        labels={{
          email: t('auth.email'), password: t('auth.password'), passwordHint: t('auth.passwordHint'), displayName: t('auth.displayName'),
          cta: t('auth.loginCta'), working: t('auth.working'), errorGeneric: t('auth.errorGeneric'), errorTaken: t('auth.errorTaken'), errorInvalid: t('auth.errorInvalid'),
          errorTooMany: t('auth.errorTooMany'), errorValidation: t('auth.errorValidation'),
          registeredTitle: t('auth.registeredTitle'), registeredBody: t('auth.registeredBody'),
          code: t('auth.code'), codeHint: t('auth.codeHint'), codeNeeded: t('auth.codeNeeded'),
        }}
      />
      <EmailCodeLogin locale={locale} labels={{ title: t('otp.title'), email: t('otp.email'), send: t('otp.send'), sent: t('otp.sent'), code: t('otp.code'), verify: t('otp.verify'), working: t('auth.working'), invalid: t('otp.invalid'), tooMany: t('otp.tooMany'), generic: t('otp.generic') }} />
      <p>
        <Link href={`/${locale}/forgot-password`} className="text-[var(--brand)] underline">
          {t('auth.forgot')}
        </Link>
      </p>
      <p>
        {t('auth.noAccount')}{' '}
        <Link href={`/${locale}/register`} className="text-[var(--brand)] underline">
          {t('auth.registerCta')}
        </Link>
      </p>
    </div>
  );
}
