'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

const AMENITIES = ['wifi', 'parking', 'heating', 'fireplace', 'air_conditioning', 'kitchen', 'bbq', 'garden', 'pool', 'mountain_view', 'sea_view', 'hot_water_24h', 'generator', 'pets_allowed', 'breakfast', 'hiking_trail_access'] as const;
const TYPES = ['chalet', 'guesthouse', 'cabin', 'villa', 'apartment', 'room', 'campsite'] as const;

interface Property {
  id: string;
  status: string;
  city: string | null;
  meetingPoint: string | null;
  cancellationPolicy: string;
  depositPercent: number;
  latitude: number | null;
  longitude: number | null;
  attributes: { propertyType?: string; maxGuests?: number; bedrooms?: number; beds?: number; bathrooms?: number; amenities?: string[]; checkInTime?: string; checkOutTime?: string; minNights?: number; houseRules?: string };
  images: Array<{ id: string; url: string; alt: string | null }>;
  translations: Record<string, { title: string; description: string | null }>;
}
interface Rate { kind: string; amountMinor: string; currency: string }
interface Entry { id: string; kind: 'STAY' | 'BLOCK'; from: string; to: string; note: string | null; booking: null | { id: string; reference: string; status: string; guestName: string | null; guestPhone: string | null; guests: number | null; nights: number | null; totalMinor: string; currency: string } }

export interface PropertyLabels {
  newProperty: string; create: string; working: string; none: string; saved: string; created: string; error: string; missing: string;
  title: string; description: string; titleAr: string; descriptionAr: string; type: string; types: Record<string, string>; city: string; where: string; whereHint: string;
  maxGuests: string; bedrooms: string; beds: string; bathrooms: string; amenities: string; amenityNames: Record<string, string>;
  checkInTime: string; checkOutTime: string; minNights: string; houseRules: string; depositPercent: string; policy: string; policies: Record<string, string>;
  publish: string; pause: string; archive: string; archiveConfirm: string; publishedNote: string; edit: string; saveEdit: string; statuses: Record<string, string>;
  prices: string; night: string; weekendNight: string; cleaning: string; currency: string; savePrices: string; pricesNote: string;
  calendar: string; calendarEmpty: string; stay: string; blocked: string; guests: string; nights: string; block: string; blockFrom: string; blockTo: string; blockNote: string; unblock: string;
  photos: string; addPhoto: string; photoAlt: string; removePhoto: string; photoNote: string;
  checklist: string; checkVerified: string; checkPlan: string; checkPrice: string; checkPhoto: string; openProfile: string;
  missingNames: Record<string, string>; errors: Record<string, string>; bookingStatuses: Record<string, string>;
}

type Result = { ok: boolean; status: number; json: { code?: string; missing?: string[]; issues?: Array<{ path: string; message: string }>; max?: number } & Record<string, unknown> };
async function api(method: string, url: string, body?: unknown): Promise<Result> {
  const r = await fetch(url, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' }).catch(() => null);
  let json: Result['json'] = {};
  try { json = r ? await r.json() : {}; } catch { /* empty */ }
  return { ok: !!r?.ok, status: r?.status ?? 0, json };
}

const field = 'mt-1 block min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3';
const btn = 'min-h-11 rounded-full border border-[var(--border)] px-4 text-sm font-semibold disabled:opacity-60';
const int = (v: FormDataEntryValue | null, d?: number) => { const n = Number(String(v ?? '').trim()); return String(v ?? '').trim() === '' || !Number.isFinite(n) ? d : Math.round(n); };

/** The property form, shared by "new property" and "edit details". */
function PropertyFields({ labels, p }: { labels: PropertyLabels; p?: Property }) {
  const a = p?.attributes ?? {};
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">{labels.title}<input name="title" required minLength={3} maxLength={120} defaultValue={p?.translations.en?.title ?? ''} className={field} /></label>
        <label className="sm:col-span-2">{labels.description}<textarea name="description" required minLength={30} maxLength={4000} rows={4} defaultValue={p?.translations.en?.description ?? ''} className={field} /></label>
        <label>{labels.titleAr}<input name="titleAr" maxLength={120} dir="rtl" defaultValue={p?.translations.ar?.title ?? ''} className={field} /></label>
        <label>{labels.descriptionAr}<textarea name="descriptionAr" maxLength={4000} rows={2} dir="rtl" defaultValue={p?.translations.ar?.description ?? ''} className={field} /></label>
        <label>{labels.type}
          <select name="propertyType" defaultValue={a.propertyType ?? 'chalet'} className={field}>
            {TYPES.map((t) => <option key={t} value={t}>{labels.types[t] ?? t}</option>)}
          </select>
        </label>
        <label>{labels.city}<input name="city" required maxLength={80} defaultValue={p?.city ?? ''} className={field} /></label>
        <label className="sm:col-span-2">{labels.where}<input name="where" required maxLength={200} defaultValue={p?.meetingPoint ?? ''} placeholder={labels.whereHint} className={field} /></label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label>{labels.maxGuests}<input name="maxGuests" type="number" min={1} max={50} required defaultValue={a.maxGuests ?? 4} className={field} /></label>
        <label>{labels.bedrooms}<input name="bedrooms" type="number" min={0} max={30} defaultValue={a.bedrooms ?? 1} className={field} /></label>
        <label>{labels.beds}<input name="beds" type="number" min={1} max={60} defaultValue={a.beds ?? 2} className={field} /></label>
        <label>{labels.bathrooms}<input name="bathrooms" type="number" min={0} max={20} defaultValue={a.bathrooms ?? 1} className={field} /></label>
        <label>{labels.checkInTime}<input name="checkInTime" type="time" defaultValue={a.checkInTime ?? '14:00'} className={field} /></label>
        <label>{labels.checkOutTime}<input name="checkOutTime" type="time" defaultValue={a.checkOutTime ?? '11:00'} className={field} /></label>
        <label>{labels.minNights}<input name="minNights" type="number" min={1} max={30} defaultValue={a.minNights ?? 1} className={field} /></label>
        <label>{labels.depositPercent}<input name="deposit" type="number" min={1} max={100} defaultValue={p?.depositPercent ?? 50} className={field} /></label>
      </div>
      <fieldset>
        <legend className="font-semibold">{labels.amenities}</legend>
        <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4">
          {AMENITIES.map((am) => (
            <label key={am} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" name="amenities" value={am} defaultChecked={a.amenities?.includes(am)} />{labels.amenityNames[am] ?? am}</label>
          ))}
        </div>
      </fieldset>
      <label className="block">{labels.houseRules}<textarea name="houseRules" maxLength={1000} rows={2} defaultValue={a.houseRules ?? ''} className={field} /></label>
      <label className="block">{labels.policy}
        <select name="policy" defaultValue={p?.cancellationPolicy ?? 'MODERATE'} className={field}>
          {Object.entries(labels.policies).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
    </>
  );
}

function readForm(f: FormData) {
  const s = (k: string) => String(f.get(k) ?? '').trim();
  const translations: Record<string, { title: string; description: string }> = { en: { title: s('title'), description: s('description') } };
  if (s('titleAr')) translations.ar = { title: s('titleAr'), description: s('descriptionAr') };
  const attributes: Record<string, unknown> = {
    propertyType: s('propertyType'), maxGuests: int(f.get('maxGuests'), 2), bedrooms: int(f.get('bedrooms'), 1), beds: int(f.get('beds'), 1), bathrooms: int(f.get('bathrooms'), 1),
    amenities: f.getAll('amenities').map(String), checkInTime: s('checkInTime') || '14:00', checkOutTime: s('checkOutTime') || '11:00', minNights: int(f.get('minNights'), 1),
  };
  if (s('houseRules')) attributes.houseRules = s('houseRules');
  return { city: s('city') || undefined, meetingPoint: s('where') || undefined, cancellationPolicy: s('policy') || undefined, depositPercent: int(f.get('deposit'), 50), attributes, translations };
}

export function PropertyManager({ locale, companyId, labels }: { locale: string; companyId: string; labels: PropertyLabels }) {
  const [rows, setRows] = useState<Property[] | null>(null);
  const [rates, setRates] = useState<Record<string, Rate[]>>({});
  const [entries, setEntries] = useState<Record<string, Entry[]>>({});
  const [company, setCompany] = useState<{ status: string; canPublish: boolean } | null>(null);
  const [top, setTop] = useState<{ ok: boolean; text: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const base = `/api/v1/companies/${companyId}/listings`;
  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const day = (d: string) => fmt.format(new Date(`${d}T12:00:00Z`));
  const money = (minor: string, cur: string) => (cur === 'USD' ? `$${(Number(minor) / 100).toFixed(2)}` : `${Number(minor).toLocaleString()} LBP`);

  const loadOne = useCallback(async (id: string) => {
    const [r, e] = await Promise.all([api('GET', `${base}/${id}/rates`), api('GET', `${base}/${id}/stays`)]);
    setRates((x) => ({ ...x, [id]: r.ok ? (r.json.rates as Rate[]) : [] }));
    setEntries((x) => ({ ...x, [id]: e.ok ? (e.json.entries as Entry[]) : [] }));
  }, [base]);
  const load = useCallback(async () => {
    const [l, cs, sub] = await Promise.all([api('GET', base), api('GET', '/api/v1/companies'), api('GET', `/api/v1/companies/${companyId}/subscription`)]);
    const list = l.ok ? ((l.json.listings as Property[]) ?? []).filter((x) => x.status !== 'ARCHIVED') : [];
    setRows(list);
    const me = cs.ok ? (cs.json.companies as Array<{ id: string; status: string }>).find((c) => c.id === companyId) : undefined;
    setCompany({ status: me?.status ?? 'UNKNOWN', canPublish: !!(sub.ok && (sub.json.entitlements as { canPublish?: boolean } | undefined)?.canPublish) });
    await Promise.all(list.map((x) => loadOne(x.id)));
  }, [base, companyId, loadOne]);
  useEffect(() => { void load(); }, [load]);

  function explain(r: Result, okText = labels.saved) {
    if (r.ok) return { ok: true, text: okText };
    if (r.json.missing?.length) return { ok: false, text: `${labels.missing} ${r.json.missing.map((m) => labels.missingNames[m] ?? m).join(', ')}` };
    const code = r.json.code ?? (r.status === 0 ? 'network' : r.status === 403 ? 'forbidden' : '');
    if (code === 'validation_error' || code === 'invalid_attributes') {
      const paths = (r.json.issues ?? []).map((i) => i.path).filter(Boolean).join(', ');
      return { ok: false, text: `${labels.errors.validation_error ?? labels.error}${paths ? ` (${paths})` : ''}` };
    }
    return { ok: false, text: labels.errors[code]?.replace('{max}', String(r.json.max ?? '')) ?? labels.error };
  }
  const say = (id: string, r: Result, okText?: string) => setNotes((n) => ({ ...n, [id]: explain(r, okText) }));

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy('create');
    const r = await api('POST', base, { category: 'stays', bookingMode: 'NIGHTLY', ...readForm(new FormData(form)) });
    setBusy(null);
    setTop(explain(r, labels.created));
    if (r.ok) { form.reset(); await load(); }
  }
  async function saveEdit(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    say(id, await api('PATCH', `${base}/${id}`, readForm(new FormData(e.currentTarget))));
    await load();
  }
  async function transition(id: string, what: 'publish' | 'pause' | 'archive') {
    if (what === 'archive' && !window.confirm(labels.archiveConfirm)) return;
    setBusy(id);
    say(id, await api('POST', `${base}/${id}/${what}`), what === 'publish' ? labels.publishedNote : labels.saved);
    setBusy(null);
    await load();
  }
  async function savePrices(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const cur = String(f.get('currency') ?? 'USD');
    const minor = (k: string) => { const raw = String(f.get(k) ?? '').trim(); if (!raw) return null; const n = Number(raw); return Number.isFinite(n) && n >= 0 ? Math.round(cur === 'USD' ? n * 100 : n) : NaN; };
    const night = minor('night'); const weekend = minor('weekend'); const cleaning = minor('cleaning');
    if (night === null || Number.isNaN(night) || Number.isNaN(weekend as number) || Number.isNaN(cleaning as number)) return setNotes((n) => ({ ...n, [id]: { ok: false, text: labels.errors.night_rate_required ?? labels.error } }));
    const list = [{ kind: 'NIGHT', amount: night, currency: cur }, ...(weekend !== null ? [{ kind: 'WEEKEND_NIGHT', amount: weekend, currency: cur }] : []), ...(cleaning !== null ? [{ kind: 'CLEANING', amount: cleaning, currency: cur }] : [])];
    say(id, await api('PUT', `${base}/${id}/rates`, { rates: list }));
    await loadOne(id);
  }
  async function block(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const note = String(f.get('note') ?? '').trim();
    const r = await api('POST', `${base}/${id}/stays/blocks`, { from: String(f.get('from')), to: String(f.get('to')), ...(note ? { note } : {}) });
    say(id, r);
    if (r.ok) form.reset();
    await loadOne(id);
  }
  async function unblock(id: string, slotId: string) {
    say(id, await api('DELETE', `${base}/${id}/stays/blocks/${slotId}`));
    await loadOne(id);
  }
  async function addPhoto(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const file = f.get('photo');
    if (!(file instanceof File) || file.size === 0) return setNotes((n) => ({ ...n, [id]: { ok: false, text: labels.errors.no_file ?? labels.error } }));
    setBusy(id);
    const r = await fetch(`${base}/${id}/images?alt=${encodeURIComponent(String(f.get('alt') ?? '').trim())}`, { method: 'PUT', headers: { 'content-type': file.type || 'application/octet-stream' }, body: await file.arrayBuffer(), credentials: 'same-origin' }).catch(() => null);
    let json: Result['json'] = {};
    try { json = r ? await r.json() : {}; } catch { /* empty */ }
    setBusy(null);
    say(id, { ok: !!r?.ok, status: r?.status ?? 0, json });
    if (r?.ok) form.reset();
    await load();
  }
  async function removePhoto(id: string, imageId: string) {
    say(id, await api('DELETE', `${base}/${id}/images/${imageId}`));
    await load();
  }

  const verified = company?.status === 'APPROVED';
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-8">
      {company && (!verified || !company.canPublish) ? (
        <div role="note" className="space-y-2 rounded-2xl border-2 border-[var(--accent,#e0a43a)] bg-[var(--surface)] p-5">
          <p className="font-semibold">{!verified ? labels.checkVerified : labels.checkPlan}</p>
          <Link href={`/${locale}/business/${companyId}`} className="inline-flex min-h-11 items-center rounded-full bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--on-brand)]">{labels.openProfile}</Link>
        </div>
      ) : null}

      <form onSubmit={create} className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-lg font-semibold">{labels.newProperty}</h2>
        {top ? <p role={top.ok ? 'status' : 'alert'} className={`rounded-xl border px-4 py-3 ${top.ok ? 'border-[var(--border)]' : 'border-red-500'}`}>{top.text}</p> : null}
        <PropertyFields labels={labels} />
        <button disabled={busy === 'create'} className="min-h-12 rounded-full bg-[var(--brand)] px-6 font-semibold text-[var(--on-brand)] disabled:opacity-60">{busy === 'create' ? labels.working : labels.create}</button>
      </form>

      {rows === null ? <p className="text-[var(--muted)]">{labels.working}</p> : rows.length === 0 ? <p className="text-[var(--muted)]">{labels.none}</p> : (
        <ul className="space-y-4">
          {rows.map((p) => {
            const r = rates[p.id] ?? [];
            const night = r.find((x) => x.kind === 'NIGHT');
            const weekend = r.find((x) => x.kind === 'WEEKEND_NIGHT');
            const cleaning = r.find((x) => x.kind === 'CLEANING');
            const shown = (x?: Rate) => (x ? (x.currency === 'USD' ? (Number(x.amountMinor) / 100).toFixed(2) : x.amountMinor) : '');
            const checks = [
              { ok: verified, text: labels.checkVerified },
              ...(company && verified ? [{ ok: company.canPublish, text: labels.checkPlan }] : []),
              { ok: !!night, text: labels.checkPrice },
              { ok: p.images.length > 0, text: labels.checkPhoto },
            ];
            const note = notes[p.id];
            return (
              <li key={p.id} className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-lg font-semibold">
                    {p.translations.en?.title ?? Object.values(p.translations)[0]?.title}
                    <span className="block text-sm font-normal text-[var(--muted)]">{labels.types[p.attributes.propertyType ?? ''] ?? ''} · {p.city ?? ''} · <strong>{labels.statuses[p.status] ?? p.status}</strong></span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {p.status !== 'PUBLISHED' ? <button className={`${btn} bg-[var(--brand)] text-[var(--on-brand)]`} disabled={busy === p.id} onClick={() => transition(p.id, 'publish')}>{labels.publish}</button> : <button className={btn} disabled={busy === p.id} onClick={() => transition(p.id, 'pause')}>{labels.pause}</button>}
                    <button className={btn} disabled={busy === p.id} onClick={() => transition(p.id, 'archive')}>{labels.archive}</button>
                  </div>
                </div>
                {note ? <p role={note.ok ? 'status' : 'alert'} className={`rounded-xl border px-4 py-3 ${note.ok ? 'border-[var(--border)]' : 'border-red-500'}`}>{note.text}</p> : null}
                {p.status !== 'PUBLISHED' ? (
                  <div className="rounded-xl bg-[var(--surface-2)] p-3">
                    <p className="text-sm font-semibold">{labels.checklist}</p>
                    <ul className="mt-1 space-y-1 text-sm">{checks.map((c) => <li key={c.text}><span aria-hidden="true">{c.ok ? '✓' : '○'}</span> <span className={c.ok ? 'text-[var(--muted)] line-through' : ''}>{c.text}</span></li>)}</ul>
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2">
                  <form onSubmit={(e) => savePrices(p.id, e)} className="space-y-2 rounded-xl border border-[var(--border)] p-3">
                    <p className="font-semibold">{labels.prices}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <label>{labels.night}<input name="night" type="number" min={0} step="0.01" required defaultValue={shown(night)} key={`n-${night?.amountMinor}`} className={field} /></label>
                      <label>{labels.weekendNight}<input name="weekend" type="number" min={0} step="0.01" defaultValue={shown(weekend)} key={`w-${weekend?.amountMinor}`} className={field} /></label>
                      <label>{labels.cleaning}<input name="cleaning" type="number" min={0} step="0.01" defaultValue={shown(cleaning)} key={`c-${cleaning?.amountMinor}`} className={field} /></label>
                      <label>{labels.currency}<select name="currency" defaultValue={night?.currency ?? 'USD'} key={`cur-${night?.currency}`} className={field}><option>USD</option><option>LBP</option></select></label>
                    </div>
                    <p className="text-xs text-[var(--muted)]">{labels.pricesNote}</p>
                    <button className={btn}>{labels.savePrices}</button>
                  </form>

                  <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
                    <p className="font-semibold">{labels.calendar}</p>
                    {(entries[p.id] ?? []).length === 0 ? <p className="text-sm text-[var(--muted)]">{labels.calendarEmpty}</p> : (
                      <ul className="space-y-2 text-sm">
                        {(entries[p.id] ?? []).map((en) => (
                          <li key={en.id} className={`rounded-lg border-s-4 p-2 ${en.kind === 'BLOCK' ? 'border-[var(--muted)] bg-[var(--surface-2)]' : 'border-[var(--brand)]'}`}>
                            <div className="flex items-start justify-between gap-2">
                              <span>
                                <strong>{day(en.from)} → {day(en.to)}</strong>
                                {en.kind === 'BLOCK' ? ` · ${labels.blocked}${en.note ? `: ${en.note}` : ''}` : ''}
                                {en.booking ? (
                                  <span className="block">
                                    {en.booking.guestName ?? labels.stay} · {en.booking.guests} {labels.guests} · {en.booking.nights} {labels.nights} · {money(en.booking.totalMinor, en.booking.currency)} · {labels.bookingStatuses[en.booking.status] ?? en.booking.status}
                                    {en.booking.guestPhone ? <span dir="ltr"> · {en.booking.guestPhone}</span> : null}
                                  </span>
                                ) : null}
                              </span>
                              {en.kind === 'BLOCK' ? <button className={`${btn} min-h-9 px-3`} onClick={() => unblock(p.id, en.id)}>{labels.unblock}</button> : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <form onSubmit={(e) => block(p.id, e)} className="grid grid-cols-2 gap-2 pt-2">
                      <label className="text-sm">{labels.blockFrom}<input name="from" type="date" min={today} required className={field} /></label>
                      <label className="text-sm">{labels.blockTo}<input name="to" type="date" min={today} required className={field} /></label>
                      <label className="col-span-2 text-sm">{labels.blockNote}<input name="note" maxLength={200} className={field} /></label>
                      <button className={`${btn} col-span-2`}>{labels.block}</button>
                    </form>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="font-semibold">{labels.photos}</p>
                  <ul className="flex flex-wrap gap-2">
                    {p.images.map((im) => (
                      <li key={im.id} className="space-y-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`${im.url}?w=320`} alt={im.alt ?? ''} className="h-20 w-28 rounded-lg object-cover" />
                        <button className={btn} onClick={() => removePhoto(p.id, im.id)}>{labels.removePhoto}</button>
                      </li>
                    ))}
                  </ul>
                  <form onSubmit={(e) => addPhoto(p.id, e)} className="flex flex-wrap items-end gap-2">
                    <label><span className="sr-only">{labels.photos}</span><input name="photo" type="file" accept="image/png,image/jpeg,image/webp" required className={field} /></label>
                    <label>{labels.photoAlt}<input name="alt" maxLength={200} className={field} /></label>
                    <button className={btn} disabled={busy === p.id}>{busy === p.id ? labels.working : labels.addPhoto}</button>
                  </form>
                  <p className="text-xs text-[var(--muted)]">{labels.photoNote}</p>
                </div>

                <details className="rounded-xl border border-[var(--border)] p-3">
                  <summary className="cursor-pointer font-semibold">{labels.edit}</summary>
                  <form onSubmit={(e) => saveEdit(p.id, e)} className="mt-3 space-y-4">
                    <PropertyFields labels={labels} p={p} />
                    <button className={btn}>{labels.saveEdit}</button>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
