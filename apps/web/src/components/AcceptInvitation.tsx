'use client';

import Link from 'next/link';
import { useState } from 'react';

interface Labels { accept: string; working: string; done: string; failed: string; needSignIn: string; signIn: string; open: string }

export function AcceptInvitation({ token, locale, labels }: { token: string; locale: string; labels: Labels }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed' | 'auth'>(token ? 'idle' : 'failed');
  const [companyId, setCompanyId] = useState<string | null>(null);

  async function accept() {
    setState('busy');
    // The token travels in the POST body and is single-use and bound to the invited, verified email.
    const r = await fetch('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'same-origin',
    }).catch(() => null);
    if (r?.status === 401) return setState('auth');
    if (r?.ok) {
      setCompanyId(((await r.json()) as { companyId: string }).companyId);
      return setState('done');
    }
    setState('failed');
  }

  return (
    <div role="status" className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      {state === 'failed' ? <p>{labels.failed}</p> : null}
      {state === 'auth' ? (
        <p>
          {labels.needSignIn}{' '}
          <Link href={`/${locale}/login`} className="text-[var(--brand)] underline">{labels.signIn}</Link>
        </p>
      ) : null}
      {state === 'done' ? (
        <>
          <p>{labels.done}</p>
          <Link href={`/${locale}/business/${companyId}`} className="inline-block rounded-full bg-[var(--brand)] px-6 py-3 font-semibold text-[var(--on-brand)]">{labels.open}</Link>
        </>
      ) : null}
      {state === 'idle' || state === 'busy' || state === 'auth' ? (
        <button onClick={accept} disabled={state === 'busy'} className="min-h-12 rounded-full bg-[var(--brand)] px-6 font-semibold text-[var(--on-brand)] disabled:opacity-60">
          {state === 'busy' ? labels.working : labels.accept}
        </button>
      ) : null}
    </div>
  );
}
