'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

interface Labels { email: string; newPassword: string; passwordHint: string; cta: string; working: string; done: string; failed: string; generic: string; signIn: string }

/** Two modes: request a reset link (email) or confirm with the token from the link (new password). */
export function ResetForm({ mode, token, locale, labels }: { mode: 'request' | 'confirm'; token?: string; locale: string; labels: Labels }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/auth/password-reset/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mode === 'request' ? { email: String(form.get('email') ?? '') } : { token, password: String(form.get('password') ?? '') }),
        credentials: 'same-origin',
      });
      setState(res.ok ? 'done' : 'failed');
    } catch {
      setState('failed');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'done') {
    return (
      <div role="status" className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <p>{labels.done}</p>
        {mode === 'confirm' ? (
          <Link href={`/${locale}/login`} className="inline-block rounded-full bg-[var(--brand)] px-6 py-3 font-semibold text-[var(--on-brand)]">
            {labels.signIn}
          </Link>
        ) : null}
      </div>
    );
  }
  const input = 'mt-1 block min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4';
  return (
    <form onSubmit={submit} className="max-w-md space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-lg">
      {mode === 'request' ? (
        <label className="block">
          {labels.email}
          <input name="email" type="email" required autoComplete="email" maxLength={254} dir="ltr" className={input} />
        </label>
      ) : (
        <label className="block">
          {labels.newPassword}
          <input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" dir="ltr" className={input} />
          <span className="mt-1 block text-sm text-[var(--muted)]">{labels.passwordHint}</span>
        </label>
      )}
      {state === 'failed' ? (
        <p role="alert" className="rounded-xl border border-red-500 px-4 py-3 text-sm">
          {mode === 'confirm' ? labels.failed : labels.generic}
        </p>
      ) : null}
      <button type="submit" disabled={busy || (mode === 'confirm' && !token)} className="min-h-12 rounded-full bg-[var(--brand)] px-8 font-semibold text-[var(--on-brand)] disabled:opacity-60">
        {busy ? labels.working : labels.cta}
      </button>
    </form>
  );
}
