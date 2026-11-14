import { notFound } from 'next/navigation';
import { AdminQueue, type QueueConfig, type QueueLabels } from '../../../components/AdminQueue';
import { AdminConsole } from '../../../components/AdminConsole';
import { EmailHealthPanel, FeaturedPanel, type StaffPanelLabels } from '../../../components/StaffPanels';
import { isLocale } from '../../../i18n/locale';
import { createT, type MessageKey } from '../../../i18n/messages';

export default async function Admin({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createT(locale);
  const qLabels: QueueLabels = {
    reasonLabel: t('q.reason'), referenceLabel: t('q.reference'), methodLabel: t('q.method'), submit: t('q.submit'), error: t('sec.error'),
    stepUpTitle: t('adm.stepUp'), password: t('sec.password'), code: t('auth.code'), stepUpCta: t('adm.stepUpCta'), working: t('auth.working'),
  };
  const queues: QueueConfig[] = [
    {
      title: t('q.refunds'), empty: t('q.refunds.empty'), listUrl: '/api/v1/admin/refunds?status=REQUESTED', rowsKey: 'refunds',
      fields: [{ label: t('q.f.booking'), path: 'bookingReference' }, { label: t('q.f.amount'), path: 'amountMinor' }, { label: t('q.f.currency'), path: 'currency' }, { label: t('q.f.reason'), path: 'reason' }],
      actions: [{ label: t('q.approve'), path: '/api/v1/admin/refunds/{id}/approve' }, { label: t('q.reject'), path: '/api/v1/admin/refunds/{id}/reject', input: 'reason' }],
    },
    {
      title: `${t('q.refunds')} (${t('q.f.status')}: APPROVED)`, empty: t('q.refunds.empty'), listUrl: '/api/v1/admin/refunds?status=APPROVED', rowsKey: 'refunds',
      fields: [{ label: t('q.f.booking'), path: 'bookingReference' }, { label: t('q.f.amount'), path: 'amountMinor' }, { label: t('q.f.currency'), path: 'currency' }, { label: t('q.f.state'), path: 'state' }],
      actions: [{ label: t('q.paid'), path: '/api/v1/admin/refunds/{id}/paid', input: 'reference' }],
    },
    {
      title: t('q.payouts'), empty: t('q.payouts.empty'), listUrl: '/api/v1/admin/payouts?status=REQUESTED', rowsKey: 'payouts',
      fields: [{ label: t('q.f.company'), path: 'company.name' }, { label: t('q.f.amount'), path: 'amountMinor' }, { label: t('q.f.currency'), path: 'currency' }, { label: t('q.f.note'), path: 'note' }],
      actions: [{ label: t('q.approve'), path: '/api/v1/admin/payouts/{id}/approve' }, { label: t('q.reject'), path: '/api/v1/admin/payouts/{id}/reject', input: 'reason' }],
    },
    {
      title: `${t('q.payouts')} (${t('q.f.status')}: APPROVED)`, empty: t('q.payouts.empty'), listUrl: '/api/v1/admin/payouts?status=APPROVED', rowsKey: 'payouts',
      fields: [{ label: t('q.f.company'), path: 'company.name' }, { label: t('q.f.amount'), path: 'amountMinor' }, { label: t('q.f.currency'), path: 'currency' }, { label: t('q.f.state'), path: 'state' }],
      actions: [{ label: t('q.paid'), path: '/api/v1/admin/payouts/{id}/paid', input: 'reference' }],
    },
    {
      title: t('q.subs'), empty: t('q.subs.empty'), listUrl: '/api/v1/admin/subscription-requests', rowsKey: 'requests',
      fields: [{ label: t('q.f.company'), path: 'company.name' }, { label: t('q.f.plan'), path: 'plan' }, { label: t('q.f.cycle'), path: 'cycle' }],
      actions: [{ label: t('q.fulfil'), path: '/api/v1/admin/subscription-requests/{id}/fulfil', input: 'method-reference' }],
    },
    {
      title: t('q.reviews'), empty: t('q.reviews.empty'), listUrl: '/api/v1/admin/reviews?status=VISIBLE', rowsKey: 'reviews',
      fields: [{ label: t('q.f.rating'), path: 'rating' }, { label: t('q.f.comment'), path: 'comment' }],
      actions: [{ label: t('q.hide'), path: '/api/v1/admin/reviews/{id}/moderate', input: 'reason', extra: { status: 'HIDDEN' } }],
    },
  ];
  const q = (i: number) => <AdminQueue key={queues[i]!.title} config={queues[i]!} labels={qLabels} />;
  const panel: StaffPanelLabels = {
    working: t('auth.working'), error: t('sec.error'),
    emailTitle: t('desk.email.title'), emailNote: t('desk.email.note'), emailSent: t('desk.email.sent'), emailQueued: t('desk.email.queued'), emailFailed: t('desk.email.failed'),
    emailNoFailed: t('desk.email.nofailed'), emailTemplate: '', emailTo: '', emailAttempts: t('desk.email.attempts'), emailReason: t('desk.email.reason'),
    featTitle: t('desk.feat.title'), featNote: t('desk.feat.note'), featOn: t('desk.feat.on'), featOff: t('desk.feat.off'), featAdd: t('desk.feat.add'), featRemove: t('desk.feat.remove'),
  };
  const desk = (k: string, accent: string) => ({ kicker: t(`desk.${k}.kicker` as MessageKey), title: t(`desk.${k}.title` as MessageKey), subtitle: t(`desk.${k}.sub` as MessageKey), accent });
  return (
    <AdminConsole
      locale={locale}
      labels={{
          signIn: t('sec.signIn'), loginCta: t('auth.loginCta'), working: t('auth.working'), notStaff: t('adm.notStaff'), error: t('sec.error'),
          companies: t('adm.companies'), noCompanies: t('adm.noCompanies'), documents: t('adm.documents'), noDocuments: t('adm.noDocuments'),
          notScanned: t('adm.notScanned'), download: t('adm.download'), approve: t('adm.approve'), changes: t('adm.changes'), reject: t('adm.reject'),
          reasonLabel: t('adm.reason'), submit: t('adm.submit'), payments: t('adm.payments'), noPayments: t('adm.noPayments'), verify: t('adm.verify'),
          rejectPay: t('adm.rejectPay'), unverifiedNote: t('adm.unverifiedNote'), reference: t('adm.reference'),
          stepUpTitle: t('adm.stepUp'), password: t('sec.password'), code: t('auth.code'), stepUpCta: t('adm.stepUpCta'),
        }}
      desks={{ VERIFIER: desk('verifier', '#6a4fd8'), SUPPORT: desk('support', '#1fa3b8'), FINANCE: desk('finance', '#2c8f6a'), ADMIN: desk('admin', '#0a6fd8') }}
      tabLabels={{ companies: t('desk.tab.companies'), payments: t('desk.tab.payments'), refunds: t('desk.tab.refunds'), payouts: t('desk.tab.payouts'), subs: t('desk.tab.subs'), reviews: t('desk.tab.reviews'), featured: t('desk.tab.featured'), email: t('desk.tab.email') }}
      slots={{
        refunds: <>{q(0)}{q(1)}</>,
        payouts: <>{q(2)}{q(3)}</>,
        subs: q(4),
        reviews: q(5),
        featured: <FeaturedPanel labels={panel} />,
        email: <EmailHealthPanel labels={panel} />,
      }}
    />
  );
}
