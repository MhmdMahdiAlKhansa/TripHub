import { REGIONS } from '@triphub/shared';
import { existsSync } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import type { MessageKey, T } from '../i18n/messages';

const TINTS = ['#0a6fd8', '#1fa3b8', '#3fa57f', '#f08a3c', '#e0a43a', '#2c8f9a', '#6a8fe8'];

/**
 * Region cards. A photo is used when `public/regions/<slug>.jpg|webp` exists; until then each card is a
 * brand-colour gradient with its name. Cards link to Explore filtered by that region.
 */
export function RegionRail({ locale, t }: { locale: string; t: T }) {
  return (
    <ul className="rail -mx-4 flex gap-4 overflow-x-auto px-4 pb-4" tabIndex={0} aria-label={t('home.regionsTitle')}>
      {REGIONS.map((r, i) => {
        const photo = ['jpg', 'webp', 'avif'].map((e) => `${r.slug}.${e}`).find((f) => existsSync(path.join(process.cwd(), 'public', 'regions', f)));
        return (
          <li key={r.slug} className="w-56 shrink-0 sm:w-64">
            <Link
              href={`/${locale}/explore?region=${r.slug}`}
              className="card-lift group relative block aspect-[3/4] overflow-hidden rounded-3xl"
              style={{ background: `linear-gradient(160deg, ${TINTS[i % TINTS.length]} 0%, #082a5a 130%)` }}
            >
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/regions/${photo}`} alt="" loading="lazy" decoding="async" className="card-img absolute inset-0 h-full w-full object-cover" />
              ) : null}
              <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#082a5a]/85 via-[#263c36]/10 to-transparent" />
              <span className="absolute inset-x-0 bottom-0 space-y-1 p-5 text-[#f7f8f3]">
                <span className="block text-xl font-bold">{t(`region.${r.slug}` as MessageKey)}</span>
                <span className="block text-sm opacity-90">{t(`region.${r.slug}.blurb` as MessageKey)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
