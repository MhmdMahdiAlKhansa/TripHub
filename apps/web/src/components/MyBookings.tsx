'use client';

import { useEffect, useState, type FormEvent } from 'react';

interface Payment { id: string; method: string; state: string; amountMinor: string; currency: string; reference: string | null }
interface B {
  id: string; reference: string; status: string; confirmed: boolean; totalMinor: string; currency: string;
  slot: { startsAt: string }; snapshot: { listing?: { title?: string } };
  payments: Payment[];
  cancellation: { policy: string; refundIfCancelledNowMinor: string };
}
export interface MyBookingsLabels {
  title: string; empty: string; cancel: string; cancelling: string; statuses: Record<string, string>;
  ticket: string; ticketCode: string; calendar: string; refundNow: string; policy: string; policies: Record<string, string>;
  payTitle: string; payNote: string; payMethod: string; payReference: string; paySubmit: string; payStates: Record<string, string>;
  reviewTitle: string; rating: string; comment: string; reviewSubmit: string; reviewDone: string; error: string; saved: string;
}

const field = 'mt-1 block min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3';
const btn = 'min-h-11 rounded-full border border-[var(--border)] px-4 text-sm font-semibold disabled:opacity-60';

const money = (minor: string, currency: string, locale: string) =>
  currency === 'USD'
    ? new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-US', { style: 'currency', currency: 'USD' }).format(Number(minor) / 100)
    : `${new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-US').format(Number(minor))} LBP`;

export function MyBookings({ locale, labels }: { locale: string; labels: MyBookingsLabels }) {
  const [rows, setRows] = useState<B[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Beirut' });

  async function load() {
    const r = await fetch('/api/v1/bookings', { credentials: 'same-origin' }).catch(() => null);
    setRows(r && r.ok ? ((await r.json()) as { bookings: B[] }).bookings : []);
  }
  useEffect(() => {
    void load();
  }, []);

  async function post(url: string, body: unknown) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' }).catch(() => null);
    setMsg(r?.ok ? labels.saved : labels.error);
    await load();
    return !!r?.ok;
  }

  async function cancel(id: string) {
    setBusy(id);
    await post(`/api/v1/bookings/${id}/cancel`, {});
    setBusy(null);
  }

  async function showTicket(id: string) {
    const r = await fetch(`/api/v1/bookings/${id}/ticket`, { credentials: 'same-origin' }).catch(() => null);
    if (r?.ok) {
      const code = ((await r.json()) as { ticket: { code: string } }).ticket.code;
      setCodes((c) => ({ ...c, [id]: code }));
    }
  }

  async function pay(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await post(`/api/v1/bookings/${id}/payments`, { method: String(f.get('method')), reference: String(f.get('reference') ?? '').trim() });
  }

  async function review(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const comment = String(f.get('comment') ?? '').trim();
    await post(`/api/v1/me/bookings/${id}/review`, { rating: Number(f.get('rating')), ...(comment ? { comment } : {}) });
  }

  if (rows === null) return null;
  return (
    <section aria-labelledby="mb" className="space-y-3">
      <h2 id="mb" className="text-xl font-semibold">{labels.title}</h2>
      {msg ? <p role="status" className="rounded-xl border border-[var(--border)] px-4 py-2">{msg}</p> : null}
      {rows.length === 0 ? (
        <p className="text-[var(--muted)]">{labels.empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((b) => {
            const payment = b.payments[0];
            const live = ['HELD', 'CONFIRMED'].includes(b.status);
            return (
              <li key={b.id} className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="font-semibold">{b.snapshot.listing?.title}</p>
                <p className="text-sm text-[var(--muted)]">
                  <span dir="ltr">{b.reference}</span> · {fmt.format(new Date(b.slot.startsAt))}
                </p>
                <p>{labels.statuses[b.status] ?? b.status}</p>

                {live && b.totalMinor !== '0' ? (
                  <p className="text-sm text-[var(--muted)]">
                    {labels.policy}: {labels.policies[b.cancellation.policy] ?? b.cancellation.policy}
                    {b.cancellation.refundIfCancelledNowMinor !== '0' ? ` · ${labels.refundNow}: ${money(b.cancellation.refundIfCancelledNowMinor, b.currency, locale)}` : ''}
                  </p>
                ) : null}

                {b.status === 'HELD' && b.totalMinor !== '0' ? (
                  payment ? (
                    <p className="text-sm">{labels.payStates[payment.state] ?? payment.state}</p>
                  ) : (
                    <form onSubmit={(e) => pay(b.id, e)} className="space-y-2 rounded-xl border border-[var(--border)] p-3">
                      <p className="font-semibold">{labels.payTitle}: {money(b.totalMinor, b.currency, locale)}</p>
                      <p className="text-sm text-[var(--muted)]">{labels.payNote}</p>
                      <div className="flex flex-wrap gap-2">
                        <label>{labels.payMethod}
                          <select name="method" className={field}><option>WHISH</option><option>OMT</option></select>
                        </label>
                        <label>{labels.payReference}<input name="reference" required minLength={4} maxLength={64} dir="ltr" className={field} /></label>
                      </div>
                      <button className={btn}>{labels.paySubmit}</button>
                    </form>
                  )
                ) : null}

                {b.status === 'CONFIRMED' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button className={btn} onClick={() => showTicket(b.id)}>{labels.ticket}</button>
                    <a className={`${btn} inline-flex items-center`} href={`/api/v1/bookings/${b.id}/calendar.ics`}>{labels.calendar}</a>
                    {codes[b.id] ? <code dir="ltr" className="break-all rounded bg-[var(--surface-2)] px-2 py-1">{labels.ticketCode}: {codes[b.id]}</code> : null}
                  </div>
                ) : null}

                {b.status === 'COMPLETED' ? (
                  <form onSubmit={(e) => review(b.id, e)} className="space-y-2 rounded-xl border border-[var(--border)] p-3">
                    <p className="font-semibold">{labels.reviewTitle}</p>
                    <div className="flex flex-wrap gap-2">
                      <label>{labels.rating}
                        <select name="rating" defaultValue="5" className={field}>{[5, 4, 3, 2, 1].map((n) => (<option key={n} value={n}>{'★'.repeat(n)} ({n})</option>))}</select>
                      </label>
                      <label className="min-w-56 flex-1">{labels.comment}<input name="comment" maxLength={2000} className={field} /></label>
                    </div>
                    <button className={btn}>{labels.reviewSubmit}</button>
                  </form>
                ) : null}

                {['REQUESTED', 'HELD', 'CONFIRMED'].includes(b.status) ? (
                  <button onClick={() => cancel(b.id)} disabled={busy === b.id} className={btn}>
                    {busy === b.id ? labels.cancelling : labels.cancel}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
