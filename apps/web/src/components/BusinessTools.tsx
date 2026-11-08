'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

export interface ToolsLabels {
  working: string; error: string; saved: string; noAccess: string;
  analytics: string; range30: string; bookingsByStatus: string; seatsBooked: string; bookedValue: string; verifiedPayments: string; checkedIn: string; reviews: string;
  daily: string; topListings: string; basicNote: string; seats: string; bookings: string;
  payouts: string; owed: string; held: string; earmarked: string; eligible: string; payoutHistory: string; noPayouts: string; payoutNote: string;
  promos: string; promoCode: string; promoKind: string; promoPercent: string; promoFixed: string; promoValue: string; promoMax: string; promoCreate: string; promoNone: string; promoUsed: string; promoOn: string; promoOff: string; promoLimit: string; promoNotIncluded: string;
  statuses: Record<string, string>;
}

type Json = Record<string, unknown>;
async function api(method: string, url: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  }).catch(() => null);
  let json: Json = {};
  try {
    json = r ? await r.json() : {};
  } catch {
    /* empty body */
  }
  return { ok: !!r?.ok, status: r?.status ?? 0, json };
}

const card = 'space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5';
const field = 'mt-1 block min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3';
const btn = 'min-h-11 rounded-full border border-[var(--border)] px-4 text-sm font-semibold disabled:opacity-60';
const usd = (minor: string, cur = 'USD') => (cur === 'USD' ? `$${(Number(minor) / 100).toFixed(2)}` : `${Number(minor).toLocaleString()} ${cur}`);

export function AnalyticsPanel({ companyId, labels }: { companyId: string; labels: ToolsLabels }) {
  const [d, setD] = useState<Json | null | 'denied'>(null);
  useEffect(() => {
    api('GET', `/api/v1/companies/${companyId}/analytics`).then((r) => setD(r.ok ? r.json : 'denied'));
  }, [companyId]);
  if (d === null) return null;
  if (d === 'denied') return null; // this role does not see money figures
  const money = (o: unknown) => Object.entries((o ?? {}) as Record<string, string>).map(([c, v]) => usd(v, c)).join(' · ') || '-';
  const daily = (d.daily as Array<{ day: string; seats: number }> | undefined) ?? [];
  const max = Math.max(1, ...daily.map((x) => x.seats));
  const top = (d.topListings as Array<{ title: string | null; seats: number; bookings: number }> | undefined) ?? [];
  const ci = d.checkIn as { checkedIn: number; tripsAlreadyStarted: number };
  const rv = d.reviews as { count: number; average: number | null };
  return (
    <section aria-labelledby="an" className={card}>
      <h2 id="an" className="text-xl font-semibold">{labels.analytics} <span className="text-sm font-normal text-[var(--muted)]">({labels.range30})</span></h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-[var(--muted)]">{labels.seatsBooked}</dt><dd className="text-2xl font-bold">{String(d.seatsBooked)}</dd></div>
        <div><dt className="text-[var(--muted)]">{labels.bookedValue}</dt><dd className="text-lg font-semibold">{money(d.bookedValueMinor)}</dd></div>
        <div><dt className="text-[var(--muted)]">{labels.verifiedPayments}</dt><dd className="text-lg font-semibold">{money(d.verifiedPaymentsMinor)}</dd></div>
        <div><dt className="text-[var(--muted)]">{labels.reviews}</dt><dd className="text-lg font-semibold">{rv.count}{rv.average !== null ? ` · ★ ${rv.average}` : ''}</dd></div>
        <div><dt className="text-[var(--muted)]">{labels.checkedIn}</dt><dd className="text-lg font-semibold">{ci.checkedIn} / {ci.tripsAlreadyStarted}</dd></div>
      </dl>
      <p className="text-sm text-[var(--muted)]">
        {labels.bookingsByStatus}:{' '}
        {Object.entries((d.bookingsByStatus ?? {}) as Record<string, number>).map(([k, v]) => `${labels.statuses[k] ?? k} ${v}`).join(' · ') || '-'}
      </p>
      {d.level === 'advanced' ? (
        <>
          {daily.length > 0 ? (
            <div>
              <h3 className="font-semibold">{labels.daily}</h3>
              <ul className="mt-2 flex h-28 items-end gap-1" aria-label={labels.daily}>
                {daily.map((x) => (
                  <li key={x.day} className="flex-1" title={`${x.day}: ${x.seats} ${labels.seats}`}>
                    <div className="w-full rounded-t bg-[var(--brand)]" style={{ height: `${Math.max(6, (x.seats / max) * 100)}%` }} />
                    <span className="sr-only">{x.day}: {x.seats} {labels.seats}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {top.length > 0 ? (
            <div>
              <h3 className="font-semibold">{labels.topListings}</h3>
              <ol className="mt-1 list-decimal ps-5 text-sm">
                {top.map((t, i) => (<li key={i}>{t.title} · {t.seats} {labels.seats} · {t.bookings} {labels.bookings}</li>))}
              </ol>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-[var(--muted)]">{labels.basicNote}</p>
      )}
    </section>
  );
}

export function PayoutsPanel({ companyId, labels }: { companyId: string; labels: ToolsLabels }) {
  const [d, setD] = useState<Json | null | 'denied'>(null);
  useEffect(() => {
    api('GET', `/api/v1/companies/${companyId}/payouts`).then((r) => setD(r.ok ? r.json : 'denied'));
  }, [companyId]);
  if (d === null || d === 'denied') return null;
  const balances = d.balances as Record<string, Record<string, string>>;
  const payouts = d.payouts as Array<{ id: string; amountMinor: string; currency: string; state: string; requestedAt: string; payoutReference: string | null }>;
  return (
    <section aria-labelledby="po" className={card}>
      <h2 id="po" className="text-xl font-semibold">{labels.payouts}</h2>
      <p className="text-sm text-[var(--muted)]">{labels.payoutNote}</p>
      {(['USD', 'LBP'] as const).map((c) => {
        const b = balances[c]!;
        if (b.owedMinor === '0' && b.earmarkedMinor === '0') return null;
        return (
          <dl key={c} className="grid gap-2 text-sm sm:grid-cols-4">
            <div><dt className="text-[var(--muted)]">{labels.owed} ({c})</dt><dd className="text-lg font-semibold">{usd(b.owedMinor!, c)}</dd></div>
            <div><dt className="text-[var(--muted)]">{labels.held}</dt><dd className="text-lg font-semibold">{usd(b.heldMinor!, c)}</dd></div>
            <div><dt className="text-[var(--muted)]">{labels.earmarked}</dt><dd className="text-lg font-semibold">{usd(b.earmarkedMinor!, c)}</dd></div>
            <div><dt className="text-[var(--muted)]">{labels.eligible}</dt><dd className="text-lg font-semibold">{usd(b.eligibleMinor!, c)}</dd></div>
          </dl>
        );
      })}
      <h3 className="font-semibold">{labels.payoutHistory}</h3>
      {payouts.length === 0 ? (
        <p className="text-[var(--muted)]">{labels.noPayouts}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {payouts.map((p) => (<li key={p.id}>{usd(p.amountMinor, p.currency)} · {p.state}{p.payoutReference ? ` · ${p.payoutReference}` : ''}</li>))}
        </ul>
      )}
    </section>
  );
}

interface Promo { id: string; code: string; kind: string; percentBps: number | null; amountMinor: string | null; currency: string | null; maxRedemptions: number | null; redeemed: number; active: boolean }

export function PromoManager({ companyId, labels }: { companyId: string; labels: ToolsLabels }) {
  const [rows, setRows] = useState<Promo[] | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const base = `/api/v1/companies/${companyId}/promo-codes`;
  const load = useCallback(async () => {
    const r = await api('GET', base);
    if (!r.ok) return setAllowed(false);
    setRows((r.json as { promos: Promo[] }).promos);
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(e.currentTarget);
    const kind = String(f.get('kind'));
    const value = Number(f.get('value'));
    const max = Number(f.get('max'));
    const r = await api('POST', base, {
      code: String(f.get('code')).trim(),
      kind,
      ...(kind === 'PERCENT' ? { percentBps: Math.round(value * 100) } : { amountMinor: String(Math.round(value * 100)), currency: 'USD' }),
      ...(max > 0 ? { maxRedemptions: max } : {}),
    });
    const code = (r.json as { code?: string }).code;
    setMsg(r.ok ? labels.saved : code === 'plan_limit_reached' ? labels.promoLimit : code === 'marketing_not_included' ? labels.promoNotIncluded : labels.error);
    if (r.ok) form.reset();
    await load();
  }

  if (!allowed || rows === null) return null;
  return (
    <section aria-labelledby="pr" className={card}>
      <h2 id="pr" className="text-xl font-semibold">{labels.promos}</h2>
      {msg ? <p role="status" className="rounded-xl border border-[var(--border)] px-4 py-2">{msg}</p> : null}
      <form onSubmit={create} className="grid gap-3 sm:grid-cols-5 sm:items-end">
        <label>{labels.promoCode}<input name="code" required minLength={3} maxLength={24} dir="ltr" className={`${field} uppercase`} /></label>
        <label>{labels.promoKind}
          <select name="kind" className={field}><option value="PERCENT">{labels.promoPercent}</option><option value="FIXED">{labels.promoFixed}</option></select>
        </label>
        <label>{labels.promoValue}<input name="value" type="number" min={0.01} step="0.01" required className={field} /></label>
        <label>{labels.promoMax}<input name="max" type="number" min={0} className={field} /></label>
        <button className="min-h-11 rounded-full bg-[var(--brand)] px-5 font-semibold text-[var(--on-brand)]">{labels.promoCreate}</button>
      </form>
      {rows.length === 0 ? (
        <p className="text-[var(--muted)]">{labels.promoNone}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] p-3 text-sm">
              <span>
                <strong dir="ltr">{p.code}</strong> · {p.kind === 'PERCENT' ? `${(p.percentBps ?? 0) / 100}%` : usd(p.amountMinor ?? '0', p.currency ?? 'USD')} · {labels.promoUsed} {p.redeemed}{p.maxRedemptions ? ` / ${p.maxRedemptions}` : ''}
              </span>
              <button className={btn} onClick={async () => { await api('PATCH', `${base}/${p.id}`, { active: !p.active }); await load(); }}>
                {p.active ? labels.promoOn : labels.promoOff}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
