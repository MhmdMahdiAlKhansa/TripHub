'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface Listing {
  id: string;
  category: string;
  bookingMode: string;
  status: string;
  city: string | null;
  cancellationPolicy: string;
  meetingPoint: string | null;
  pickupPoints: string[];
  depositPercent: number;
  latitude: number | null;
  longitude: number | null;
  images: Array<{ id: string; url: string; alt: string | null }>;
  translations: Record<string, { title: string; description: string | null }>;
}
interface Rate { kind: string; amountMinor: string; currency: string }
interface Slot { id: string; startsAt: string; capacity: number; reserved: number; status: string }
interface Detail { rates: Rate[]; slots: Slot[] }

export interface ListingLabels {
  newListing: string; category: string; mode: string; city: string; meeting: string; pickups: string; depositPercent: string; titleEn: string; descEn: string; titleAr: string; descAr: string;
  create: string; none: string; publish: string; pause: string; rates: string; adult: string; child: string; saveRates: string; freeNote: string;
  addSlot: string; when: string; capacity: string; addSlotCta: string; error: string; missing: string; saved: string; working: string;
  policy: string; policies: Record<string, string>;
  lat: string; lng: string; coordsNote: string;
  edit: string; saveEdit: string; photos: string; addPhoto: string; photoAlt: string; removePhoto: string; photoNote: string;
  categories: Record<string, string>; modes: Record<string, string>; statuses: Record<string, string>;
  // Clear guidance instead of a generic error.
  currency: string; dates: string; noDates: string; seatsTaken: string; closeDate: string; reopenDate: string; archive: string; archiveConfirm: string;
  checklist: string; checkVerified: string; checkPrice: string; checkDate: string; checkPhoto: string; checkPlan: string; openProfile: string; publishedNote: string;
  created: string; missingNames: Record<string, string>; errors: Record<string, string>;
  businessPage: string;
}

type Result = { ok: boolean; status: number; json: { code?: string; missing?: string[]; issues?: Array<{ path: string; message: string }>; max?: number } & Record<string, unknown> };

async function api(method: string, url: string, body?: unknown): Promise<Result> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  }).catch(() => null);
  let json: Result['json'] = {};
  try {
    json = r ? await r.json() : {};
  } catch {
    /* empty body */
  }
  return { ok: !!r?.ok, status: r?.status ?? 0, json };
}

const field = 'mt-1 block min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3';
const btn = 'min-h-11 rounded-full border border-[var(--border)] px-4 text-sm font-semibold disabled:opacity-60';
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export function ListingManager({ locale, companyId, labels }: { locale: string; companyId: string; labels: ListingLabels }) {
  const [rows, setRows] = useState<Listing[] | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [company, setCompany] = useState<{ status: string; canPublish: boolean } | null>(null);
  const [top, setTop] = useState<{ ok: boolean; text: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const base = `/api/v1/companies/${companyId}/listings`;
  const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-LB' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Beirut' });

  const loadOne = useCallback(async (id: string) => {
    const [r, s] = await Promise.all([api('GET', `${base}/${id}/rates`), api('GET', `${base}/${id}/slots`)]);
    setDetails((d) => ({ ...d, [id]: { rates: r.ok ? (r.json.rates as Rate[]) : [], slots: s.ok ? (s.json.slots as Slot[]) : [] } }));
  }, [base]);

  const load = useCallback(async () => {
    const [l, cs, sub] = await Promise.all([api('GET', base), api('GET', '/api/v1/companies'), api('GET', `/api/v1/companies/${companyId}/subscription`)]);
    const list = l.ok ? ((l.json.listings as Listing[]) ?? []).filter((x) => x.status !== 'ARCHIVED') : [];
    setRows(list);
    const me = cs.ok ? (cs.json.companies as Array<{ id: string; status: string }>).find((c) => c.id === companyId) : undefined;
    const ent = sub.ok ? (sub.json.entitlements as { canPublish: boolean } | undefined) : undefined;
    setCompany({ status: me?.status ?? 'UNKNOWN', canPublish: !!ent?.canPublish });
    await Promise.all(list.filter((x) => x.bookingMode !== 'DISCOVERY_ONLY').map((x) => loadOne(x.id)));
  }, [base, companyId, loadOne]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Turns an API answer into a sentence the owner can act on. */
  function explain(r: Result, okText = labels.saved): { ok: boolean; text: string } {
    if (r.ok) return { ok: true, text: okText };
    if (r.json.missing?.length) return { ok: false, text: `${labels.missing} ${r.json.missing.map((m) => labels.missingNames[m] ?? m).join(', ')}` };
    const code = r.json.code ?? (r.status === 0 ? 'network' : r.status === 403 ? 'forbidden' : '');
    if (code === 'validation_error' && r.json.issues?.length) return { ok: false, text: `${labels.errors.validation_error ?? labels.error} (${r.json.issues.map((i) => i.path || i.message).join(', ')})` };
    const known = labels.errors[code];
    return { ok: false, text: known ? known.replace('{max}', String(r.json.max ?? '')) : labels.error };
  }
  const say = (id: string, r: Result, okText?: string) => setNotes((n) => ({ ...n, [id]: explain(r, okText) }));

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const translations: Record<string, { title: string; description: string }> = { en: { title: s('titleEn'), description: s('descEn') } };
    if (s('titleAr')) translations.ar = { title: s('titleAr'), description: s('descAr') };
    setBusy('create');
    const r = await api('POST', base, {
      category: s('category'),
      bookingMode: s('mode'),
      cancellationPolicy: s('policy') || undefined,
      city: s('city') || undefined,
      meetingPoint: s('meeting') || undefined,
      pickupPoints: lines(s('pickups')),
      depositPercent: Number(s('deposit') || 100),
      translations,
    });
    setBusy(null);
    setTop(explain(r, labels.created));
    if (r.ok) {
      form.reset();
      await load();
    }
  }

  async function transition(id: string, what: 'publish' | 'pause' | 'archive') {
    if (what === 'archive' && !window.confirm(labels.archiveConfirm)) return;
    setBusy(id);
    const r = await api('POST', `${base}/${id}/${what}`);
    setBusy(null);
    say(id, r, what === 'publish' ? labels.publishedNote : labels.saved);
    await load();
  }

  async function saveEdit(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const translations: Record<string, { title: string; description: string }> = { en: { title: s('titleEn'), description: s('descEn') } };
    if (s('titleAr')) translations.ar = { title: s('titleAr'), description: s('descAr') };
    const lat = s('lat');
    const lng = s('lng');
    say(id, await api('PATCH', `${base}/${id}`, {
      city: s('city') || null,
      meetingPoint: s('meeting') || null,
      pickupPoints: lines(s('pickups')),
      depositPercent: Number(s('deposit') || 100),
      latitude: lat === '' || lng === '' ? null : Number(lat),
      longitude: lat === '' || lng === '' ? null : Number(lng),
      cancellationPolicy: s('policy'),
      translations,
    }));
    await load();
  }

  async function addPhoto(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const file = f.get('photo');
    if (!(file instanceof File) || file.size === 0) return setNotes((n) => ({ ...n, [id]: { ok: false, text: labels.errors.no_file ?? labels.error } }));
    setBusy(id);
    const r = await fetch(`${base}/${id}/images?alt=${encodeURIComponent(String(f.get('alt') ?? '').trim())}`, {
      method: 'PUT',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: await file.arrayBuffer(),
      credentials: 'same-origin',
    }).catch(() => null);
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

  async function saveRates(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const currency = String(f.get('currency') ?? 'USD');
    const toMinor = (k: string) => {
      const raw = String(f.get(k) ?? '').trim();
      if (raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? Math.round(currency === 'USD' ? n * 100 : n) : NaN;
    };
    const adult = toMinor('adult');
    const child = toMinor('child');
    if (adult === null || Number.isNaN(adult) || Number.isNaN(child as number)) return setNotes((n) => ({ ...n, [id]: { ok: false, text: labels.errors.price_needed ?? labels.error } }));
    const rates = [{ kind: 'ADULT', amount: adult, currency }, ...(child !== null ? [{ kind: 'CHILD', amount: child, currency }] : [])];
    say(id, await api('PUT', `${base}/${id}/rates`, { rates }));
    await loadOne(id);
  }

  async function addSlot(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const when = new Date(String(f.get('when') ?? ''));
    if (Number.isNaN(when.getTime())) return setNotes((n) => ({ ...n, [id]: { ok: false, text: labels.errors.slot_in_past ?? labels.error } }));
    const r = await api('POST', `${base}/${id}/slots`, { startsAt: when.toISOString(), capacity: Number(f.get('capacity')) });
    say(id, r);
    if (r.ok) form.reset();
    await loadOne(id);
  }

  async function setSlot(id: string, slotId: string, status: 'OPEN' | 'CLOSED') {
    say(id, await api('PATCH', `${base}/${id}/slots/${slotId}`, { status }));
    await loadOne(id);
  }

  const money = (r: Rate | undefined) => (r ? (r.currency === 'USD' ? (Number(r.amountMinor) / 100).toFixed(2) : r.amountMinor) : '');
  const verified = company?.status === 'APPROVED';

  return (
    <div className="space-y-8">
      {company && (!verified || !company.canPublish) ? (
        <div role="note" className="space-y-2 rounded-2xl border-2 border-[var(--accent,#e0a43a)] bg-[var(--surface)] p-5">
          <p className="font-semibold">{!verified ? labels.checkVerified : labels.checkPlan}</p>
          <Link href={`/${locale}/business/${companyId}`} className="inline-flex min-h-11 items-center rounded-full bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--on-brand)]">{labels.openProfile}</Link>
        </div>
      ) : null}

      <form onSubmit={create} className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-lg font-semibold">{labels.newListing}</h2>
        {top ? <p role={top.ok ? 'status' : 'alert'} className={`rounded-xl border px-4 py-3 ${top.ok ? 'border-[var(--border)]' : 'border-red-500'}`}>{top.text}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            {labels.category}
            <select name="category" className={field}>
              {Object.entries(labels.categories).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
            </select>
          </label>
          <label>
            {labels.mode}
            <select name="mode" defaultValue="FIXED_DATE" className={field}>
              {Object.entries(labels.modes).map(([k, v]) => (<option key={k} value={k} disabled={k === 'REQUEST_TO_BOOK'}>{v}</option>))}
            </select>
          </label>
          <label className="sm:col-span-2">
            {labels.policy}
            <select name="policy" defaultValue="MODERATE" className={field}>
              {Object.entries(labels.policies).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
            </select>
          </label>
          <label>{labels.city}<input name="city" maxLength={80} className={field} /></label>
          <label>{labels.meeting}<input name="meeting" maxLength={200} className={field} /></label>
          <label>{labels.pickups}<textarea name="pickups" rows={2} className={field} /></label>
          <label>{labels.depositPercent}<input name="deposit" type="number" min={1} max={100} defaultValue={100} className={field} /></label>
        </div>
        <label className="block">{labels.titleEn}<input name="titleEn" required minLength={3} maxLength={120} className={field} /></label>
        <label className="block">{labels.descEn}<textarea name="descEn" required minLength={30} maxLength={4000} rows={4} className={field} /></label>
        <label className="block">{labels.titleAr}<input name="titleAr" maxLength={120} dir="rtl" className={field} /></label>
        <label className="block">{labels.descAr}<textarea name="descAr" maxLength={4000} rows={3} dir="rtl" className={field} /></label>
        <button disabled={busy === 'create'} className="min-h-12 rounded-full bg-[var(--brand)] px-6 font-semibold text-[var(--on-brand)] disabled:opacity-60">
          {busy === 'create' ? labels.working : labels.create}
        </button>
      </form>

      {rows === null ? <p className="text-[var(--muted)]">{labels.working}</p> : rows.length === 0 ? (
        <p className="text-[var(--muted)]">{labels.none}</p>
      ) : (
        <ul className="space-y-4">
          {rows.map((l) => {
            const d = details[l.id];
            const bookable = l.bookingMode !== 'DISCOVERY_ONLY';
            const adult = d?.rates.find((r) => r.kind === 'ADULT');
            const child = d?.rates.find((r) => r.kind === 'CHILD');
            const upcoming = (d?.slots ?? []).filter((s) => new Date(s.startsAt).getTime() > Date.now());
            const checks = [
              { ok: verified, text: labels.checkVerified },
              ...(company && verified ? [{ ok: company.canPublish, text: labels.checkPlan }] : []),
              ...(bookable ? [{ ok: !!adult, text: labels.checkPrice }, { ok: upcoming.some((s) => s.status === 'OPEN'), text: labels.checkDate }] : []),
              { ok: l.images.length > 0, text: labels.checkPhoto },
            ];
            const note = notes[l.id];
            return (
              <li key={l.id} className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-lg font-semibold">
                    {l.translations.en?.title ?? Object.values(l.translations)[0]?.title}{' '}
                    <span className="block text-sm font-normal text-[var(--muted)]">
                      {labels.categories[l.category] ?? l.category} · {labels.modes[l.bookingMode] ?? l.bookingMode} · <strong>{labels.statuses[l.status] ?? l.status}</strong>
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {l.status !== 'PUBLISHED' ? <button className={`${btn} bg-[var(--brand)] text-[var(--on-brand)]`} disabled={busy === l.id} onClick={() => transition(l.id, 'publish')}>{labels.publish}</button> : null}
                    {l.status === 'PUBLISHED' ? <button className={btn} disabled={busy === l.id} onClick={() => transition(l.id, 'pause')}>{labels.pause}</button> : null}
                    <button className={btn} disabled={busy === l.id} onClick={() => transition(l.id, 'archive')}>{labels.archive}</button>
                  </div>
                </div>
                {note ? <p role={note.ok ? 'status' : 'alert'} className={`rounded-xl border px-4 py-3 ${note.ok ? 'border-[var(--border)]' : 'border-red-500'}`}>{note.text}</p> : null}
                {l.status !== 'PUBLISHED' ? (
                  <div className="rounded-xl bg-[var(--surface-2)] p-3">
                    <p className="text-sm font-semibold">{labels.checklist}</p>
                    <ul className="mt-1 space-y-1 text-sm">
                      {checks.map((c) => (
                        <li key={c.text}><span aria-hidden="true">{c.ok ? '✓' : '○'}</span> <span className={c.ok ? 'text-[var(--muted)] line-through' : ''}>{c.text}</span></li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {bookable ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <form onSubmit={(e) => saveRates(l.id, e)} className="space-y-2 rounded-xl border border-[var(--border)] p-3">
                      <p className="font-semibold">{labels.rates}</p>
                      <div className="flex flex-wrap gap-2">
                        <label className="flex-1">{labels.adult}<input name="adult" type="number" min={0} step="0.01" required defaultValue={money(adult)} key={`a-${adult?.amountMinor}`} className={field} /></label>
                        <label className="flex-1">{labels.child}<input name="child" type="number" min={0} step="0.01" defaultValue={money(child)} key={`c-${child?.amountMinor}`} className={field} /></label>
                        <label className="w-28">{labels.currency}
                          <select name="currency" defaultValue={adult?.currency ?? 'USD'} key={`cur-${adult?.currency}`} className={field}><option>USD</option><option>LBP</option></select>
                        </label>
                      </div>
                      <p className="text-xs text-[var(--muted)]">{labels.freeNote}</p>
                      <button className={btn}>{labels.saveRates}</button>
                    </form>
                    <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
                      <p className="font-semibold">{labels.dates}</p>
                      {upcoming.length === 0 ? <p className="text-sm text-[var(--muted)]">{labels.noDates}</p> : (
                        <ul className="space-y-1 text-sm">
                          {upcoming.map((s) => (
                            <li key={s.id} className="flex items-center justify-between gap-2">
                              <span>{fmt.format(new Date(s.startsAt))} · {s.reserved}/{s.capacity} {labels.seatsTaken}{s.status === 'CLOSED' ? ` · ${labels.statuses.CLOSED ?? 'Closed'}` : ''}</span>
                              <button className={`${btn} min-h-9 px-3`} onClick={() => setSlot(l.id, s.id, s.status === 'OPEN' ? 'CLOSED' : 'OPEN')}>{s.status === 'OPEN' ? labels.closeDate : labels.reopenDate}</button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <form onSubmit={(e) => addSlot(l.id, e)} className="flex flex-wrap items-end gap-2 pt-2">
                        <label className="flex-1">{labels.when}<input name="when" type="datetime-local" required className={field} /></label>
                        <label className="w-24">{labels.capacity}<input name="capacity" type="number" min={1} max={500} defaultValue={12} required className={field} /></label>
                        <button className={btn}>{labels.addSlotCta}</button>
                      </form>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <p className="font-semibold">{labels.photos}</p>
                  <ul className="flex flex-wrap gap-2">
                    {l.images.map((im) => (
                      <li key={im.id} className="space-y-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`${im.url}?w=320`} alt={im.alt ?? ''} className="h-20 w-28 rounded-lg object-cover" />
                        <button className={btn} onClick={() => removePhoto(l.id, im.id)}>{labels.removePhoto}</button>
                      </li>
                    ))}
                  </ul>
                  <form onSubmit={(e) => addPhoto(l.id, e)} className="flex flex-wrap items-end gap-2">
                    <label><span className="sr-only">{labels.photos}</span><input name="photo" type="file" accept="image/png,image/jpeg,image/webp" required className={field} /></label>
                    <label>{labels.photoAlt}<input name="alt" maxLength={200} className={field} /></label>
                    <button className={btn} disabled={busy === l.id}>{busy === l.id ? labels.working : labels.addPhoto}</button>
                  </form>
                  <p className="text-xs text-[var(--muted)]">{labels.photoNote}</p>
                </div>

                <details className="rounded-xl border border-[var(--border)] p-3">
                  <summary className="cursor-pointer font-semibold">{labels.edit}</summary>
                  <form onSubmit={(e) => saveEdit(l.id, e)} className="mt-3 space-y-2">
                    <label className="block">{labels.titleEn}<input name="titleEn" required minLength={3} defaultValue={l.translations.en?.title ?? ''} maxLength={120} className={field} /></label>
                    <label className="block">{labels.descEn}<textarea name="descEn" required minLength={30} defaultValue={l.translations.en?.description ?? ''} maxLength={4000} rows={4} className={field} /></label>
                    <label className="block">{labels.titleAr}<input name="titleAr" defaultValue={l.translations.ar?.title ?? ''} maxLength={120} dir="rtl" className={field} /></label>
                    <label className="block">{labels.descAr}<textarea name="descAr" defaultValue={l.translations.ar?.description ?? ''} maxLength={4000} rows={3} dir="rtl" className={field} /></label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label>{labels.city}<input name="city" defaultValue={l.city ?? ''} maxLength={80} className={field} /></label>
                      <label>{labels.meeting}<input name="meeting" defaultValue={l.meetingPoint ?? ''} maxLength={200} className={field} /></label>
                      <label>{labels.pickups}<textarea name="pickups" defaultValue={l.pickupPoints.join('\n')} rows={2} className={field} /></label>
                      <label>{labels.depositPercent}<input name="deposit" type="number" min={1} max={100} defaultValue={l.depositPercent} className={field} /></label>
                      <label className="sm:col-span-2">{labels.policy}
                        <select name="policy" defaultValue={l.cancellationPolicy} className={field}>
                          {Object.entries(labels.policies).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
                        </select>
                      </label>
                      <label>{labels.lat}<input name="lat" type="number" step="any" min={-90} max={90} defaultValue={l.latitude ?? ''} className={field} /></label>
                      <label>{labels.lng}<input name="lng" type="number" step="any" min={-180} max={180} defaultValue={l.longitude ?? ''} className={field} /></label>
                    </div>
                    <p className="text-xs text-[var(--muted)]">{labels.coordsNote}</p>
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
