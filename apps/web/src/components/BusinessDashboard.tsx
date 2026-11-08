'use client';

import { useCallback, useEffect, useState } from 'react';

interface Overview {
  subscription: { plan: string; status: string; trialEndsAt: string | null; currentPeriodEnd: string | null } | null;
  entitlements: { listingLimit: number | null; teamLimit: number | null };
  usage: { activeListings: number; teamSeats: number };
  trial: { eligible: boolean };
}
interface Booking {
  id: string;
  reference: string;
  status: string;
  quantity: number;
  contactName: string | null;
  customerEmail: string;
  slot: { startsAt: string };
  snapshot: { listing?: { title?: string } };
}
export interface BizLabels {
  plan: string; planStatus: string; usage: string; listings: string; team: string; of: string; unlimited: string;
  noSubscription: string; trialCommission: string; startTrial: string; trialEnds: string;
  bookings: string; noBookings: string; approve: string; decline: string; cancel: string; complete: string; declineReason: string;
  refund: string; refundReason: string; refundSent: string; refundFail: string;
  checkIn: string; checkInCode: string; checkInCta: string; checkedIn: string; seats: string; error: string; working: string;
  statuses: Record<string, string>;
}

async function call(method: string, url: string, body?: unknown): Promise<{ ok: boolean; json: unknown }> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  }).catch(() => null);
  return { ok: !!r?.ok, json: r ? await r.json().catch(() => ({})) : {} };
}

export function BusinessDashboard({ locale, companyId, labels, trialCommissionPct }: { locale: string; companyId: string; labels: BizLabels; trialCommissionPct: number }) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const base = `/api/v1/companies/${companyId}`;
  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Beirut' });

  const load = useCallback(async () => {
    const [o, b] = await Promise.all([fetch(`${base}/subscription`, { credentials: 'same-origin' }), fetch(`${base}/bookings`, { credentials: 'same-origin' })]);
    if (o.ok) setOv((await o.json()) as Overview);
    setRows(b.ok ? ((await b.json()) as { bookings: Booking[] }).bookings : []);
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, path: string, body?: unknown) {
    setBusy(id);
    setMsg(null);
    const r = await call('POST', `${base}/bookings/${id}/${path}`, body ?? {});
    if (!r.ok) setMsg(labels.error);
    setBusy(null);
    setDeclining(null);
    setReason('');
    await load();
  }

  async function requestRefund(id: string) {
    setBusy(id);
    const r = await call('POST', `${base}/bookings/${id}/refund`, { reason: reason.trim() });
    setMsg(r.ok ? labels.refundSent : labels.refundFail);
    setBusy(null);
    setRefunding(null);
    setReason('');
  }

  async function startTrial() {
    setBusy('trial');
    const r = await call('POST', `${base}/subscription/trial`, { acknowledgedCommissionBps: trialCommissionPct * 100 });
    setMsg(r.ok ? null : labels.error);
    setBusy(null);
    await load();
  }

  async function checkIn() {
    setBusy('checkin');
    const r = await call('POST', `${base}/check-in`, { code: code.trim() });
    setMsg(r.ok ? labels.checkedIn : labels.error);
    if (r.ok) setCode('');
    setBusy(null);
    await load();
  }

  const lim = (n: number | null) => (n === null ? labels.unlimited : String(n));
  const btn = 'min-h-11 rounded-full border border-[var(--border)] px-4 text-sm font-semibold disabled:opacity-60';

  return (
    <div className="space-y-8">
      {msg ? (
        <p role="status" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          {msg}
        </p>
      ) : null}

      <section aria-labelledby="sub" className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 id="sub" className="text-xl font-semibold">{labels.planStatus}</h2>
        {ov?.subscription ? (
          <>
            <p>
              {labels.plan}: <strong>{ov.subscription.plan}</strong> · {labels.statuses[ov.subscription.status] ?? ov.subscription.status}
              {ov.subscription.trialEndsAt ? ` · ${labels.trialEnds}: ${fmt.format(new Date(ov.subscription.trialEndsAt))}` : ''}
            </p>
            <p className="text-sm text-[var(--muted)]">
              {labels.usage}: {labels.listings} {ov.usage.activeListings} {labels.of} {lim(ov.entitlements.listingLimit)} · {labels.team} {ov.usage.teamSeats} {labels.of} {lim(ov.entitlements.teamLimit)}
            </p>
          </>
        ) : ov ? (
          <>
            <p>{labels.noSubscription}</p>
            {ov.trial.eligible ? (
              <>
                <p className="text-sm text-[var(--muted)]">{labels.trialCommission.replace('{pct}', String(trialCommissionPct))}</p>
                <button onClick={startTrial} disabled={busy === 'trial'} className="min-h-12 rounded-full bg-[var(--brand)] px-6 font-semibold text-[var(--on-brand)] disabled:opacity-60">
                  {busy === 'trial' ? labels.working : labels.startTrial}
                </button>
              </>
            ) : null}
          </>
        ) : null}
      </section>

      <section aria-labelledby="ci" className="space-y-2">
        <h2 id="ci" className="text-xl font-semibold">{labels.checkIn}</h2>
        <div className="flex max-w-md gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label={labels.checkInCode}
            placeholder={labels.checkInCode}
            dir="ltr"
            className="min-h-12 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
          />
          <button onClick={checkIn} disabled={busy === 'checkin' || code.trim().length < 10} className="min-h-12 rounded-full bg-[var(--brand)] px-5 font-semibold text-[var(--on-brand)] disabled:opacity-60">
            {labels.checkInCta}
          </button>
        </div>
      </section>

      <section aria-labelledby="bk" className="space-y-3">
        <h2 id="bk" className="text-xl font-semibold">{labels.bookings}</h2>
        {rows === null ? null : rows.length === 0 ? (
          <p className="text-[var(--muted)]">{labels.noBookings}</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((b) => {
              const started = new Date(b.slot.startsAt).getTime() <= Date.now();
              return (
                <li key={b.id} className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="font-semibold">{b.snapshot.listing?.title}</p>
                  <p className="text-sm text-[var(--muted)]">
                    <span dir="ltr">{b.reference}</span> · {fmt.format(new Date(b.slot.startsAt))} · {b.quantity} {labels.seats}
                  </p>
                  <p className="text-sm">
                    {b.contactName ?? ''} <span dir="ltr">{b.customerEmail}</span>
                  </p>
                  <p>{labels.statuses[b.status] ?? b.status}</p>
                  <div className="flex flex-wrap gap-2">
                    {b.status === 'REQUESTED' ? (
                      <>
                        <button className={btn} disabled={busy === b.id} onClick={() => act(b.id, 'approve')}>{labels.approve}</button>
                        <button className={btn} disabled={busy === b.id} onClick={() => setDeclining(declining === b.id ? null : b.id)}>{labels.decline}</button>
                      </>
                    ) : null}
                    {['REQUESTED', 'HELD', 'CONFIRMED'].includes(b.status) ? (
                      <button className={btn} disabled={busy === b.id} onClick={() => act(b.id, 'cancel')}>{labels.cancel}</button>
                    ) : null}
                    {b.status === 'CANCELLED' ? (
                      <button className={btn} onClick={() => setRefunding(refunding === b.id ? null : b.id)}>{labels.refund}</button>
                    ) : null}
                    {b.status === 'CONFIRMED' && started ? (
                      <button className={btn} disabled={busy === b.id} onClick={() => act(b.id, 'complete')}>{labels.complete}</button>
                    ) : null}
                  </div>
                  {refunding === b.id ? (
                    <div className="flex gap-2">
                      <input value={reason} onChange={(e) => setReason(e.target.value)} aria-label={labels.refundReason} placeholder={labels.refundReason} maxLength={500} className="min-h-11 flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3" />
                      <button className={btn} disabled={reason.trim().length < 10 || busy === b.id} onClick={() => requestRefund(b.id)}>{labels.refund}</button>
                    </div>
                  ) : null}
                  {declining === b.id ? (
                    <div className="flex gap-2">
                      <input value={reason} onChange={(e) => setReason(e.target.value)} aria-label={labels.declineReason} placeholder={labels.declineReason} maxLength={500} className="min-h-11 flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3" />
                      <button className={btn} disabled={reason.trim().length < 5 || busy === b.id} onClick={() => act(b.id, 'decline', { reason: reason.trim() })}>{labels.decline}</button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
