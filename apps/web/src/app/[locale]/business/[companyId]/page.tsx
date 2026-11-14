import { BusinessDesk } from '../../../../components/BusinessDesk';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AnalyticsPanel, PayoutsPanel, PromoManager, type ToolsLabels } from '../../../../components/BusinessTools';
import { TeamManager } from '../../../../components/TeamManager';
import { CompanyOnboarding } from '../../../../components/CompanyOnboarding';
import { BusinessDashboard } from '../../../../components/BusinessDashboard';
import { isLocale } from '../../../../i18n/locale';
import { createT, type MessageKey } from '../../../../i18n/messages';
import { apiGet } from '../../../../lib/api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BusinessHome({ params }: { params: Promise<{ locale: string; companyId: string }> }) {
  const { locale, companyId } = await params;
  if (!isLocale(locale) || !UUID.test(companyId)) notFound();
  const t = createT(locale);
  // The rate shown for acknowledgement is the one the API will require, read from the public price list.
  const plans = await apiGet<{ plans: Array<{ code: string; commissionBps: number | null }> }>('/plans');
  const bps = plans.ok ? (plans.data.plans.find((p) => p.code === 'TRIAL')?.commissionBps ?? 1000) : 1000;
  const tools: ToolsLabels = {
    working: t('auth.working'), error: t('sec.error'), saved: t('onb.saved'), noAccess: t('tools.noAccess'),
    analytics: t('tools.analytics'), range30: t('tools.range'), bookingsByStatus: t('tools.byStatus'), seatsBooked: t('tools.seats'), bookedValue: t('tools.booked'),
    verifiedPayments: t('tools.verified'), checkedIn: t('tools.checkedIn'), reviews: t('tools.reviews'), daily: t('tools.daily'), topListings: t('tools.top'),
    basicNote: t('tools.basic'), seats: t('tools.seatsUnit'), bookings: t('tools.bookingsUnit'),
    payouts: t('tools.payouts'), owed: t('tools.owed'), held: t('tools.held'), earmarked: t('tools.earmarked'), eligible: t('tools.eligible'),
    payoutHistory: t('tools.payoutHistory'), noPayouts: t('tools.noPayouts'), payoutNote: t('tools.payoutNote'),
    promos: t('tools.promos'), promoCode: t('tools.promoCode'), promoKind: t('tools.promoKind'), promoPercent: t('tools.promoPercent'), promoFixed: t('tools.promoFixed'),
    promoValue: t('tools.promoValue'), promoMax: t('tools.promoMax'), promoCreate: t('tools.promoCreate'), promoNone: t('tools.promoNone'), promoUsed: t('tools.promoUsed'),
    promoOn: t('tools.promoOn'), promoOff: t('tools.promoOff'), promoLimit: t('tools.promoLimit'), promoNotIncluded: t('tools.promoNotIncluded'),
    statuses: { REQUESTED: t('status.REQUESTED'), DECLINED: t('status.DECLINED'), HELD: t('status.HELD'), CONFIRMED: t('status.CONFIRMED'), CANCELLED: t('status.CANCELLED'), EXPIRED: t('status.EXPIRED'), COMPLETED: t('status.COMPLETED') },
  };
  const companyOnboardingNode = (
      <CompanyOnboarding
        companyId={companyId}
        labels={{
          title: t('onb.title'), status: t('onb.status'), statuses: Object.fromEntries(['DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED'].map((k) => [k, t(`onb.status.${k}` as MessageKey)])),
          editable: '', pendingNote: t('onb.pending'), name: t('onb.name'), description: t('onb.description'), contactEmail: t('onb.contactEmail'),
          phone: t('onb.phone'), city: t('onb.city'), categories: t('onb.categories'), languages: t('onb.languages'), save: t('onb.save'),
          docs: t('onb.docs'), docKind: t('onb.docKind'), docKinds: { BUSINESS_LICENSE: t('onb.doc.BUSINESS_LICENSE'), OWNER_ID: t('onb.doc.OWNER_ID'), OTHER: t('onb.doc.OTHER') },
          upload: t('onb.upload'), docNote: t('onb.docNote'), notScanned: t('onb.notScanned'), remove: t('onb.remove'), submit: t('onb.submit'),
          submitNote: t('onb.submitNote'), saved: t('onb.saved'), error: t('onb.error'), missing: t('onb.missing'), working: t('auth.working'),
          categoryNames: Object.fromEntries(['hiking', 'tours', 'restaurants', 'museums', 'workshops', 'historical'].map((c) => [c, t(`category.${c}` as MessageKey)])),
          languageNames: { en: t('onb.lang.en'), ar: t('onb.lang.ar'), fr: t('onb.lang.fr') },
        }}
      />
  );
  const businessDashboardNode = (
      <BusinessDashboard
        locale={locale}
        companyId={companyId}
        trialCommissionPct={bps / 100}
        labels={{
          plan: t('biz.plan'), planStatus: t('biz.planStatus'), usage: t('biz.usage'), listings: t('biz.listings'), team: t('biz.team'),
          of: t('biz.of'), unlimited: t('biz.unlimited'), noSubscription: t('biz.noSubscription'), trialCommission: t('biz.trialCommission'),
          startTrial: t('biz.startTrial'), trialEnds: t('biz.trialEnds'), bookings: t('biz.bookings'), noBookings: t('biz.noBookings'),
          approve: t('biz.approve'), decline: t('biz.decline'), cancel: t('biz.cancel'), complete: t('biz.complete'),
          refund: t('biz.refund'), refundReason: t('biz.refundReason'), refundSent: t('biz.refundSent'), refundFail: t('biz.refundFail'),
          declineReason: t('biz.declineReason'), checkIn: t('biz.checkIn'), checkInCode: t('biz.checkInCode'), checkInCta: t('biz.checkInCta'),
          checkedIn: t('biz.checkedIn'), seats: t('biz.seats'), error: t('biz.error'), working: t('biz.working'),
          pickup: t('biz.pickup'), emergency: t('biz.emergency'), deposit: t('biz.deposit'), depositRequired: t('biz.depositRequired'), depositReceived: t('biz.depositReceived'),
          depositMethod: t('biz.depositMethod'), depositAmount: t('biz.depositAmount'), depositReference: t('biz.depositReference'), depositRecord: t('biz.depositRecord'), depositMet: t('biz.depositMet'),
          statuses: {
            REQUESTED: t('status.REQUESTED'), DECLINED: t('status.DECLINED'), HELD: t('status.HELD'), CONFIRMED: t('status.CONFIRMED'),
            CANCELLED: t('status.CANCELLED'), EXPIRED: t('status.EXPIRED'), COMPLETED: t('status.COMPLETED'),
            TRIALING: t('biz.statusTrialing'), ACTIVE: t('biz.statusActive'), PAST_DUE: t('biz.statusPastDue'), SUSPENDED: t('biz.statusSuspended'),
          },
        }}
      />
  );
  const analyticsPanelNode = (
      <AnalyticsPanel companyId={companyId} labels={tools} />
  );
  const payoutsPanelNode = (
      <PayoutsPanel companyId={companyId} labels={tools} />
  );
  const promoManagerNode = (
      <PromoManager companyId={companyId} labels={tools} />
  );
  const teamManagerNode = (
      <TeamManager
        companyId={companyId}
        labels={{
          title: t('team.title'), invite: t('team.invite'), email: t('team.email'), role: t('team.role'), send: t('team.send'), remove: t('team.remove'), change: t('team.change'),
          roles: { OWNER: t('team.role.OWNER'), MANAGER: t('team.role.MANAGER'), BOOKING_STAFF: t('team.role.BOOKING_STAFF'), FINANCE: t('team.role.FINANCE') },
          invited: t('team.invited'), error: t('team.error'), limit: t('team.limit'), stepUp: t('team.stepUp'), password: t('sec.password'), code: t('auth.code'),
          confirm: t('team.confirm'), inviteNote: t('team.inviteNote'),
        }}
      />
  );
  const listingsNode = (
    <div className="space-y-3">
      <p className="text-[var(--muted)]">{t('bdesk.listingsNote')}</p>
      <Link href={`/${locale}/business/${companyId}/listings`} className="inline-flex min-h-12 items-center rounded-full bg-[var(--brand)] px-6 font-semibold text-[var(--on-brand)]">
        {t('lst.link')}
      </Link>
    </div>
  );
  const d = (k: string, accent: string) => ({ kicker: t(`bdesk.${k}.kicker` as MessageKey), title: t(`bdesk.${k}.title` as MessageKey), subtitle: t(`bdesk.${k}.sub` as MessageKey), accent });

  return (
    <BusinessDesk
      companyId={companyId}
      noRole={t('bdesk.noRole')}
      working={t('auth.working')}
      desks={{ OWNER: d('owner', '#d9722b'), MANAGER: d('manager', '#8e4fb8'), BOOKING_STAFF: d('staff', '#1c8f82'), FINANCE: d('finance', '#2c8f6a') }}
      tabLabels={{ bookings: t('bdesk.tab.bookings'), listings: t('bdesk.tab.listings'), money: t('bdesk.tab.money'), insights: t('bdesk.tab.insights'), team: t('bdesk.tab.team'), profile: t('bdesk.tab.profile') }}
      slots={{
        bookings: businessDashboardNode,
        listings: listingsNode,
        money: <>{analyticsPanelNode}{payoutsPanelNode}</>,
        insights: <>{analyticsPanelNode}{promoManagerNode}</>,
        team: teamManagerNode,
        profile: companyOnboardingNode,
      }}
    />
  );
}
