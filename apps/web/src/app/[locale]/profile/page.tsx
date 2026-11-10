import { PageHero } from '../../../components/PageHero';
import { notFound } from 'next/navigation';
import { ProfilePanel } from '../../../components/ProfilePanel';
import { PrivacyPanel } from '../../../components/PrivacyPanel';
import { isLocale } from '../../../i18n/locale';
import { createT } from '../../../i18n/messages';

export default async function Profile({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createT(locale);
  return (
    <div className="space-y-6">
      <PageHero title={t('profile.title')} />
      <ProfilePanel
        locale={locale}
        labels={{
          notifications: { title: t('notif.title'), empty: t('notif.empty'), markAll: t('notif.markAll'), generic: t('notif.generic'), kinds: { 'waitlist.offer': t('notif.waitlist.offer'), 'booking.request_approved': t('notif.booking.request_approved'), 'booking.request_declined': t('notif.booking.request_declined'), 'booking.completed': t('notif.booking.completed'), 'booking.cancelled_by_business': t('notif.booking.cancelled_by_business'), 'payment.verified': t('notif.payment.verified'), 'payment.verified_unallocated': t('notif.payment.verified_unallocated'), 'payment.rejected': t('notif.payment.rejected'), 'refund.approved': t('notif.refund.approved'), 'refund.paid': t('notif.refund.paid'), 'refund.rejected': t('notif.refund.rejected') } },
          waitlist: {
            title: t('wl.title'), empty: t('wl.empty'), position: t('wl.position'), seats: t('wl.seats'), accept: t('wl.accept'), leave: t('wl.leave'),
            expires: t('wl.expires'), acceptNote: t('wl.acceptNote'), error: t('wl.error'),
            states: { waiting: t('wl.state.waiting'), offer_available: t('wl.state.offer_available'), offer_expired: t('wl.state.offer_expired'), booked: t('wl.state.booked'), cancelled: t('wl.state.cancelled') },
          },
          bookings: {
            title: t('mybookings.title'), empty: t('mybookings.empty'), cancel: t('mybookings.cancel'), cancelling: t('mybookings.cancelling'),
            statuses: {
              REQUESTED: t('status.REQUESTED'), DECLINED: t('status.DECLINED'), HELD: t('status.HELD'), CONFIRMED: t('status.CONFIRMED'),
              CANCELLED: t('status.CANCELLED'), EXPIRED: t('status.EXPIRED'), COMPLETED: t('status.COMPLETED'),
            },
            ticket: t('mb.ticket'), ticketCode: t('mb.ticketCode'), calendar: t('mb.calendar'), refundNow: t('mb.refundNow'), policy: t('mb.policy'),
            policies: { FLEXIBLE: t('cancel.FLEXIBLE'), MODERATE: t('cancel.MODERATE'), STRICT: t('cancel.STRICT'), NON_REFUNDABLE: t('cancel.NON_REFUNDABLE') },
            payTitle: t('mb.payTitle'), payNote: t('mb.payNote'), payMethod: t('mb.payMethod'), payReference: t('mb.payReference'), paySubmit: t('mb.paySubmit'),
            payStates: { awaiting_verification: t('mb.pay.awaiting_verification'), rejected: t('mb.pay.rejected'), verified: t('mb.pay.verified'), verified_refund_due: t('mb.pay.verified_refund_due') },
            reviewTitle: t('mb.reviewTitle'), rating: t('mb.rating'), comment: t('mb.comment'), reviewSubmit: t('mb.reviewSubmit'), reviewDone: t('mb.saved'),
            error: t('mb.error'), saved: t('mb.saved'),
          },
          emptyTitle: t('profile.emptyTitle'), emptyBody: t('profile.emptyBody'), signIn: t('auth.loginCta'),
          signedInAs: t('auth.signedInAs'), logout: t('auth.logout'), working: t('auth.working'), businessLink: t('biz.profileLink'), securityLink: t('sec.link'), staffLink: t('adm.link'),
        }}
      />
      <PrivacyPanel
        labels={{
          title: t('privacy.title'), exportBody: t('privacy.exportBody'), exportBtn: t('privacy.exportBtn'), deleteTitle: t('privacy.deleteTitle'), deleteBody: t('privacy.deleteBody'), deleteBtn: t('privacy.deleteBtn'),
          password: t('privacy.password'), confirmLabel: t('privacy.confirmLabel'), confirmWord: 'DELETE', working: t('auth.working'),
          errors: { open_bookings: t('privacy.err.open_bookings'), sole_owner: t('privacy.err.sole_owner'), open_offer: t('privacy.err.open_offer'), staff_account: t('privacy.err.staff_account'), recent_login_required: t('privacy.err.recent_login_required'), invalid: t('privacy.err.invalid'), generic: t('privacy.err.generic') },
        }}
      />
    </div>
  );
}
