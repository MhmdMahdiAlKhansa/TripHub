'use client';

import { useCallback, useEffect, useState } from 'react';

export interface StaffPanelLabels {
  working: string; error: string;
  emailTitle: string; emailNote: string; emailSent: string; emailQueued: string; emailFailed: string; emailNoFailed: string; emailTemplate: string; emailTo: string; emailAttempts: string; emailReason: string;
  featTitle: string; featNote: string; featOn: string; featOff: string; featAdd: string; featRemove: string;
}

const card = 'rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4';
const btn = 'min-h-11 rounded-full border border-[var(--border)] px-4 text-sm font-semibold disabled:opacity-60';

/** Support desk: how outgoing email is doing (read-only). */
export function EmailHealthPanel({ labels }: { labels: StaffPanelLabels }) {
  const [data, setData] = useState<null | 'error' | { counts: Record<string, number>; failed: Array<{ id: string; toEmail: string; template: string; attempts: number; lastError: string | null }> }>(null);
  useEffect(() => {
    fetch('/api/v1/admin/email', { credentials: 'same-origin' })
      .then(async (r) => setData(r.ok ? await r.json() : 'error'))
      .catch(() => setData('error'));
  }, []);
  if (!data) return <p className="text-[var(--muted)]">{labels.working}</p>;
  if (data === 'error') return <p role="alert">{labels.error}</p>;
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">{labels.emailTitle}</h2>
      <p className="text-sm text-[var(--muted)]">{labels.emailNote}</p>
      <dl className="grid grid-cols-3 gap-3">
        {([['SENT', labels.emailSent], ['QUEUED', labels.emailQueued], ['FAILED', labels.emailFailed]] as const).map(([k, l]) => (
          <div key={k} className={card}><dt className="text-sm text-[var(--muted)]">{l}</dt><dd className="text-2xl font-bold">{data.counts[k] ?? 0}</dd></div>
        ))}
      </dl>
      {data.failed.length === 0 ? <p className="text-[var(--muted)]">{labels.emailNoFailed}</p> : (
        <ul className="space-y-2">
          {data.failed.map((f) => (
            <li key={f.id} className={card}>
              <p className="font-semibold"><span dir="ltr">{f.toEmail}</span> · {f.template}</p>
              <p className="text-sm text-[var(--muted)]">{labels.emailAttempts}: {f.attempts}{f.lastError ? ` · ${labels.emailReason}: ${f.lastError}` : ''}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface L { id: string; title: string | null; city: string | null; featured: boolean }

/** Support desk: choose which experiences are featured on the home page. */
export function FeaturedPanel({ labels }: { labels: StaffPanelLabels }) {
  const [rows, setRows] = useState<L[] | null>(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const r = await fetch('/api/v1/public/listings?limit=50', { credentials: 'same-origin' }).catch(() => null);
    if (!r?.ok) return setRows([]);
    setRows(((await r.json()) as { listings: L[] }).listings);
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function toggle(l: L) {
    setMsg('');
    const r = await fetch(`/api/v1/admin/listings/${l.id}/feature`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ featured: !l.featured }) }).catch(() => null);
    if (!r?.ok) setMsg(labels.error);
    await load();
  }
  if (!rows) return <p className="text-[var(--muted)]">{labels.working}</p>;
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{labels.featTitle}</h2>
      <p className="text-sm text-[var(--muted)]">{labels.featNote}</p>
      {msg ? <p role="alert">{msg}</p> : null}
      <ul className="space-y-2">
        {rows.map((l) => (
          <li key={l.id} className={`${card} flex items-center justify-between gap-3`}>
            <span><span className="font-semibold">{l.title}</span> <span className="text-sm text-[var(--muted)]">{l.city ?? ''}</span> · <span className="text-sm">{l.featured ? labels.featOn : labels.featOff}</span></span>
            <button className={btn} onClick={() => toggle(l)}>{l.featured ? labels.featRemove : labels.featAdd}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
