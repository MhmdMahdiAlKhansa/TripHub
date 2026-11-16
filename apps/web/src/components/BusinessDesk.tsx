'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { WorkspaceTabs } from './WorkspaceTabs';
import type { DeskCopy } from './AdminConsole';

/** Which tabs each company role works in. The API still enforces permissions; this decides what each role SEES. */
const TABS: Record<string, string[]> = {
  OWNER: ['bookings', 'listings', 'money', 'insights', 'team', 'profile'],
  MANAGER: ['bookings', 'listings', 'insights'],
  BOOKING_STAFF: ['bookings'],
  FINANCE: ['money'],
};

export function BusinessDesk({ companyId, desks, hostDesks, tabLabels, hostTabLabels, slots, noRole, working }: { companyId: string; desks: Record<string, DeskCopy>; hostDesks: Record<string, DeskCopy>; tabLabels: Record<string, string>; hostTabLabels: Record<string, string>; slots: Record<string, ReactNode>; noRole: string; working: string }) {
  const [role, setRole] = useState<'loading' | 'none' | string>('loading');
  const [host, setHost] = useState(false);
  useEffect(() => {
    fetch('/api/v1/companies', { credentials: 'same-origin' })
      .then(async (r) => {
        if (!r.ok) return setRole('none');
        const j = (await r.json()) as { companies: Array<{ id: string; role: string; kind?: string }> };
        const me = j.companies.find((c) => c.id === companyId);
        setHost(me?.kind === 'HOST');
        setRole(me?.role ?? 'none');
      })
      .catch(() => setRole('none'));
  }, [companyId]);
  if (role === 'loading') return <p className="text-[var(--muted)]">{working}</p>;
  if (role === 'none' || !TABS[role]) return <p role="alert">{noRole}</p>;
  const d = (host ? hostDesks : desks)[role]!;
  const names = host ? { ...tabLabels, ...hostTabLabels } : tabLabels;
  return (
    <WorkspaceTabs
      kicker={d.kicker}
      title={d.title}
      subtitle={d.subtitle}
      accent={d.accent}
      tabs={TABS[role]!.map((id) => ({ id, label: names[id] ?? id, node: slots[id] }))}
    />
  );
}
