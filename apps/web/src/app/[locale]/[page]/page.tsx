import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHero } from '../../../components/PageHero';
import { PAGES, type PageKey } from '../../../content/pages';
import { isLocale } from '../../../i18n/locale';

const KEYS = Object.keys(PAGES.en) as PageKey[];
const isKey = (k: string): k is PageKey => (KEYS as string[]).includes(k);

export const dynamicParams = false;
export const generateStaticParams = () => (['en', 'ar'] as const).flatMap((locale) => KEYS.map((page) => ({ locale, page })));

export async function generateMetadata({ params }: { params: Promise<{ locale: string; page: string }> }): Promise<Metadata> {
  const { locale, page } = await params;
  if (!isLocale(locale) || !isKey(page)) return {};
  const c = PAGES[locale][page];
  return { title: c.title, description: c.lead };
}

/** About, Help, Terms and Privacy. One template, content in src/content/pages.ts. */
export default async function ContentPage({ params }: { params: Promise<{ locale: string; page: string }> }) {
  const { locale, page } = await params;
  if (!isLocale(locale) || !isKey(page)) notFound();
  const c = PAGES[locale][page];
  return (
    <article className="space-y-8">
      <PageHero title={c.title} subtitle={c.lead} />
      {c.draftNote ? (
        <p role="note" className="rounded-2xl border border-[var(--accent)] bg-[var(--surface)] p-4 font-semibold">
          {c.draftNote}
        </p>
      ) : null}
      <div className="max-w-3xl space-y-8">
        {c.sections.map((s) => (
          <section key={s.heading} className="space-y-2">
            <h2 className="text-2xl font-semibold">{s.heading}</h2>
            {s.body.map((p, i) => (
              <p key={i} className="text-lg leading-relaxed">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
