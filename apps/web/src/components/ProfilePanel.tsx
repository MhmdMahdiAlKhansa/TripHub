'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MyBookings } from './MyBookings';
import { Notifications } from './Notifications';
import { WaitlistPanel } from './WaitlistPanel';

interface Labels {
  waitlist: React.ComponentProps<typeof WaitlistPanel>['labels'];
  notifications: React.ComponentProps<typeof Notifications>['labels'];
  bookings: React.ComponentProps<typeof MyBookings>['labels'];
  emptyTitle: string;
  emptyBody: string;
  signIn: string;
  signedInAs: string;
  logout: string;
  working: string;
  businessLink: string;
  securityLink: string;
  staffLink: string;
}

export function ProfilePanel({ locale, labels }: { locale: string; labels: Labels }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'out' } | { kind: 'in'; email: string; name: string | null; staff: boolean }>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    fetch('/api/v1/auth/me', { credentials: 'same-origin' })
      .then(async (r) => {
        if (!live) return;
        if (!r.ok) return setState({ kind: 'out' });
        const j = (await r.json()) as { user: { email: string; displayName: string | null; platformRole: string } };
        setState({ kind: 'in', email: j.user.email, name: j.user.displayName, staff: j.user.platformRole !== 'NONE' });
      })
      .catch(() => live && setState({ kind: 'out' }));
    return () => {
      live = false;
    };
  }, []);

  async function logout() {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    window.location.assign(`/${locale}`);
  }

  if (state.kind === 'loading') return <p className="text-[var(--muted)]">{labels.working}</p>;
  if (state.kind === 'out') {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="text-lg font-semibold">{labels.emptyTitle}</h2>
        <p className="mt-2 text-[var(--muted)]">{labels.emptyBody}</p>
        <Link href={`/${locale}/login`} className="mt-4 inline-block rounded-full bg-[var(--brand)] px-6 py-3 font-semibold text-[var(--on-brand)]">
          {labels.signIn}
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <p>
        {labels.signedInAs} <strong dir="ltr">{state.email}</strong>
      </p>
      <button onClick={logout} className="min-h-12 rounded-full border border-[var(--border)] px-6 font-semibold">
        {labels.logout}
      </button>
      <Link href={`/${locale}/security`} className="me-2 inline-block rounded-full border border-[var(--border)] px-6 py-3 font-semibold">
        {labels.securityLink}
      </Link>
      <Link href={`/${locale}/business`} className="inline-block rounded-full border border-[var(--border)] px-6 py-3 font-semibold">
        {labels.businessLink}
      </Link>
      {state.staff ? (
        <Link href={`/${locale}/admin`} className="ms-2 inline-block rounded-full border border-[var(--border)] px-6 py-3 font-semibold">
          {labels.staffLink}
        </Link>
      ) : null}
      <Notifications locale={locale} labels={labels.notifications} />
      <WaitlistPanel locale={locale} labels={labels.waitlist} />
      <MyBookings locale={locale} labels={labels.bookings} />
    </div>
  );
}
