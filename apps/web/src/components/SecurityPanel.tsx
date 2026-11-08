'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export interface SecurityLabels {
  signIn: string; loginCta: string; working: string;
  mfaOff: string; mfaOn: string; enable: string; secretLabel: string; confirmCode: string; confirm: string;
  recovery: string; disable: string; password: string; code: string; error: string; done: string;
}

async function post(url: string, body?: unknown) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    credentials: 'same-origin',
  }).catch(() => null);
  const text = r ? await r.text() : '';
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* empty body */
  }
  return { ok: !!r?.ok, json };
}

export function SecurityPanel({ locale, labels }: { locale: string; labels: SecurityLabels }) {
  const [me, setMe] = useState<'loading' | 'out' | { mfaEnabled: boolean }>('loading');
  const [setup, setSetup] = useState<{ secret: string } | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch('/api/v1/auth/me', { credentials: 'same-origin' }).catch(() => null);
    setMe(r && r.ok ? { mfaEnabled: ((await r.json()) as { user: { mfaEnabled: boolean } }).user.mfaEnabled } : 'out');
  }
  useEffect(() => {
    void load();
  }, []);

  async function start() {
    setBusy(true);
    setError(false);
    const r = await post('/api/v1/auth/mfa/setup');
    setBusy(false);
    if (r.ok) setSetup(r.json as { secret: string });
    else setError(true);
  }

  async function confirm(code: string) {
    setBusy(true);
    setError(false);
    const r = await post('/api/v1/auth/mfa/enable', { code });
    setBusy(false);
    if (!r.ok) return setError(true);
    setRecovery((r.json as { recoveryCodes: string[] }).recoveryCodes);
    setSetup(null);
    await load();
  }

  async function disable(password: string, code: string) {
    setBusy(true);
    setError(false);
    const r = await post('/api/v1/auth/mfa/disable', { password, code });
    setBusy(false);
    if (!r.ok) return setError(true);
    await load();
  }

  if (me === 'loading') return <p className="text-[var(--muted)]">{labels.working}</p>;
  if (me === 'out') {
    return (
      <p>
        {labels.signIn}{' '}
        <Link href={`/${locale}/login`} className="text-[var(--brand)] underline">
          {labels.loginCta}
        </Link>
      </p>
    );
  }
  const input = 'mt-1 block min-h-12 w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4';
  const primary = 'min-h-12 rounded-full bg-[var(--brand)] px-6 font-semibold text-[var(--on-brand)] disabled:opacity-60';

  return (
    <div className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <p className="font-semibold">{me.mfaEnabled ? labels.mfaOn : labels.mfaOff}</p>
      {error ? (
        <p role="alert" className="rounded-xl border border-red-500 px-4 py-3 text-sm">
          {labels.error}
        </p>
      ) : null}

      {recovery ? (
        <div role="status" className="space-y-2">
          <p>{labels.recovery}</p>
          <ul dir="ltr" className="grid grid-cols-2 gap-1 font-mono">
            {recovery.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button className={primary} onClick={() => setRecovery(null)}>
            {labels.done}
          </button>
        </div>
      ) : null}

      {!me.mfaEnabled && !setup && !recovery ? (
        <button className={primary} disabled={busy} onClick={start}>
          {labels.enable}
        </button>
      ) : null}

      {setup ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm(String(new FormData(e.currentTarget).get('code') ?? '').trim());
          }}
        >
          <p>{labels.secretLabel}</p>
          <p dir="ltr" className="break-all rounded-xl bg-[var(--bg)] p-3 font-mono">
            {setup.secret}
          </p>
          <label className="block">
            {labels.confirmCode}
            <input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} dir="ltr" className={input} />
          </label>
          <button className={primary} disabled={busy}>
            {labels.confirm}
          </button>
        </form>
      ) : null}

      {me.mfaEnabled && !recovery ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void disable(String(f.get('password') ?? ''), String(f.get('code') ?? '').trim());
          }}
        >
          <label className="block">
            {labels.password}
            <input name="password" type="password" required autoComplete="current-password" dir="ltr" className={input} />
          </label>
          <label className="block">
            {labels.code}
            <input name="code" required autoComplete="one-time-code" maxLength={32} dir="ltr" className={input} />
          </label>
          <button className="min-h-12 rounded-full border border-[var(--border)] px-6 font-semibold disabled:opacity-60" disabled={busy}>
            {labels.disable}
          </button>
        </form>
      ) : null}
    </div>
  );
}
