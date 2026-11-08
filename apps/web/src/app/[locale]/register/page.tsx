import { PageHero } from '../../../components/PageHero';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuthForm } from '../../../components/AuthForm';
import { isLocale } from '../../../i18n/locale';
import { createT } from '../../../i18n/messages';

export default async function Register({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createT(locale);
  return (
    <div className="space-y-6">
      <PageHero title={t('auth.registerTitle')} />
      <AuthForm
        mode="register"
        locale={locale}
        labels={{
          email: t('auth.email'), password: t('auth.password'), passwordHint: t('auth.passwordHint'), displayName: t('auth.displayName'),
          cta: t('auth.registerCta'), working: t('auth.working'), errorGeneric: t('auth.errorGeneric'), errorInvalid: t('auth.errorInvalid'),
          errorTooMany: t('auth.errorTooMany'), errorValidation: t('auth.errorValidation'),
          registeredTitle: t('auth.registeredTitle'), registeredBody: t('auth.registeredBody'),
          code: t('auth.code'), codeHint: t('auth.codeHint'), codeNeeded: t('auth.codeNeeded'),
        }}
      />
      <p>
        {t('auth.haveAccount')}{' '}
        <Link href={`/${locale}/login`} className="text-[var(--brand)] underline">
          {t('auth.loginCta')}
        </Link>
      </p>
    </div>
  );
}
