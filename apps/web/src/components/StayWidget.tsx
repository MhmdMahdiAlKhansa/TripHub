'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

export interface StayLabels {
  title: string; checkIn: string; checkOut: string; guests: string; nights: string; night: string; weekendNights: string; cleaning: string; total: string;
  cta: string; working: string; needSignIn: string; signIn: string; taken: string; noneTaken: string; unavailable: string; available: string;
  minNights: string; maxGuests: string; times: string; reference: string; viewBookings: string; depositHeld: string; confirmed: string;
  emergencyName: string; emergencyPhone: string; contactPhone: string;
  errors: Record<string, string>;
}
interface Calendar { rules: { maxGuests: number; minNights: number; checkInTime: string; checkOutTime: string }; unavailable: Array<{ from: string; to: string }>; today: string }
interface Quote { nights: number; weekendNights: number; currency: string; nightsMinor: string; cleaningMinor: string; totalMinor: string; available: boolean }

const money = (minor: string, currency: string, locale: string) =>
  currency === 'USD'
    ? new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-US', { style: 'currency', currency: 'USD' }).format(Number(minor) / 100)
    : `${new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-US').format(Number(minor))} LBP`;
const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Book nights at a property: pick check-in and check-out, see taken dates and the exact price before booking. */
export function StayWidget({ locale, listingId, labels }: { locale: string; listingId: string; labels: StayLabels }) {
  const [cal, setCal] = useState<Calendar | null>(null);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [guests, setGuests] = useState(2);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needSignIn, setNeedSignIn] = useState(false);
  const [result, setResult] = useState<{ reference: string; status: string; requiredMinor?: string; currency: string; holdExpiresAt: string | null } | null>(null);
  const [phone, setPhone] = useState('');
  const [emName, setEmName] = useState('');
  const [emPhone, setEmPhone] = useState('');
  const [idem, setIdem] = useState(() => crypto.randomUUID());
  const fmt = useMemo(() => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-GB', { day: 'numeric', month: 'short' }), [locale]);
  const fmtDay = (d: string) => fmt.format(new Date(`${d}T12:00:00Z`));

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    fetch(`/api/v1/public/listings/${listingId}/stay-calendar?from=${today}&to=${addDay(today, 180)}`)
      .then(async (r) => (r.ok ? setCal((await r.json()) as Calendar) : null))
      .catch(() => undefined);
  }, [listingId]);

  useEffect(() => {
    setQuote(null);
    setError(null);
    if (!checkIn || !checkOut) return;
    const ctl = new AbortController();
    fetch(`/api/v1/public/listings/${listingId}/stay-quote`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ checkIn, checkOut, guests }), signal: ctl.signal,
    })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { quote?: Quote; code?: string };
        if (r.ok && j.quote) {
          setQuote(j.quote);
          if (!j.quote.available) setError(labels.unavailable);
        } else setError(labels.errors[j.code ?? ''] ?? labels.errors.generic ?? '');
      })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [checkIn, checkOut, guests, listingId, labels]);

  async function book() {
    if (!quote?.available) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/v1/stays', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idem },
        credentials: 'same-origin',
        body: JSON.stringify({
          listingId, checkIn, checkOut, guests,
          ...(phone.trim() ? { contactPhone: phone.trim() } : {}),
          ...(emName.trim() ? { emergencyContactName: emName.trim() } : {}),
          ...(emPhone.trim() ? { emergencyContactPhone: emPhone.trim() } : {}),
        }),
      });
      if (r.status === 401) return setNeedSignIn(true);
      const j = (await r.json().catch(() => ({}))) as { booking?: { reference: string; status: string; currency: string; holdExpiresAt: string | null; deposit?: { requiredMinor: string } }; code?: string };
      if (r.ok && j.booking) return setResult({ reference: j.booking.reference, status: j.booking.status, requiredMinor: j.booking.deposit?.requiredMinor, currency: j.booking.currency, holdExpiresAt: j.booking.holdExpiresAt });
      setError(labels.errors[j.code ?? ''] ?? labels.errors.generic ?? '');
      setIdem(crypto.randomUUID());
    } catch {
      setError(labels.errors.generic ?? '');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div role="status" className="space-y-2">
        <p className="font-semibold">{result.status === 'CONFIRMED' ? labels.confirmed : labels.depositHeld.replace('{amount}', money(result.requiredMinor ?? '0', result.currency, locale))}</p>
        <p>{labels.reference}: <strong dir="ltr">{result.reference}</strong></p>
        <p>{fmtDay(checkIn)} → {fmtDay(checkOut)} · {quote?.nights} {labels.nights}</p>
        <Link href={`/${locale}/profile`} className="text-[var(--brand)] underline">{labels.viewBookings}</Link>
      </div>
    );
  }

  const field = 'mt-1 block min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3';
  const today = cal?.today ?? new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{labels.title}</h3>
      <div className="grid grid-cols-2 gap-2">
        <label>{labels.checkIn}
          <input type="date" min={today} value={checkIn} onChange={(e) => { setCheckIn(e.target.value); if (checkOut && e.target.value >= checkOut) setCheckOut(addDay(e.target.value, cal?.rules.minNights ?? 1)); }} className={field} />
        </label>
        <label>{labels.checkOut}
          <input type="date" min={checkIn ? addDay(checkIn, 1) : addDay(today, 1)} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={field} />
        </label>
      </div>
      <label className="block">{labels.guests}
        <input type="number" min={1} max={cal?.rules.maxGuests ?? 20} value={guests} onChange={(e) => setGuests(Math.max(1, Number(e.target.value) || 1))} inputMode="numeric" className={field} />
      </label>
      {cal ? (
        <p className="text-sm text-[var(--muted)]">
          {labels.minNights.replace('{n}', String(cal.rules.minNights))} · {labels.maxGuests.replace('{n}', String(cal.rules.maxGuests))} · {labels.times.replace('{in}', cal.rules.checkInTime).replace('{out}', cal.rules.checkOutTime)}
        </p>
      ) : null}
      {cal ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">{labels.taken}</summary>
          {cal.unavailable.length === 0 ? <p className="text-[var(--muted)]">{labels.noneTaken}</p> : (
            <ul className="mt-1 space-y-0.5">
              {cal.unavailable.map((u) => <li key={`${u.from}-${u.to}`}>{fmtDay(u.from)} → {fmtDay(u.to)}</li>)}
            </ul>
          )}
        </details>
      ) : null}
      {quote ? (
        <dl className="space-y-1 rounded-xl bg-[var(--surface-2)] p-3 text-sm">
          <div className="flex justify-between"><dt>{quote.nights} {labels.nights}{quote.weekendNights ? ` (${quote.weekendNights} ${labels.weekendNights})` : ''}</dt><dd>{money(quote.nightsMinor, quote.currency, locale)}</dd></div>
          {quote.cleaningMinor !== '0' ? <div className="flex justify-between"><dt>{labels.cleaning}</dt><dd>{money(quote.cleaningMinor, quote.currency, locale)}</dd></div> : null}
          <div className="flex justify-between border-t border-[var(--border)] pt-1 text-base font-bold"><dt>{labels.total}</dt><dd>{money(quote.totalMinor, quote.currency, locale)}</dd></div>
        </dl>
      ) : null}
      {quote?.available ? (
        <div className="grid gap-2">
          <label className="block text-sm">{labels.contactPhone}<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" placeholder="+961 70 000 000" maxLength={20} className={field} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">{labels.emergencyName}<input value={emName} onChange={(e) => setEmName(e.target.value)} maxLength={80} className={field} /></label>
            <label className="block text-sm">{labels.emergencyPhone}<input value={emPhone} onChange={(e) => setEmPhone(e.target.value)} inputMode="tel" dir="ltr" maxLength={20} className={field} /></label>
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="rounded-xl border border-red-500 px-4 py-3 text-sm">{error}</p> : null}
      {needSignIn ? (
        <p role="alert">{labels.needSignIn} <Link href={`/${locale}/login`} className="text-[var(--brand)] underline">{labels.signIn}</Link></p>
      ) : null}
      <button onClick={book} disabled={busy || !quote?.available} className="min-h-12 w-full rounded-full bg-[var(--brand)] font-semibold text-[var(--on-brand)] disabled:opacity-60">
        {busy ? labels.working : labels.cta}
      </button>
    </div>
  );
}
