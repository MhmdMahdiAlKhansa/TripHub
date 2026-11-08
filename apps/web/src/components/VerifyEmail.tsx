'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export function VerifyEmail({ token, locale, labels }: { token: string; locale: string; labels: { verifying: string; ok: string; failed: string; signIn: string } }) {
  const [state, setState] = useState<'working' | 'ok' | 'failed'>(token ? 'working' : 'failed');
  useEffect(() => {
    if (!token) return;
    // The token goes in the POST body, never a URL the API logs, and is single-use server-side.
    fetch('/api/v1/auth/verify-email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'same-origin',
    })
      .then((r) => setState(r.ok ? 'ok' : 'failed'))
      .catch(() => setState('failed'));
  }, [token]);
  return (
    <div role="status" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <p>{state === 'working' ? labels.verifying : state === 'ok' ? labels.ok : labels.failed}</p>
      {state === 'ok' ? (
        <Link href={`/${locale}/login`} className="mt-4 inline-block rounded-full bg-[var(--brand)] px-6 py-3 font-semibold text-[var(--on-brand)]">
          {labels.signIn}
        </Link>
      ) : null}
    </div>
  );
}
