'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Co { id: string; name: string; status: string; role: string }
interface Labels { createTitle: string; createName: string; createCta: string; createError: string; companies: string; none: string; open: string; signIn: string; loginCta: string; working: string }

export function BusinessList({ locale, labels }: { locale: string; labels: Labels }) {
  const [err, setErr] = useState(false);
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'out' } | { kind: 'ok'; rows: Co[] }>({ kind: 'loading' });
  useEffect(() => {
    fetch('/api/v1/companies', { credentials: 'same-origin' })
      .then(async (r) => setState(r.ok ? { kind: 'ok', rows: ((await r.json()) as { companies: Co[] }).companies } : { kind: 'out' }))
      .catch(() => setState({ kind: 'out' }));
  }, []);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
    // The address (slug) is derived from the name plus a random suffix so it is unique and guessable by no one.
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'business';
    const slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
    const r = await fetch('/api/v1/companies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, slug }),
      credentials: 'same-origin',
    }).catch(() => null);
    if (r?.ok) window.location.reload();
    else setErr(true);
  }

  if (state.kind === 'loading') return <p className="text-[var(--muted)]">{labels.working}</p>;
  if (state.kind === 'out') {
    return (
      <p>
        {labels.signIn}{' '}
        <Link href={`/${locale}/login`} className="text-[var(--brand)] underline">
          {labels.loginCta}
        </Link>
      </p>
    );
  }
  return (
    <section aria-labelledby="co" className="space-y-3">
      <h2 id="co" className="text-xl font-semibold">{labels.companies}</h2>
      {state.rows.length === 0 ? (
        <p className="text-[var(--muted)]">{labels.none}</p>
      ) : (
        <ul className="space-y-2">
          {state.rows.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <span>
                <strong>{c.name}</strong>
                <span className="ms-2 text-sm text-[var(--muted)]">{c.status} · {c.role}</span>
              </span>
              <Link href={`/${locale}/business/${c.id}`} className="rounded-full bg-[var(--brand)] px-5 py-2 text-sm font-semibold text-[var(--on-brand)]">
                {labels.open}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} className="max-w-md space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="font-semibold">{labels.createTitle}</h3>
        <label className="block">
          {labels.createName}
          <input name="name" required minLength={2} maxLength={120} className="mt-1 block min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3" />
        </label>
        {err ? <p role="alert" className="text-sm">{labels.createError}</p> : null}
        <button className="min-h-11 rounded-full bg-[var(--brand)] px-5 font-semibold text-[var(--on-brand)]">{labels.createCta}</button>
      </form>
    </section>
  );
}
