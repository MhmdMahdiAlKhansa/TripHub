import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ListingManager } from '../../../../../components/ListingManager';
import { isLocale } from '../../../../../i18n/locale';
import { createT, type MessageKey } from '../../../../../i18n/messages';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATS = ['hiking', 'tours', 'restaurants', 'museums', 'workshops', 'historical'] as const;
const MODES = ['DISCOVERY_ONLY', 'FIXED_DATE', 'TIME_SLOT', 'REQUEST_TO_BOOK'] as const;
const POLICIES = ['FLEXIBLE', 'MODERATE', 'STRICT', 'NON_REFUNDABLE'] as const;
const STATUSES = ['DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED'] as const;

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
        }}
      />
    </div>
  );
}
