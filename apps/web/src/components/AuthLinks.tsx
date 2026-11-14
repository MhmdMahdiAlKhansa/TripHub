'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { workspaceOf, type Workspace } from '../lib/roleHome';

/** Header account links: Log in / Sign up when signed out, Profile when signed in. */
export function AuthLinks({ locale, labels }: { locale: string; labels: { login: string; signup: string; profile: string; staffDesk: string; myBusiness: string } }) {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  const [ws, setWs] = useState<Workspace | null>(null);
  useEffect(() => {
    fetch('/api/v1/auth/status', { credentials: 'same-origin' })
      .then(async (r) => {
        const inn = r.ok && ((await r.json()) as { authenticated: boolean }).authenticated;
        setState(inn ? 'in' : 'out');
        if (inn) setWs(await workspaceOf());
      })
      .catch(() => setState('out'));
  }, []);
  if (state === 'loading') return <span className="inline-block min-h-11 w-24" aria-hidden="true" />;
  if (state === 'in') {
    return (
      <span className="hidden items-center gap-1 md:flex">
        {ws && ws.kind !== 'customer' ? (
          <Link href={ws.href(locale)} className="inline-flex min-h-11 items-center rounded-full bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--on-brand)]">
            {ws.kind === 'staff' ? labels.staffDesk : labels.myBusiness}
          </Link>
        ) : null}
        <Link href={`/${locale}/profile`} className={ws && ws.kind !== 'customer' ? 'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold hover:bg-[var(--surface-2)]' : 'inline-flex min-h-11 items-center rounded-full bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--on-brand)]'}>
          {labels.profile}
        </Link>
      </span>
    );
  }
  return (
    <span className="hidden items-center gap-1 md:flex">
      <Link href={`/${locale}/login`} className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold hover:bg-[var(--surface-2)]">{labels.login}</Link>
      <Link href={`/${locale}/register`} className="inline-flex min-h-11 items-center rounded-full bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--on-brand)]">{labels.signup}</Link>
    </span>
  );
}
