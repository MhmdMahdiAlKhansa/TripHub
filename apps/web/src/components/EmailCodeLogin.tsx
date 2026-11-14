'use client';

import { useState, type FormEvent } from 'react';
import { workspaceOf } from '../lib/roleHome';

interface Labels { title: string; email: string; send: string; sent: string; code: string; verify: string; working: string; invalid: string; tooMany: string; generic: string }

/** Passwordless sign-in: ask for a 6-digit code by email, then type it. */
export function EmailCodeLogin({ locale, labels }: { locale: string; labels: Labels }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function post(path: string, body: object) {
    return fetch(`/api/v1/auth/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  async function request(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await post('code/request', { email: email.trim().toLowerCase() });
      if (r.ok) { setStep('code'); setMsg(labels.sent); } else setError(r.status === 429 ? labels.tooMany : labels.generic);
    } catch { setError(labels.generic); } finally { setBusy(false); }
  }

  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '').trim();
    setBusy(true); setError('');
    try {
      const r = await post('code/verify', { email: email.trim().toLowerCase(), code });
      if (r.ok) return void window.location.assign((await workspaceOf()).href(locale));
      setError(r.status === 429 ? labels.tooMany : r.status === 401 ? labels.invalid : labels.generic);
    } catch { setError(labels.generic); } finally { setBusy(false); }
  }

  return (
    <section aria-label={labels.title} className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-lg font-semibold">{labels.title}</h2>
      {step === 'email' ? (
        <form onSubmit={request} className="space-y-3">
          <label className="block text-sm font-semibold">{labels.email}
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" className="mt-1 block min-h-12 w-full rounded-xl border border-[var(--border)] bg-transparent px-3" />
          </label>
          <button disabled={busy} className="min-h-12 rounded-full border border-[var(--border)] px-6 font-semibold">{busy ? labels.working : labels.send}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <p role="status" className="text-[var(--muted)]">{msg}</p>
          <label className="block text-sm font-semibold">{labels.code}
            <input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} dir="ltr" className="mt-1 block min-h-12 w-full rounded-xl border border-[var(--border)] bg-transparent px-3 tracking-[0.4em]" />
          </label>
          <button disabled={busy} className="min-h-12 rounded-full bg-[var(--brand)] px-6 font-semibold text-[var(--on-brand)]">{busy ? labels.working : labels.verify}</button>
        </form>
      )}
      {error ? <p role="alert" className="font-semibold text-[var(--danger,#b42318)]">{error}</p> : null}
    </section>
  );
}
