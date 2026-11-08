import { PageHero } from '../../../components/PageHero';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuthForm } from '../../../components/AuthForm';
import { isLocale } from '../../../i18n/locale';
import { createT } from '../../../i18n/messages';

export default async function Login({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createT(locale);
  return (
    <div className="space-y-6">
      <PageHero title={t('auth.loginTitle')} />
      <AuthForm
        mode="login"
        locale={locale}
        labels={{
          email: t('auth.email'), password: t('auth.password'), passwordHint: t('auth.passwordHint'), displayName: t('auth.displayName'),
          cta: t('auth.loginCta'), working: t('auth.working'), errorGeneric: t('auth.errorGeneric'), errorInvalid: t('auth.errorInvalid'),
          errorTooMany: t('auth.errorTooMany'), errorValidation: t('auth.errorValidation'),
          registeredTitle: t('auth.registeredTitle'), registeredBody: t('auth.registeredBody'),
          code: t('auth.code'), codeHint: t('auth.codeHint'), codeNeeded: t('auth.codeNeeded'),
        }}
      />
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
