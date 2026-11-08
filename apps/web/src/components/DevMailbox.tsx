'use client';

import { useEffect, useState } from 'react';

interface Mail { to: string; template: string; link: string; at: string }

export function DevMailbox({ labels }: { labels: { note: string; empty: string; off: string } }) {
  const [state, setState] = useState<'loading' | 'off' | Mail[]>('loading');
  useEffect(() => {
    fetch('/api/v1/dev/mailbox', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (r) => setState(r.ok ? ((await r.json()) as { mails: Mail[] }).mails : 'off'))
      .catch(() => setState('off'));
  }, []);
  if (state === 'loading') return null;
  if (state === 'off') return <p className="text-[var(--muted)]">{labels.off}</p>;
  return (
    <div className="space-y-3">
      <p className="text-[var(--muted)]">{labels.note}</p>
      {state.length === 0 ? <p>{labels.empty}</p> : null}
      <ul className="space-y-2">
        {state.map((m) => (
          <li key={m.at + m.to} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <p className="text-sm text-[var(--muted)]"><span dir="ltr">{m.to}</span> · {m.template}</p>
            <a href={m.link} className="break-all text-[var(--brand)] underline" dir="ltr">{m.link}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
