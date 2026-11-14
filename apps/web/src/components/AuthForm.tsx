'use client';

import { useState, type FormEvent } from 'react';
import { workspaceOf } from '../lib/roleHome';

export interface AuthLabels {
  email: string;
  password: string;
  passwordHint: string;
  displayName: string;
  cta: string;
  working: string;
  errorGeneric: string;
  errorTaken: string;
  errorInvalid: string;
  errorTooMany: string;
  errorValidation: string;
  registeredTitle: string;
  registeredBody: string;
  code: string;
  codeHint: string;
  codeNeeded: string;
}

export function AuthForm({ mode, locale, labels }: { mode: 'login' | 'register'; locale: string; labels: AuthLabels }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [needCode, setNeedCode] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body: Record<string, string> = { email: String(form.get('email') ?? ''), password: String(form.get('password') ?? '') };
    const name = String(form.get('displayName') ?? '').trim();
    if (mode === 'register' && name) body.displayName = name;
    const code = String(form.get('code') ?? '').trim();
    if (mode === 'login' && code) body.code = code;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'same-origin',
      });
      if (res.ok) {
        const ok = (await res.clone().json().catch(() => ({}))) as { signedIn?: boolean };
        if (mode === 'login' || ok.signedIn) window.location.assign((await workspaceOf()).href(locale));
        else setDone(true);
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { code?: string };
      if (res.status === 401 && j.code === 'mfa_required') {
        setNeedCode(true);
        setError(labels.codeNeeded);
        return;
      }
      if (res.status === 409) return void setError(labels.errorTaken);
      setError(res.status === 429 ? labels.errorTooMany : res.status === 400 ? labels.errorValidation : res.status === 401 ? labels.errorInvalid : labels.errorGeneric);
    } catch {
      setError(labels.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-lg font-semibold">{labels.registeredTitle}</h2>
        <p className="mt-2 text-[var(--muted)]">{labels.registeredBody}</p>
      </div>
    );
  }

  const input = 'mt-1 block min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4';
  return (
    <form onSubmit={submit} className="max-w-md space-y-4 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-lg" noValidate>
      {mode === 'register' ? (
        <label className="block">
          {labels.displayName}
          <input name="displayName" autoComplete="name" maxLength={80} className={input} />
        </label>
      ) : null}
      <label className="block">
        {labels.email}
        <input name="email" type="email" required autoComplete="email" maxLength={254} dir="ltr" className={input} />
      </label>
      <label className="block">
        {labels.password}
        <input
          name="password"
          type="password"
          required
          minLength={mode === 'register' ? 10 : 1}
          maxLength={128}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          dir="ltr"
          className={input}
        />
        {mode === 'register' ? <span className="mt-1 block text-sm text-[var(--muted)]">{labels.passwordHint}</span> : null}
      </label>
      {needCode ? (
        <label className="block">
          {labels.code}
          <input name="code" autoComplete="one-time-code" inputMode="numeric" maxLength={32} dir="ltr" className={input} />
          <span className="mt-1 block text-sm text-[var(--muted)]">{labels.codeHint}</span>
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl border border-red-500 px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="min-h-12 rounded-full bg-[var(--brand)] px-8 font-semibold text-[var(--on-brand)] disabled:opacity-60"
      >
        {busy ? labels.working : labels.cta}
      </button>
    </form>
  );
}
