import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ListingManager } from '../../../../../components/ListingManager';
import { isLocale } from '../../../../../i18n/locale';
import { createT, type MessageKey } from '../../../../../i18n/messages';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATS = ['hiking', 'tours', 'restaurants', 'museums', 'workshops', 'historical'] as const;
const MODES = ['DISCOVERY_ONLY', 'FIXED_DATE', 'TIME_SLOT', 'REQUEST_TO_BOOK'] as const;
const POLICIES = ['FLEXIBLE', 'MODERATE', 'STRICT', 'NON_REFUNDABLE'] as const;
const STATUSES = ['DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED', 'CLOSED'] as const;
const ERRORS = ["network", "validation_error", "company_not_verified", "subscription_required", "plan_limit_reached", "invalid_transition", "listing_archived", "listing_changed_concurrently", "cannot_change_booking_mode_while_published", "invalid_attributes", "booking_mode_not_supported_yet", "slot_in_past", "slot_exists", "capacity_below_reserved", "too_many_images", "file_too_large", "unsupported_image_type", "invalid_image", "price_needed", "no_file", "forbidden"] as const;
const MISSING = ["translation", "city", "meetingPoint", "rates"] as const;

export default async function Listings({ params }: { params: Promise<{ locale: string; companyId: string }> }) {
  const { locale, companyId } = await params;
  if (!isLocale(locale) || !UUID.test(companyId)) notFound();
  const t = createT(locale);
  return (
    <div className="space-y-6">
      <Link href={`/${locale}/business/${companyId}`} className="text-sm text-[var(--brand)] underline">
        {t('biz.title')}
      </Link>
      <h1 className="text-3xl font-bold">{t('lst.title')}</h1>
      <ListingManager
        locale={locale}
        companyId={companyId}
        labels={{
          newListing: t('lst.new'), category: t('lst.category'), mode: t('lst.mode'), city: t('lst.city'), meeting: t('lst.meeting'), pickups: t('lst.pickups'), depositPercent: t('lst.depositPercent'),
          titleEn: t('lst.titleEn'), descEn: t('lst.descEn'), titleAr: t('lst.titleAr'), descAr: t('lst.descAr'), create: t('lst.create'),
          none: t('lst.none'), publish: t('lst.publish'), pause: t('lst.pause'), rates: t('lst.rates'), adult: t('lst.adult'), child: t('lst.child'),
          saveRates: t('lst.saveRates'), freeNote: t('lst.freeNote'), addSlot: t('lst.addSlot'), when: t('lst.when'), capacity: t('lst.capacity'),
          addSlotCta: t('lst.addSlotCta'), error: t('lst.error'), missing: t('lst.missing'), saved: t('lst.saved'), working: t('auth.working'),
          policy: t('lst.policy'),
          lat: t('lst.lat'), lng: t('lst.lng'), coordsNote: t('lst.coordsNote'),
          edit: t('lst.edit'), saveEdit: t('lst.saveEdit'), photos: t('lst.photos'), addPhoto: t('lst.addPhoto'), photoAlt: t('lst.photoAlt'), removePhoto: t('lst.removePhoto'), photoNote: t('lst.photoNote'),
          policies: Object.fromEntries(POLICIES.map((p) => [p, t(`cancel.${p}` as MessageKey)])),
          categories: Object.fromEntries(CATS.map((c) => [c, t(`category.${c}` as MessageKey)])),
          modes: Object.fromEntries(MODES.map((m) => [m, t(`lst.mode.${m}` as MessageKey)])),
          statuses: Object.fromEntries(STATUSES.map((s) => [s, t(`lst.status.${s}` as MessageKey)])),
          currency: t('lst.currency'), dates: t('lst.dates'), noDates: t('lst.noDates'), seatsTaken: t('lst.seatsTaken'), closeDate: t('lst.closeDate'), reopenDate: t('lst.reopenDate'),
          archive: t('lst.archive'), archiveConfirm: t('lst.archiveConfirm'), checklist: t('lst.checklist'), checkVerified: t('lst.checkVerified'), checkPrice: t('lst.checkPrice'),
          checkDate: t('lst.checkDate'), checkPhoto: t('lst.checkPhoto'), checkPlan: t('lst.checkPlan'), openProfile: t('lst.openProfile'), publishedNote: t('lst.publishedNote'),
          created: t('lst.created'), businessPage: t('biz.title'),
          missingNames: Object.fromEntries(MISSING.map((m) => [m, t(`lst.missing.${m}` as MessageKey)])),
          errors: Object.fromEntries(ERRORS.map((e) => [e, t(`lst.err.${e}` as MessageKey)])),
        }}
      />
    </div>
  );
}
