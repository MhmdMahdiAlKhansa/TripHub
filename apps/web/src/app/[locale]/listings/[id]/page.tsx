import { EmptyState } from '@triphub/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExperienceCard } from '../../../../components/ExperienceCard';
import { Gallery } from '../../../../components/Gallery';
import { ListingsMap } from '../../../../components/ListingsMap';
import { mapConfig } from '../../../../lib/map';
import { BookingWidget } from '../../../../components/BookingWidget';
import { Parallax } from '../../../../components/Parallax';
import { Reveal } from '../../../../components/Reveal';
import { isLocale } from '../../../../i18n/locale';
import { createT, type MessageKey } from '../../../../i18n/messages';
import { apiGet, formatMoney, getFx, imgSrcSet, lbpEstimate, type PublicListing, type Rate, type ReviewSummary, type Slot } from '../../../../lib/api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<Metadata> {
  const { locale, id } = await params;
  if (!isLocale(locale) || !UUID.test(id)) return {};
  const r = await apiGet<{ listing: PublicListing }>(`/public/listings/${id}?locale=${locale}`);
  if (!r.ok) return {};
  const l = r.data.listing;
  const desc = (l.summary ?? l.description ?? '').slice(0, 160);
  return {
    title: l.title ?? undefined,
    description: desc || undefined,
    alternates: { languages: { en: `/en/listings/${id}`, ar: `/ar/listings/${id}` } },
    openGraph: { title: l.title ?? undefined, description: desc || undefined, images: l.images[0] ? [l.images[0].url] : undefined },
  };
}

export default async function ListingPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale) || !UUID.test(id)) notFound();
  const t = createT(locale);

  const listingRes = await apiGet<{ listing: PublicListing }>(`/public/listings/${id}?locale=${locale}`);
  if (!listingRes.ok && listingRes.status === 404) notFound();
  if (!listingRes.ok) {
    return <EmptyState title={t('explore.loadFailedTitle')} body={t('listing.loadFailed')} />;
  }
  const l = listingRes.data.listing;

  const [avail, reviews, nearby, fx] = await Promise.all([
    l.bookable ? apiGet<{ rates: Rate[]; slots: Slot[] }>(`/public/listings/${id}/availability`) : Promise.resolve(null),
    apiGet<ReviewSummary>(`/public/listings/${id}/reviews`),
    apiGet<{ listings: PublicListing[] }>(`/public/listings/${id}/nearby?locale=${locale}`),
    getFx(),
  ]);
  const dateFmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Beirut' });
  const cheapest = avail?.ok ? [...avail.data.rates].sort((a, b) => Number(a.amountMinor) - Number(b.amountMinor))[0] : undefined;
  const rated = reviews.ok && reviews.data.summary.count > 0 ? reviews.data.summary : null;
  const cover = l.images[0];
  const map = mapConfig();

  // Structured data comes only from this listing's real data (no price, rating or availability is invented).
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    name: l.title,
    description: l.summary ?? l.description ?? undefined,
    image: l.images.map((i) => i.url),
    address: l.city ? { '@type': 'PostalAddress', addressLocality: l.city, addressCountry: 'LB' } : undefined,
    aggregateRating: rated && rated.average !== null ? { '@type': 'AggregateRating', ratingValue: rated.average, reviewCount: rated.count } : undefined,
    offers: cheapest ? { '@type': 'Offer', price: (Number(cheapest.amountMinor) / 100).toFixed(2), priceCurrency: cheapest.currency } : undefined,
  };

  return (
    <article className="space-y-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      {/* ---------------------------------------------------------------- cinematic header */}
      <header className="full-bleed relative -mt-24 flex min-h-[46svh] items-end overflow-hidden text-[#f7f8f3]">
        {cover ? (
          <Parallax speed={0.1} maxTravel={30} className="absolute inset-x-0 -top-8 -bottom-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${cover.url}?w=1280`} srcSet={imgSrcSet(cover.url)} sizes="100vw" alt={cover.alt ?? ''} fetchPriority="high" className="h-full w-full object-cover" />
          </Parallax>
        ) : (
          <div aria-hidden="true" className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #0a4a9a 0%, #0a6fd8 55%, #1fa3b8 130%)' }} />
        )}
        <div aria-hidden="true" className="hero-scrim absolute inset-0" />
        <div className="relative z-10 mx-auto w-full max-w-6xl space-y-3 px-4 pb-10 pt-24">
          <Link href={`/${locale}/explore`} className="inline-flex min-h-11 items-center text-sm font-semibold underline">
            ← {t('listing.back')}
          </Link>
          <p className="text-sm font-semibold text-[#e6ece5]">
            {t(`category.${l.category}` as MessageKey)}
            {l.city ? ` · ${l.city}` : ''}
          </p>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">{l.title}</h1>
          <p className="flex flex-wrap items-center gap-3 text-[#e6ece5]">
            {l.company ? <span>{l.company.name}</span> : null}
            {l.company?.verified ? <span className="rounded-full bg-[#f7f8f3] px-3 py-1 text-xs font-semibold text-[#263c36]">{t('listing.verifiedBusiness')}</span> : null}
            {rated && rated.average !== null ? <span aria-label={`${rated.average}/5`}>★ {rated.average} ({rated.count})</span> : null}
          </p>
        </div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[1fr_24rem]">
        {/* ---------------------------------------------------------------- story */}
        <div className="space-y-10">
          {l.images.length > 0 ? (
            <Reveal>
              <Gallery
                images={l.images}
                ariaLabel={t('listing.gallery')}
                labels={{ open: t('gallery.open'), close: t('gallery.close'), previous: t('gallery.previous'), next: t('gallery.next'), of: t('gallery.of') }}
              />
            </Reveal>
          ) : null}

          {l.description ? (
            <Reveal>
              <p className="max-w-3xl whitespace-pre-line text-lg leading-relaxed">{l.description}</p>
            </Reveal>
          ) : null}

          {l.meetingPoint ? (
            <Reveal>
              <p>
                <span className="font-semibold">{t('listing.meetingPoint')}: </span>
                {l.meetingPoint}
              </p>
            </Reveal>
          ) : null}

          {map && l.latitude !== null && l.longitude !== null ? (
            <section aria-labelledby="where" className="space-y-3">
              <h2 id="where" className="text-2xl font-semibold">{t('map.listing')}</h2>
              <ListingsMap single points={[{ id: l.id, lat: l.latitude, lng: l.longitude, title: l.title ?? '', href: `/${locale}/listings/${l.id}` }]} style={map.style} label={t('map.listing')} openLabel={t('map.open')} />
            </section>
          ) : null}

          {l.bookable ? (
            <Reveal as="section" className="space-y-1">
              <h2 className="text-2xl font-semibold">{t('cancel.title')}</h2>
              <p>{t(`cancel.${l.cancellationPolicy}` as MessageKey)}</p>
              <p className="text-sm text-[var(--muted)]">{t('cancel.business')}</p>
            </Reveal>
          ) : null}

          <section aria-labelledby="reviews" className="space-y-3">
            <Reveal>
              <h2 id="reviews" className="text-2xl font-semibold">
                {t('listing.reviews')}
                {rated && rated.average !== null ? ` · ${rated.average} (${rated.count})` : ''}
              </h2>
            </Reveal>
            {reviews.ok && reviews.data.reviews.length > 0 ? (
              <ul className="space-y-3">
                {reviews.data.reviews.map((r) => (
                  <li key={r.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <p className="font-semibold">
                      {'★'.repeat(r.rating)}
                      <span className="sr-only"> {r.rating}/5</span>
                      <span className="ms-2 text-xs font-normal text-[var(--muted)]">{t('listing.verifiedBooking')}</span>
                    </p>
                    {r.comment ? <p className="mt-1">{r.comment}</p> : null}
                    <p className="mt-1 text-sm text-[var(--muted)]">{r.author}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[var(--muted)]">{t('listing.noReviews')}</p>
            )}
          </section>
        </div>

        {/* ---------------------------------------------------------------- booking card */}
        <aside aria-label={t('listing.bookingCard')} className="lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-lg">
            {cheapest ? (
              <p className="text-2xl font-bold">
                {cheapest.amountMinor === '0' ? (
                  t('listing.free')
                ) : (
                  <>
                    <span className="text-sm font-medium text-[var(--muted)]">{t('listing.fromPrice')} </span>
                    {formatMoney(cheapest.amountMinor, cheapest.currency, locale)}
                    {fx && cheapest.currency === 'USD' ? <span className="block text-sm font-normal text-[var(--muted)]">{lbpEstimate(cheapest.amountMinor, fx, locale)} ({t('fx.estimate')}) · {t('fx.note')}</span> : null}
                  </>
                )}
              </p>
            ) : null}
            {!l.bookable ? (
              <p className="text-[var(--muted)]">{t('listing.discoveryOnly')}</p>
            ) : !avail?.ok ? (
              <p className="text-[var(--muted)]">{t('listing.loadFailed')}</p>
            ) : avail.data.slots.length === 0 ? (
              <p className="text-[var(--muted)]">{t('listing.noDates')}</p>
            ) : (
              <BookingWidget
                locale={locale}
                listingId={id}
                slots={avail.data.slots}
                rates={avail.data.rates}
                pickupPoints={l.pickupPoints ?? []}
                dateLabels={avail.data.slots.map((s) => `${dateFmt.format(new Date(s.startsAt))} · ${s.remaining} ${t('listing.seatsLeft')}`)}
                labels={{
                  title: t('book.title'), date: t('book.date'), tickets: t('book.tickets'), total: t('book.total'),
                  cta: l.bookingMode === 'REQUEST_TO_BOOK' ? t('book.requestCta') : t('book.cta'),
                  working: t('book.working'), needSignIn: t('book.needSignIn'), signIn: t('auth.loginCta'), pickSeats: t('book.pickSeats'),
                  reference: t('book.reference'), viewBookings: t('book.viewBookings'), free: t('listing.free'),
                  kinds: { ADULT: t('book.kind.ADULT'), CHILD: t('book.kind.CHILD'), GROUP: t('book.kind.GROUP') },
                  errors: {
                    not_enough_capacity: t('book.err.not_enough_capacity'), waitlist_active: t('book.err.waitlist_active'),
                    business_not_accepting_bookings: t('book.err.business_not_accepting_bookings'), slot_unavailable: t('book.err.slot_unavailable'),
                    payments_not_available_yet: t('book.err.payments_not_available_yet'), booking_mode_not_supported_yet: t('book.err.booking_mode_not_supported_yet'),
                    generic: t('book.err.generic'),
                  },
                  waitlistJoin: t('wl.join'), waitlistHint: t('wl.joinHint'), waitlistJoined: t('wl.joined'),
                  pickup: t('book.pickup'), emergencyName: t('book.emergencyName'), emergencyPhone: t('book.emergencyPhone'), depositHeld: t('book.depositHeld'),
                  results: { CONFIRMED: t('book.result.CONFIRMED'), HELD: t('book.result.HELD'), REQUESTED: t('book.result.REQUESTED') },
                }}
              />
            )}
          </div>
        </aside>
      </div>
      {nearby.ok && nearby.data.listings.length > 0 ? (
        <section aria-labelledby="nearby" className="space-y-4">
          <Reveal>
            <h2 id="nearby" className="text-2xl font-semibold">{t('listing.nearby')}</h2>
          </Reveal>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {nearby.data.listings.map((n) => (
              <li key={n.id}>
                <ExperienceCard listing={n} locale={locale} t={t} fx={fx} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
