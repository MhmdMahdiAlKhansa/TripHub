'use client';

import { useEffect, useState } from 'react';
import { ListingManager, type ListingLabels } from './ListingManager';
import { PropertyManager, type PropertyLabels } from './PropertyManager';

/** Trip operators manage trips; property hosts manage properties. Same page, different tools. */
export function ListingsWorkspace({ locale, companyId, listingLabels, propertyLabels, hostTitle, tripTitle, working }: {
  locale: string; companyId: string; listingLabels: ListingLabels; propertyLabels: PropertyLabels; hostTitle: string; tripTitle: string; working: string;
}) {
  const [kind, setKind] = useState<'OPERATOR' | 'HOST' | null>(null);
  useEffect(() => {
    fetch('/api/v1/companies', { credentials: 'same-origin' })
      .then(async (r) => {
        const j = r.ok ? ((await r.json()) as { companies: Array<{ id: string; kind?: string }> }) : { companies: [] };
        setKind(j.companies.find((c) => c.id === companyId)?.kind === 'HOST' ? 'HOST' : 'OPERATOR');
      })
      .catch(() => setKind('OPERATOR'));
  }, [companyId]);
  if (!kind) return <p className="text-[var(--muted)]">{working}</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{kind === 'HOST' ? hostTitle : tripTitle}</h1>
      {kind === 'HOST' ? <PropertyManager locale={locale} companyId={companyId} labels={propertyLabels} /> : <ListingManager locale={locale} companyId={companyId} labels={listingLabels} />}
    </div>
  );
}
