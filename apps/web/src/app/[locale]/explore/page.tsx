import { PageHero } from '../../../components/PageHero';
import { CATEGORIES, REGION_SLUGS } from '@triphub/shared';
import { EmptyState } from '@triphub/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExperienceCard } from '../../../components/ExperienceCard';
import { Reveal } from '../../../components/Reveal';
import { SearchBar } from '../../../components/SearchBar';
import { isLocale } from '../../../i18n/locale';
import { createT, type MessageKey } from '../../../i18n/messages';
import { ListingsMap } from '../../../components/ListingsMap';
import { mapConfig } from '../../../lib/map';
import { apiGet, formatMoney, getFx, type PublicListing } from '../../../lib/api';

type Sp = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim();

export default async function Explore({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Sp> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createT(locale);
  const sp = await searchParams;

  // Only known, validated values are forwarded to the API.
  const q = one(sp.q)?.slice(0, 120);
  const category = (CATEGORIES as readonly string[]).includes(one(sp.category) ?? '') ? one(sp.category) : undefined;
  const region = (REGION_SLUGS as readonly string[]).includes(one(sp.region) ?? '') ? one(sp.region) : undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.date) ?? '') ? one(sp.date) : undefined;
  const guests = /^\d{1,2}$/.test(one(sp.guests) ?? '') && Number(one(sp.guests)) >= 1 && Number(one(sp.guests)) <= 20 ? one(sp.guests) : undefined;
  const maxPrice = /^\d{1,6}$/.test(one(sp.maxPrice) ?? '') ? one(sp.maxPrice) : undefined;
  const mode = one(sp.mode) === 'bookable' || one(sp.mode) === 'discovery' ? one(sp.mode) : undefined;

  const qs = new URLSearchParams({ locale, limit: '24' });
  if (q) qs.set('q', q);
  if (category) qs.set('category', category);
  if (region) qs.set('region', region);
  if (date) qs.set('date', date);
  if (guests) qs.set('guests', guests);
  if (maxPrice) qs.set('maxPriceMinor', String(Number(maxPrice) * 100));
  if (mode) qs.set('mode', mode);
  const [res, fx] = await Promise.all([apiGet<{ listings: PublicListing[] }>(`/public/listings?${qs}`), getFx()]);

  const map = mapConfig();
  const points = res.ok
    ? res.data.listings.filter((l) => l.latitude !== null && l.longitude !== null).map((l) => ({
        id: l.id, lat: l.latitude as number, lng: l.longitude as number, title: l.title ?? '', href: `/${locale}/listings/${l.id}`,
        price: l.bookable && l.fromPrice ? (l.fromPrice.amountMinor === '0' ? t('card.free') : formatMoney(l.fromPrice.amountMinor, l.fromPrice.currency, locale)) : undefined,
      }))
    : [];
  const hasFilters = Boolean(q || category || region || date || guests || maxPrice || mode);
  const select = 'mt-1 block min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3';

  return (
    <div className="space-y-8">
      <header className="space-y-5">
        <PageHero title={t('explore.title')} />
        <SearchBar
          locale={locale}
          tone="light"
          defaults={{ q, date, guests, extra: { ...(category ? { category } : {}), ...(region ? { region } : {}), ...(maxPrice ? { maxPrice } : {}), ...(mode ? { mode } : {}) } }}
          labels={{ where: t('search.where'), wherePlaceholder: t('search.wherePlaceholder'), dates: t('search.dates'), guests: t('search.guests'), guestUnit: t('search.guestUnit'), search: t('search.go') }}
        />
      </header>

      <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        <form action={`/${locale}/explore`} method="get" aria-label={t('explore.filters')} className="space-y-4 self-start rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-lg font-semibold">{t('explore.filters')}</h2>
          {q ? <input type="hidden" name="q" value={q} /> : null}
          {date ? <input type="hidden" name="date" value={date} /> : null}
          {guests ? <input type="hidden" name="guests" value={guests} /> : null}
          <label className="block text-sm font-medium">
            {t('explore.category')}
            <select name="category" defaultValue={category ?? ''} className={select}>
              <option value="">{t('explore.allCategories')}</option>
              {CATEGORIES.map((c) => (<option key={c} value={c}>{t(`category.${c}` as MessageKey)}</option>))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            {t('explore.region')}
            <select name="region" defaultValue={region ?? ''} className={select}>
              <option value="">{t('explore.allRegions')}</option>
              {REGION_SLUGS.map((r) => (<option key={r} value={r}>{t(`region.${r}` as MessageKey)}</option>))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            {t('explore.type')}
            <select name="mode" defaultValue={mode ?? ''} className={select}>
              <option value="">{t('explore.typeAll')}</option>
              <option value="bookable">{t('explore.typeBookable')}</option>
              <option value="discovery">{t('explore.typeInfo')}</option>
            </select>
          </label>
          <label className="block text-sm font-medium">
            {t('explore.maxPrice')}
            <input name="maxPrice" type="number" min={0} max={100000} inputMode="numeric" defaultValue={maxPrice ?? ''} className={select} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="min-h-11 rounded-full bg-[var(--brand)] px-5 font-semibold text-[var(--on-brand)]">{t('explore.apply')}</button>
            {hasFilters ? (
              <Link href={`/${locale}/explore`} className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-[var(--brand)] underline">{t('explore.clear')}</Link>
            ) : null}
          </div>
        </form>

        <section aria-live="polite" className="space-y-4">
          {!res.ok ? (
            <EmptyState title={t('explore.loadFailedTitle')} body={t('explore.loadFailedBody')} />
          ) : res.data.listings.length === 0 ? (
            hasFilters ? (
              <EmptyState title={t('explore.noMatchTitle')} body={t('explore.noMatchBody')} />
            ) : (
              <EmptyState title={t('explore.emptyTitle')} body={t('explore.emptyBody')} />
            )
          ) : (
            <>
              <p className="text-[var(--muted)]">
                {res.data.listings.length} {res.data.listings.length === 1 ? t('explore.countOne') : t('explore.count')}
              </p>
              {map && points.length > 0 ? <ListingsMap points={points} style={map.style} label={t('map.explore')} openLabel={t('map.open')} /> : null}
              <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {res.data.listings.map((l, i) => (
                  <li key={l.id}>
                    <Reveal delay={Math.min(i, 5) * 60} className="h-full">
                      <ExperienceCard listing={l} locale={locale} t={t} fx={fx} />
                    </Reveal>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
