import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuthForm } from '../../../components/AuthForm';
import { PageHero } from '../../../components/PageHero';
import { isLocale } from '../../../i18n/locale';
import { createT, type MessageKey } from '../../../i18n/messages';
import { apiGet } from '../../../lib/api';

export const metadata: Metadata = { title: 'For businesses' };

interface Plan { code: string; name: string; listingLimit: number | null; teamLimit: number | null; monthlyMinor: string | null; commissionBps: number | null; currency: string }

/** The front door for operators: what they get, the published plans, and a sign-up that creates the account AND the business. */
export default async function ForBusiness({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createT(locale);
  const plans = await apiGet<{ plans: Plan[] }>('/plans');
  const benefits = [1, 2, 3, 4].map((n) => ({ title: t(`fb.b${n}t` as MessageKey), body: t(`fb.b${n}` as MessageKey) }));
  const steps = [1, 2, 3, 4].map((n) => t(`fb.s${n}` as MessageKey));
  const price = (p: Plan) =>
    p.monthlyMinor === null ? t('fb.custom') : p.monthlyMinor === '0' ? t('fb.free') : `$${(Number(p.monthlyMinor) / 100).toFixed(0)} ${t('fb.perMonth')}`;

  return (
    <div className="space-y-12">
      <PageHero title={t('fb.title')} subtitle={t('fb.lead')} />

      <div className="grid gap-10 lg:grid-cols-[1fr_minmax(0,28rem)]">
        <div className="space-y-10">
          <ul className="grid gap-4 sm:grid-cols-2">
            {benefits.map((b) => (
              <li key={b.title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <h2 className="text-lg font-semibold">{b.title}</h2>
                <p className="mt-1 text-[var(--muted)]">{b.body}</p>
              </li>
            ))}
          </ul>
          <section aria-labelledby="how" className="space-y-3">
            <h2 id="how" className="text-2xl font-bold">{t('fb.how')}</h2>
            <ol className="space-y-2">
              {steps.map((s, i) => (
                <li key={s} className="flex items-start gap-3">
                  <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] font-bold text-[var(--on-brand)]">{i + 1}</span>
                  <span className="pt-1">{s}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <section aria-labelledby="signup" className="space-y-4">
          <h2 id="signup" className="text-2xl font-bold">{t('fb.signupTitle')}</h2>
          <AuthForm
            mode="register"
            business
            locale={locale}
            labels={{
              businessName: t('fb.businessName'),
              email: t('auth.email'), password: t('auth.password'), passwordHint: t('auth.passwordHint'), displayName: t('auth.displayName'),
              cta: t('fb.cta'), working: t('auth.working'), errorGeneric: t('auth.errorGeneric'), errorTaken: t('auth.errorTaken'), errorInvalid: t('auth.errorInvalid'),
              errorTooMany: t('auth.errorTooMany'), errorValidation: t('auth.errorValidation'),
              registeredTitle: t('auth.registeredTitle'), registeredBody: t('auth.registeredBody'),
              code: t('auth.code'), codeHint: t('auth.codeHint'), codeNeeded: t('auth.codeNeeded'),
            }}
          />
          <p>
            {t('fb.have')}{' '}
            <Link href={`/${locale}/business`} className="text-[var(--brand)] underline">{t('fb.open')}</Link>
          </p>
        </section>
      </div>

      {plans.ok && plans.data.plans.length ? (
        <section aria-labelledby="plans" className="space-y-4">
          <h2 id="plans" className="text-2xl font-bold">{t('fb.plans')}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {plans.data.plans.map((p) => (
              <li key={p.code} className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <h3 className="text-lg font-semibold">{p.name}</h3>
                <p className="text-xl font-bold">{price(p)}</p>
                <ul className="space-y-1 text-sm text-[var(--muted)]">
                  <li>{p.listingLimit ?? t('fb.unlimited')} {t('fb.listings')}</li>
                  <li>{p.teamLimit ?? t('fb.unlimited')} {t('fb.team')}</li>
                  {p.commissionBps !== null ? <li>{p.commissionBps / 100}% {t('fb.commission')}</li> : null}
                </ul>
              </li>
            ))}
          </ul>
          <p className="text-sm text-[var(--muted)]">{t('fb.plansNote')}</p>
        </section>
      ) : null}
    </div>
  );
}
