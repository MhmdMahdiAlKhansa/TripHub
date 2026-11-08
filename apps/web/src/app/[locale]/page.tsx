import { EmptyState } from '@triphub/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExperienceCard } from '../../components/ExperienceCard';
import { HeroBackdrop } from '../../components/HeroBackdrop';
import { RegionRail } from '../../components/RegionRail';
import { Reveal } from '../../components/Reveal';
import { SearchBar } from '../../components/SearchBar';
import { isLocale } from '../../i18n/locale';
import { createT, type MessageKey } from '../../i18n/messages';
import { apiGet, getFx, type PublicListing } from '../../lib/api';

const CATEGORIES = ['hiking', 'tours', 'restaurants', 'museums', 'workshops', 'historical'] as const;

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createT(locale);
  // Real, published listings only. If there are none the section says so; nothing is made up.
  const [featured, picks, fx] = await Promise.all([
    apiGet<{ listings: PublicListing[] }>(`/public/listings?limit=6&locale=${locale}`),
    apiGet<{ listings: PublicListing[] }>(`/public/listings?featured=true&limit=3&locale=${locale}`),
    getFx(),
  ]);

  const labels = {
    where: t('search.where'), wherePlaceholder: t('search.wherePlaceholder'), dates: t('search.dates'), guests: t('search.guests'),
    guestUnit: t('search.guestUnit'), search: t('search.go'),
  };

  return (
    <div className="space-y-20 pb-16">
      {/* ---------------------------------------------------------------- hero */}
      <section aria-labelledby="hero-title" className="full-bleed relative -mt-24 flex min-h-[88svh] items-center overflow-hidden text-[#f7f8f3]">
        <HeroBackdrop pauseLabel={t('hero.pause')} playLabel={t('hero.play')} />
        <div aria-hidden="true" className="hero-scrim absolute inset-0" />
        <div aria-hidden="true" className="hero-fade absolute inset-x-0 bottom-0 h-24" />
        <div className="relative z-10 mx-auto w-full max-w-6xl space-y-7 px-4 py-24">
          <p className="inline-flex rounded-full bg-[var(--sun)] px-3 py-1 text-sm font-bold tracking-wide text-[#1f3a33]">{t('hero.eyebrow')}</p>
          <h1 id="hero-title" className="max-w-3xl text-4xl font-bold leading-[1.08] sm:text-6xl lg:text-7xl">
            {t('hero.title')}
          </h1>
          <p className="max-w-xl text-lg text-[#e6ece5] sm:text-xl">{t('hero.subtitle')}</p>
          <SearchBar locale={locale} labels={labels} tone="glass" />
          <ul className="flex flex-wrap gap-2" aria-label={t('home.categories')}>
            {CATEGORIES.map((c) => (
              <li key={c}>
                <Link
                  href={`/${locale}/explore?category=${c}`}
                  className="inline-flex min-h-11 items-center rounded-full border border-white/50 bg-[#082a5a]/60 px-5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-[var(--sun)] hover:text-[#1f3a33]"
                >
                  {t(`category.${c}` as MessageKey)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <a href="#featured" className="absolute bottom-6 start-1/2 z-10 hidden -translate-x-1/2 text-sm text-[#e6ece5] sm:block rtl:translate-x-1/2">
          {t('hero.scroll')} ↓
        </a>
      </section>

      {picks.ok && picks.data.listings.length > 0 ? (
        <section aria-labelledby="picks-title">
          <Reveal className="mb-6">
            <h2 id="picks-title" className="text-3xl font-bold">{t('home.featuredByUs')}</h2>
            <p className="mt-1 text-[var(--muted)]">{t('home.featuredByUsLead')}</p>
          </Reveal>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {picks.data.listings.map((l) => (
              <li key={l.id}>
                <ExperienceCard listing={l} locale={locale} t={t} fx={fx} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- featured */}
      <section id="featured" aria-labelledby="featured-title" className="scroll-mt-24">
        <Reveal className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="featured-title" className="text-3xl font-bold">{t('home.featuredTitle')}</h2>
            <p className="mt-1 text-[var(--muted)]">{t('home.featuredLead')}</p>
          </div>
          <Link href={`/${locale}/explore`} className="font-semibold text-[var(--brand)] underline">{t('home.seeAll')}</Link>
        </Reveal>
        {!featured.ok ? (
          <EmptyState title={t('explore.loadFailedTitle')} body={t('explore.loadFailedBody')} />
        ) : featured.data.listings.length === 0 ? (
          <EmptyState title={t('home.featuredEmptyTitle')} body={t('home.featuredEmptyBody')} />
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.data.listings.map((l, i) => (
              <li key={l.id}>
                <Reveal delay={Math.min(i, 5) * 70} className="h-full">
                  <ExperienceCard listing={l} locale={locale} t={t} fx={fx} />
                </Reveal>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------------------- regions */}
      <section aria-labelledby="regions-title">
        <Reveal className="mb-6">
          <h2 id="regions-title" className="text-3xl font-bold">{t('home.regionsTitle')}</h2>
          <p className="mt-1 text-[var(--muted)]">{t('home.regionsLead')}</p>
        </Reveal>
        <Reveal>
          <RegionRail locale={locale} t={t} />
        </Reveal>
      </section>

      {/* ---------------------------------------------------------------- trust */}
      <section aria-labelledby="how-title" className="band-deep rounded-[2rem] px-6 py-12 md:px-12">
        <Reveal>
          <h2 id="how-title" className="mb-8 text-3xl font-bold">{t('home.howTitle')}</h2>
        </Reveal>
        <ul className="grid gap-8 md:grid-cols-3">
          {([1, 2, 3] as const).map((n, i) => (
            <li key={n}>
              <Reveal delay={i * 90} className="space-y-2">
                <h3 className="text-xl font-semibold">{t(`home.how${n}Title` as MessageKey)}</h3>
                <p className="text-[#d6e6fa]">{t(`home.how${n}Body` as MessageKey)}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------------------------------------------------------- business CTA */}
      <Reveal as="section" className="rounded-[2rem] bg-[linear-gradient(135deg,#0a6fd8_0%,#0c7a8a_100%)] px-6 py-12 text-white md:px-12">
        <h2 className="text-3xl font-bold">{t('home.bizTitle')}</h2>
        <p className="mt-2 max-w-xl opacity-90">{t('home.bizBody')}</p>
        <Link href={`/${locale}/business`} className="mt-6 inline-flex min-h-12 items-center rounded-full bg-[var(--sun)] px-7 font-bold text-[#1f3a33]">
          {t('home.bizCta')}
        </Link>
      </Reveal>
    </div>
  );
}
