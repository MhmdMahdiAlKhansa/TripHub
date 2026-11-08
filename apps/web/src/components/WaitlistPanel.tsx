'use client';

import { useCallback, useEffect, useState } from 'react';

interface Entry { id: string; slotId: string; listingId: string; startsAt: string; seats: number; status: string; position: number | null; offerExpiresAt: string | null; state: string }
export interface WaitlistLabels {
  title: string; empty: string; position: string; seats: string; accept: string; leave: string; expires: string; acceptNote: string; error: string;
  states: Record<string, string>;
}

export function WaitlistPanel({ locale, labels }: { locale: string; labels: WaitlistLabels }) {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Beirut' });

  const load = useCallback(async () => {
    const r = await fetch('/api/v1/waitlist', { credentials: 'same-origin' }).catch(() => null);
    setRows(r && r.ok ? ((await r.json()) as { entries: Entry[] }).entries : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function leave(id: string) {
    await fetch(`/api/v1/waitlist/${id}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => undefined);
    await load();
  }

  async function accept(e: Entry) {
    setMsg(null);
    const r = await fetch('/api/v1/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `wl-${e.id}` },
      body: JSON.stringify({ listingId: e.listingId, slotId: e.slotId, waitlistEntryId: e.id, lines: [{ kind: 'ADULT', qty: e.seats }] }),
      credentials: 'same-origin',
    }).catch(() => null);
    if (!r || !r.ok) setMsg(labels.error);
    await load();
  }

  if (rows === null) return null;
  const active = rows.filter((r) => r.status === 'WAITING' || r.status === 'OFFERED');
  return (
    <section aria-labelledby="wl" className="space-y-3">
      <h2 id="wl" className="text-xl font-semibold">{labels.title}</h2>
      {msg ? <p role="alert" className="rounded-xl border border-red-500 px-4 py-2 text-sm">{msg}</p> : null}
      {active.length === 0 ? (
        <p className="text-[var(--muted)]">{labels.empty}</p>
      ) : (
        <ul className="space-y-3">
          {active.map((e) => {
            const offered = e.state === 'offer_available';
            return (
              <li key={e.id} className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="font-semibold">{fmt.format(new Date(e.startsAt))} · {e.seats} {labels.seats}</p>
                <p>{labels.states[e.state] ?? e.state}{e.position ? ` · ${labels.position}: ${e.position}` : ''}</p>
                {offered && e.offerExpiresAt ? <p className="text-sm text-[var(--muted)]">{labels.expires}: {fmt.format(new Date(e.offerExpiresAt))}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {offered ? (
                    <button onClick={() => accept(e)} className="min-h-11 rounded-full bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--on-brand)]">{labels.accept}</button>
                  ) : null}
                  <button onClick={() => leave(e.id)} className="min-h-11 rounded-full border border-[var(--border)] px-5 text-sm font-semibold">{labels.leave}</button>
                </div>
                {offered ? <p className="text-xs text-[var(--muted)]">{labels.acceptNote}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
