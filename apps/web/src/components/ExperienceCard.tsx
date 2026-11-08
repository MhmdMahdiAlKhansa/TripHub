import Link from 'next/link';
import type { T } from '../i18n/messages';
import type { MessageKey } from '../i18n/messages';
import { CoverImage } from './CoverImage';
import { formatMoney, imgSrcSet, lbpEstimate, type PublicListing } from '../lib/api';

/** Editorial experience card. Everything shown comes from the listing; nothing is invented. */
export function ExperienceCard({ listing: l, locale, t, fx = null }: { listing: PublicListing; locale: string; t: T; fx?: number | null }) {
  const cover = l.images[0];
  const price = l.fromPrice;
  return (
    <Link
      href={`/${locale}/listings/${l.id}`}
      className="card-lift group block h-full overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[var(--surface-2)]">
        {cover ? (
          <CoverImage src={`${cover.url}?w=640`} srcSet={imgSrcSet(cover.url)} sizes="(min-width: 1024px) 24rem, (min-width: 640px) 45vw, 92vw" alt={cover.alt ?? ''} className="card-img h-full w-full object-cover" />
        ) : (
          <div aria-hidden="true" className="card-img h-full w-full" style={{ background: 'linear-gradient(135deg, #0a6fd8 0%, #1fa3b8 100%)' }} />
        )}
        <span className="absolute start-3 top-3 rounded-full bg-[var(--surface)]/90 px-3 py-1 text-xs font-semibold text-[var(--fg)] backdrop-blur">
          {t(`category.${l.category}` as MessageKey)}
        </span>
      </div>
      <div className="space-y-2 p-5">
        <p className="text-sm text-[var(--muted)]">{l.city ?? ''}</p>
        <h3 className="text-lg font-semibold leading-snug">{l.title}</h3>
        {l.summary ? <p className="line-clamp-2 text-sm text-[var(--muted)]">{l.summary}</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-sm">
            {l.bookable && price ? (
              price.amountMinor === '0' ? (
                <strong>{t('card.free')}</strong>
              ) : (
                <>
                  {t('card.from')} <strong>{formatMoney(price.amountMinor, price.currency, locale)}</strong> <span className="text-[var(--muted)]">/ {t('card.perPerson')}</span>
                  {fx && price.currency === 'USD' ? <span className="block text-xs text-[var(--muted)]">{lbpEstimate(price.amountMinor, fx, locale)} ({t('fx.estimate')})</span> : null}
                </>
              )
            ) : (
              <span className="text-[var(--muted)]">{t('card.discovery')}</span>
            )}
          </span>
          {l.company?.verified ? (
            <span className="whitespace-nowrap rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs font-semibold text-[var(--fg)]">{t('listing.verifiedBusiness')}</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
