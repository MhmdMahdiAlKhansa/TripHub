'use client';

import { useEffect, useState } from 'react';

interface N { id: string; kind: string; read: boolean; createdAt: string }
interface Labels { title: string; empty: string; markAll: string; generic: string; kinds: Record<string, string> }

export function Notifications({ locale, labels }: { locale: string; labels: Labels }) {
  const [rows, setRows] = useState<N[] | null>(null);
  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Beirut' });

  async function load() {
    const r = await fetch('/api/v1/me/notifications', { credentials: 'same-origin' }).catch(() => null);
    setRows(r && r.ok ? ((await r.json()) as { notifications: N[] }).notifications : []);
  }
  useEffect(() => {
    void load();
  }, []);

  async function markAll() {
    await fetch('/api/v1/me/notifications/read-all', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    await load();
  }

  if (rows === null) return null;
  return (
    <section aria-labelledby="nt" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="nt" className="text-xl font-semibold">{labels.title}</h2>
        {rows.some((n) => !n.read) ? (
          <button onClick={markAll} className="text-sm text-[var(--brand)] underline">{labels.markAll}</button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="text-[var(--muted)]">{labels.empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => (
            <li key={n.id} className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 ${n.read ? 'opacity-70' : 'font-semibold'}`}>
              <p>{labels.kinds[n.kind] ?? labels.generic}</p>
              <p className="text-xs font-normal text-[var(--muted)]">{fmt.format(new Date(n.createdAt))}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
