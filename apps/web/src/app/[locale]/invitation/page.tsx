import { PageHero } from '../../../components/PageHero';
import { notFound } from 'next/navigation';
import { AcceptInvitation } from '../../../components/AcceptInvitation';
import { isLocale } from '../../../i18n/locale';
import { createT } from '../../../i18n/messages';

export default async function Invitation({
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
      <PageHero title={t('inv.title')} />
      <AcceptInvitation
        token={token}
        locale={locale}
        labels={{ accept: t('inv.accept'), working: t('auth.working'), done: t('inv.done'), failed: t('inv.failed'), needSignIn: t('inv.needSignIn'), signIn: t('auth.loginCta'), open: t('inv.open') }}
      />
    </div>
  );
}
