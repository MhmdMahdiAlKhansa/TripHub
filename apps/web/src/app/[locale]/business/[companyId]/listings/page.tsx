import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ListingsWorkspace } from '../../../../../components/ListingsWorkspace';
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
      <ListingsWorkspace
        locale={locale}
        companyId={companyId}
        hostTitle={t('prop.title')}
        tripTitle={t('lst.title')}
        working={t('auth.working')}
        propertyLabels={propertyLabels(t)}
        listingLabels={{
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

const AMENITIES = ['wifi', 'parking', 'heating', 'fireplace', 'air_conditioning', 'kitchen', 'bbq', 'garden', 'pool', 'mountain_view', 'sea_view', 'hot_water_24h', 'generator', 'pets_allowed', 'breakfast', 'hiking_trail_access'] as const;
const TYPES = ['chalet', 'guesthouse', 'cabin', 'villa', 'apartment', 'room', 'campsite'] as const;
const PROP_ERRORS = [...ERRORS, 'night_rate_required', 'stay_rates_only', 'dates_unavailable', 'check_in_in_past', 'check_out_before_check_in', 'hosts_list_stays_only'] as const;

function propertyLabels(t: ReturnType<typeof createT>) {
  const k = (key: string) => t(key as MessageKey);
  return {
    newProperty: k('prop.new'), create: k('prop.create'), working: k('auth.working'), none: k('prop.none'), saved: k('lst.saved'), created: k('prop.created'), error: k('lst.error'), missing: k('lst.missing'),
    title: k('prop.name'), description: k('prop.description'), titleAr: k('prop.nameAr'), descriptionAr: k('prop.descriptionAr'), type: k('prop.type'),
    types: Object.fromEntries(TYPES.map((x) => [x, k(`stay.type.${x}`)])), city: k('lst.city'), where: k('prop.where'), whereHint: k('prop.whereHint'),
    maxGuests: k('prop.maxGuests'), bedrooms: k('prop.bedrooms'), beds: k('prop.beds'), bathrooms: k('prop.bathrooms'), amenities: k('stay.amenities'),
    amenityNames: Object.fromEntries(AMENITIES.map((x) => [x, k(`amenity.${x}`)])), checkInTime: k('prop.checkInTime'), checkOutTime: k('prop.checkOutTime'),
    minNights: k('prop.minNights'), houseRules: k('stay.houseRules'), depositPercent: k('lst.depositPercent'), policy: k('lst.policy'),
    policies: Object.fromEntries(POLICIES.map((p) => [p, k(`cancel.${p}`)])), publish: k('lst.publish'), pause: k('lst.pause'), archive: k('lst.archive'),
    archiveConfirm: k('lst.archiveConfirm'), publishedNote: k('lst.publishedNote'), edit: k('lst.edit'), saveEdit: k('lst.saveEdit'),
    statuses: Object.fromEntries(STATUSES.map((s) => [s, k(`lst.status.${s}`)])), prices: k('prop.prices'), night: k('prop.night'), weekendNight: k('prop.weekendNight'),
    cleaning: k('stay.cleaning'), currency: k('lst.currency'), savePrices: k('lst.saveRates'), pricesNote: k('prop.pricesNote'), calendar: k('prop.calendar'),
    calendarEmpty: k('prop.calendarEmpty'), stay: k('prop.stay'), blocked: k('prop.blocked'), guests: k('stay.guests'), nights: k('stay.nights'), block: k('prop.block'),
    blockFrom: k('prop.blockFrom'), blockTo: k('prop.blockTo'), blockNote: k('prop.blockNote'), unblock: k('prop.unblock'), photos: k('lst.photos'), addPhoto: k('lst.addPhoto'),
    photoAlt: k('lst.photoAlt'), removePhoto: k('lst.removePhoto'), photoNote: k('lst.photoNote'), checklist: k('lst.checklist'), checkVerified: k('lst.checkVerified'),
    checkPlan: k('lst.checkPlan'), checkPrice: k('prop.checkPrice'), checkPhoto: k('lst.checkPhoto'), openProfile: k('lst.openProfile'),
    missingNames: { ...Object.fromEntries(MISSING.map((m) => [m, k(`lst.missing.${m}`)])), meetingPoint: k('prop.where'), rates: k('prop.night') },
    errors: Object.fromEntries(PROP_ERRORS.map((e) => [e, k(`lst.err.${e}`)])),
    bookingStatuses: Object.fromEntries(['HELD', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED'].map((s) => [s, k(`status.${s}`)])),
  };
}
