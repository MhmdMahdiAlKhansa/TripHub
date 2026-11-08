'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

export interface BookingLabels {
  title: string;
  date: string;
  tickets: string;
  total: string;
  cta: string;
  working: string;
  needSignIn: string;
  signIn: string;
  pickSeats: string;
  reference: string;
  viewBookings: string;
  free: string;
  kinds: Record<string, string>;
  errors: Record<string, string>;
  results: Record<string, string>;
  waitlistJoin: string;
  waitlistHint: string;
  waitlistJoined: string;
}

interface Slot { id: string; startsAt: string; remaining: number }
interface Rate { kind: string; amountMinor: string; currency: string }
interface BookingResult { status: string; reference: string }

const money = (minor: string, currency: string, locale: string) =>
  currency === 'USD'
    ? new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-US', { style: 'currency', currency: 'USD' }).format(Number(minor) / 100)
    : `${new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-US').format(Number(minor))} LBP`;

export function BookingWidget(props: { locale: string; listingId: string; slots: Slot[]; rates: Rate[]; dateLabels: string[]; labels: BookingLabels }) {
  const { locale, listingId, slots, rates, dateLabels, labels } = props;
  const [slotId, setSlotId] = useState(slots[0]?.id ?? '');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [total, setTotal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needSignIn, setNeedSignIn] = useState(false);
  const [result, setResult] = useState<BookingResult | null>(null);
  const [canQueue, setCanQueue] = useState(false);
  const [queued, setQueued] = useState(false);
  // One key per attempt: a double-click or retry can never create two bookings.
  const [idem, setIdem] = useState(() => crypto.randomUUID());

  const lines = useMemo(() => Object.entries(qty).filter(([, n]) => n > 0).map(([kind, n]) => ({ kind, qty: n })), [qty]);
  const currency = rates[0]?.currency ?? 'USD';

  useEffect(() => {
    if (lines.length === 0) return setTotal(null);
    const ctl = new AbortController();
    fetch(`/api/v1/public/listings/${listingId}/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lines }),
      signal: ctl.signal,
    })
      .then(async (r) => (r.ok ? ((await r.json()) as { totalMinor: string }) : null))
      .then((q) => setTotal(q ? q.totalMinor : null))
      .catch(() => undefined);
    return () => ctl.abort();
  }, [lines, listingId]);

  async function book() {
    if (lines.length === 0) return setError(labels.pickSeats);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idem },
        body: JSON.stringify({ listingId, slotId, lines }),
        credentials: 'same-origin',
      });
      if (res.status === 401) return setNeedSignIn(true);
      const json = (await res.json().catch(() => ({}))) as { booking?: BookingResult; code?: string };
      if (res.ok && json.booking) return setResult(json.booking);
      setCanQueue(json.code === 'not_enough_capacity' || json.code === 'waitlist_active');
      setError(labels.errors[json.code ?? ''] ?? labels.errors.generic ?? '');
      setIdem(crypto.randomUUID());
    } catch {
      setError(labels.errors.generic ?? '');
    } finally {
      setBusy(false);
    }
  }

  async function joinQueue() {
    const seats = lines.reduce((n, l) => n + l.qty, 0);
    const res = await fetch('/api/v1/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slotId, seats }),
      credentials: 'same-origin',
    }).catch(() => null);
    if (res?.status === 401) return setNeedSignIn(true);
    if (res?.ok) {
      setQueued(true);
      setError(null);
    } else setError(labels.errors.generic ?? '');
  }

  if (queued) {
    return (
      <div role="status" className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <p className="font-semibold">{labels.waitlistJoined}</p>
        <Link href={`/${locale}/profile`} className="text-[var(--brand)] underline">
          {labels.viewBookings}
        </Link>
      </div>
    );
  }

  if (result) {
    return (
      <div role="status" className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <p className="font-semibold">{labels.results[result.status] ?? ''}</p>
        <p>
          {labels.reference}: <strong dir="ltr">{result.reference}</strong>
        </p>
        <Link href={`/${locale}/profile`} className="text-[var(--brand)] underline">
          {labels.viewBookings}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{labels.title}</h3>
      <label className="block">
        {labels.date}
        <select value={slotId} onChange={(e) => setSlotId(e.target.value)} className="mt-1 block min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3">
          {slots.map((s, i) => (
            <option key={s.id} value={s.id}>
              {dateLabels[i]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-2">
        <legend>{labels.tickets}</legend>
        {rates.map((r) => (
          <label key={r.kind} className="flex items-center justify-between gap-3">
            <span>
              {labels.kinds[r.kind] ?? r.kind} · {r.amountMinor === '0' ? labels.free : money(r.amountMinor, r.currency, locale)}
            </span>
            <input
              type="number"
              min={0}
              max={20}
              inputMode="numeric"
              value={qty[r.kind] ?? 0}
              onChange={(e) => setQty({ ...qty, [r.kind]: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })}
              className="min-h-12 w-24 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-center"
              aria-label={labels.kinds[r.kind] ?? r.kind}
            />
          </label>
        ))}
      </fieldset>
      {total !== null ? (
        <p className="font-semibold">
          {labels.total}: {total === '0' ? labels.free : money(total, currency, locale)}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl border border-red-500 px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}
      {canQueue ? (
        <div className="space-y-2">
          <p className="text-sm text-[var(--muted)]">{labels.waitlistHint}</p>
          <button onClick={joinQueue} className="min-h-12 w-full rounded-full border border-[var(--border)] font-semibold">
            {labels.waitlistJoin}
          </button>
        </div>
      ) : null}
      {needSignIn ? (
        <p role="alert">
          {labels.needSignIn}{' '}
          <Link href={`/${locale}/login`} className="text-[var(--brand)] underline">
            {labels.signIn}
          </Link>
        </p>
      ) : null}
      <button onClick={book} disabled={busy || !slotId} className="min-h-12 w-full rounded-full bg-[var(--brand)] font-semibold text-[var(--on-brand)] disabled:opacity-60">
        {busy ? labels.working : labels.cta}
      </button>
    </div>
  );
}
