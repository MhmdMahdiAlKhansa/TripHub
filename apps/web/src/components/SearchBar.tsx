'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';

export interface SearchLabels {
  where: string; wherePlaceholder: string; dates: string; guests: string; search: string; guestUnit: string;
}

/** The main search. It always navigates to Explore with real query parameters the API understands. */
export function SearchBar({ locale, labels, defaults = {}, tone = 'light' }: {
  locale: string; labels: SearchLabels; defaults?: { q?: string; date?: string; guests?: string; extra?: Record<string, string> }; tone?: 'light' | 'glass';
}) {
  const router = useRouter();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const params = new URLSearchParams(defaults.extra ?? {});
    for (const k of ['q', 'date', 'guests']) {
      const v = String(f.get(k) ?? '').trim();
      if (v) params.set(k, v);
    }
    router.push(`/${locale}/explore${params.size ? `?${params}` : ''}`);
  }

  const cell = 'flex min-h-14 flex-1 flex-col justify-center px-5 text-start';
  const input = 'w-full bg-transparent text-base text-[var(--fg)] placeholder:text-[var(--muted)] focus:outline-none';
  return (
    <form
      onSubmit={submit}
      role="search"
      className={`flex w-full max-w-4xl flex-col gap-1 rounded-[2rem] p-2 shadow-xl sm:flex-row sm:items-stretch sm:rounded-full ${
        tone === 'glass' ? 'bg-[var(--surface)]/95 backdrop-blur' : 'border border-[var(--border)] bg-[var(--surface)]'
      }`}
    >
      <label className={`${cell} sm:flex-[2]`}>
        <span className="text-xs font-semibold text-[var(--muted)]">{labels.where}</span>
        <input name="q" type="search" defaultValue={defaults.q ?? ''} placeholder={labels.wherePlaceholder} maxLength={120} className={input} />
      </label>
      <label className={`${cell} border-t border-[var(--border)] sm:border-s sm:border-t-0`}>
        <span className="text-xs font-semibold text-[var(--muted)]">{labels.dates}</span>
        <input name="date" type="date" defaultValue={defaults.date ?? ''} className={input} />
      </label>
      <label className={`${cell} border-t border-[var(--border)] sm:border-s sm:border-t-0`}>
        <span className="text-xs font-semibold text-[var(--muted)]">{labels.guests}</span>
        <select name="guests" defaultValue={defaults.guests ?? ''} className={input}>
          <option value="">–</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n} {labels.guestUnit}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="min-h-14 rounded-full bg-[var(--brand)] px-8 text-base font-semibold text-[var(--on-brand)] transition-colors hover:bg-[var(--brand-hover)]">
        {labels.search}
      </button>
    </form>
  );
}
