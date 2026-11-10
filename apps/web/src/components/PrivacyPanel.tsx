'use client';

import { useEffect, useState } from 'react';

interface Labels {
  title: string; exportBody: string; exportBtn: string; deleteTitle: string; deleteBody: string; deleteBtn: string;
  password: string; confirmLabel: string; confirmWord: string; working: string;
  errors: { open_bookings: string; sole_owner: string; open_offer: string; staff_account: string; recent_login_required: string; invalid: string; generic: string };
}

export function PrivacyPanel({ labels }: { labels: Labels }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    fetch('/api/v1/auth/me', { credentials: 'same-origin' }).then((r) => setSignedIn(r.ok)).catch(() => undefined);
  }, []);

  async function remove() {
    setBusy(true);
    setMsg('');
    try {
      const r = await fetch('/api/v1/auth/me/delete', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE', password: password || undefined }) });
      if (r.ok) return void window.location.assign('/');
      const j = (await r.json().catch(() => ({}))) as { code?: string; message?: { code?: string } | string };
      const code = j.code ?? (typeof j.message === 'object' ? j.message?.code : undefined);
      const e = labels.errors as Record<string, string>;
      setMsg((code && e[code]) || (r.status === 401 ? labels.errors.invalid : labels.errors.generic));
    } catch {
      setMsg(labels.errors.generic);
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) return null;
  return (
    <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-lg font-semibold">{labels.title}</h2>
      <p className="text-[var(--muted)]">{labels.exportBody}</p>
      <a href="/api/v1/auth/me/export" download className="inline-flex min-h-12 items-center rounded-full border border-[var(--border)] px-6 font-semibold">{labels.exportBtn}</a>
      <hr className="border-[var(--border)]" />
      <h3 className="font-semibold">{labels.deleteTitle}</h3>
      <p className="text-[var(--muted)]">{labels.deleteBody}</p>
      {!open ? (
        <button onClick={() => setOpen(true)} className="min-h-12 rounded-full border border-[var(--danger,#b42318)] px-6 font-semibold text-[var(--danger,#b42318)]">{labels.deleteBtn}</button>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm font-semibold">{labels.password}
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block min-h-12 w-full rounded-xl border border-[var(--border)] bg-transparent px-3" />
          </label>
          <label className="block text-sm font-semibold">{labels.confirmLabel}
            <input value={typed} onChange={(e) => setTyped(e.target.value)} dir="ltr" className="mt-1 block min-h-12 w-full rounded-xl border border-[var(--border)] bg-transparent px-3" />
          </label>
          <button disabled={busy || typed !== labels.confirmWord} onClick={remove} className="min-h-12 rounded-full bg-[var(--danger,#b42318)] px-6 font-semibold text-white disabled:opacity-50">{busy ? labels.working : labels.deleteBtn}</button>
        </div>
      )}
      {msg ? <p role="alert" className="font-semibold text-[var(--danger,#b42318)]">{msg}</p> : null}
    </section>
  );
}
