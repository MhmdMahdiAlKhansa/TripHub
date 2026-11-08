'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface Listing {
  id: string;
  category: string;
  bookingMode: string;
  status: string;
  city: string | null;
  cancellationPolicy: string;
  meetingPoint: string | null;
  latitude: number | null;
  longitude: number | null;
  images: Array<{ id: string; url: string; alt: string | null }>;
  translations: Record<string, { title: string; description: string | null }>;
}

export interface ListingLabels {
  newListing: string; category: string; mode: string; city: string; meeting: string; titleEn: string; descEn: string; titleAr: string; descAr: string;
  create: string; none: string; publish: string; pause: string; rates: string; adult: string; child: string; saveRates: string; freeNote: string;
  addSlot: string; when: string; capacity: string; addSlotCta: string; error: string; missing: string; saved: string; working: string;
  policy: string; policies: Record<string, string>;
  lat: string; lng: string; coordsNote: string;
  edit: string; saveEdit: string; photos: string; addPhoto: string; photoAlt: string; removePhoto: string; photoNote: string;
  categories: Record<string, string>; modes: Record<string, string>; statuses: Record<string, string>;
}

async function api(method: string, url: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  }).catch(() => null);
  let json: { code?: string; missing?: string[] } = {};
  try {
    json = r ? await r.json() : {};
  } catch {
    /* empty body */
  }
  return { ok: !!r?.ok, json };
}

const field = 'mt-1 block min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3';
const btn = 'min-h-11 rounded-full border border-[var(--border)] px-4 text-sm font-semibold disabled:opacity-60';

export function ListingManager({ companyId, labels }: { companyId: string; labels: ListingLabels }) {
  const [rows, setRows] = useState<Listing[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/v1/companies/${companyId}/listings`;

  const load = useCallback(async () => {
    const r = await api('GET', base);
    setRows(r.ok ? (r.json as unknown as { listings: Listing[] }).listings : []);
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  function report(r: { ok: boolean; json: { code?: string; missing?: string[] } }, okText = labels.saved) {
    if (r.ok) setMsg(okText);
    else if (r.json.missing?.length) setMsg(`${labels.missing} ${r.json.missing.join(', ')}`);
    else setMsg(labels.error);
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const translations: Record<string, { title: string; description: string }> = {
      en: { title: s('titleEn'), description: s('descEn') },
    };
    if (s('titleAr') && s('descAr')) translations.ar = { title: s('titleAr'), description: s('descAr') };
    setBusy(true);
    const r = await api('POST', base, {
      category: s('category'),
      bookingMode: s('mode'),
      cancellationPolicy: s('policy') || undefined,
      city: s('city') || undefined,
      meetingPoint: s('meeting') || undefined,
      translations,
    });
    setBusy(false);
    report(r);
    if (r.ok) {
      (e.target as HTMLFormElement).reset();
      await load();
    }
  }

  async function transition(id: string, what: 'publish' | 'pause') {
    const r = await api('POST', `${base}/${id}/${what}`);
    report(r);
    await load();
  }

  async function saveEdit(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    report(
      await api('PATCH', `${base}/${id}`, {
        city: s('city') || null,
        meetingPoint: s('meeting') || null,
        latitude: s('lat') === '' || s('lng') === '' ? null : Number(s('lat')),
        longitude: s('lat') === '' || s('lng') === '' ? null : Number(s('lng')),
        cancellationPolicy: s('policy'),
        translations: { en: { title: s('titleEn'), description: s('descEn') } },
      }),
    );
    await load();
  }

  async function addPhoto(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const file = f.get('photo');
    if (!(file instanceof File) || file.size === 0) return setMsg(labels.error);
    const r = await fetch(`${base}/${id}/images?alt=${encodeURIComponent(String(f.get('alt') ?? '').trim())}`, {
      method: 'PUT',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: await file.arrayBuffer(),
      credentials: 'same-origin',
    }).catch(() => null);
    report({ ok: !!r?.ok, json: {} });
    if (r?.ok) form.reset();
    await load();
  }

  async function removePhoto(id: string, imageId: string) {
    await api('DELETE', `${base}/${id}/images/${imageId}`);
    await load();
  }

  async function saveRates(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const toMinor = (k: string) => {
      const raw = String(f.get(k) ?? '').trim();
      return raw === '' ? null : Math.round(Number(raw) * 100);
    };
    const rates: Array<{ kind: string; amount: number; currency: string }> = [];
    const adult = toMinor('adult');
    const child = toMinor('child');
    if (adult !== null) rates.push({ kind: 'ADULT', amount: adult, currency: 'USD' });
    if (child !== null) rates.push({ kind: 'CHILD', amount: child, currency: 'USD' });
    report(await api('PUT', `${base}/${id}/rates`, { rates }));
  }

  async function addSlot(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const when = new Date(String(f.get('when') ?? ''));
    if (Number.isNaN(when.getTime())) return setMsg(labels.error);
    report(await api('POST', `${base}/${id}/slots`, { startsAt: when.toISOString(), capacity: Number(f.get('capacity')) }));
  }

  return (
    <div className="space-y-8">
      {msg ? (
        <p role="status" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          {msg}
        </p>
      ) : null}

      <form onSubmit={create} className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h3 className="text-lg font-semibold">{labels.newListing}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            {labels.category}
            <select name="category" className={field}>
              {Object.entries(labels.categories).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            {labels.mode}
            <select name="mode" className={field}>
              {Object.entries(labels.modes).map(([k, v]) => (
                <option key={k} value={k} disabled={k === 'REQUEST_TO_BOOK'}>{v}</option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-2">
            {labels.policy}
            <select name="policy" defaultValue="MODERATE" className={field}>
              {Object.entries(labels.policies).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label>{labels.city}<input name="city" maxLength={80} className={field} /></label>
          <label>{labels.meeting}<input name="meeting" maxLength={200} className={field} /></label>
        </div>
        <label className="block">{labels.titleEn}<input name="titleEn" required maxLength={120} className={field} /></label>
        <label className="block">{labels.descEn}<textarea name="descEn" required minLength={50} maxLength={4000} rows={4} className={field} /></label>
        <label className="block">{labels.titleAr}<input name="titleAr" maxLength={120} dir="rtl" className={field} /></label>
        <label className="block">{labels.descAr}<textarea name="descAr" maxLength={4000} rows={3} dir="rtl" className={field} /></label>
        <button disabled={busy} className="min-h-12 rounded-full bg-[var(--brand)] px-6 font-semibold text-[var(--on-brand)] disabled:opacity-60">
          {busy ? labels.working : labels.create}
        </button>
      </form>

      {rows === null ? null : rows.length === 0 ? (
        <p className="text-[var(--muted)]">{labels.none}</p>
      ) : (
        <ul className="space-y-4">
          {rows.map((l) => (
            <li key={l.id} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="font-semibold">
                {l.translations.en?.title ?? Object.values(l.translations)[0]?.title}{' '}
                <span className="text-sm font-normal text-[var(--muted)]">
                  {labels.categories[l.category] ?? l.category} · {labels.modes[l.bookingMode] ?? l.bookingMode} · {labels.statuses[l.status] ?? l.status}
                </span>
              </p>
              <div className="flex gap-2">
                {l.status !== 'PUBLISHED' ? <button className={btn} onClick={() => transition(l.id, 'publish')}>{labels.publish}</button> : null}
                {l.status === 'PUBLISHED' ? <button className={btn} onClick={() => transition(l.id, 'pause')}>{labels.pause}</button> : null}
              </div>
              <details className="rounded-xl border border-[var(--border)] p-3">
                <summary className="cursor-pointer font-semibold">{labels.edit}</summary>
                <form onSubmit={(e) => saveEdit(l.id, e)} className="mt-3 space-y-2">
                  <label className="block">{labels.titleEn}<input name="titleEn" required defaultValue={l.translations.en?.title ?? ''} maxLength={120} className={field} /></label>
                  <label className="block">{labels.descEn}<textarea name="descEn" required minLength={50} defaultValue={l.translations.en?.description ?? ''} maxLength={4000} rows={4} className={field} /></label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label>{labels.city}<input name="city" defaultValue={l.city ?? ''} maxLength={80} className={field} /></label>
                    <label>{labels.meeting}<input name="meeting" defaultValue={l.meetingPoint ?? ''} maxLength={200} className={field} /></label>
                    <label>{labels.policy}
                      <select name="policy" defaultValue={l.cancellationPolicy} className={field}>
                        {Object.entries(labels.policies).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
                      </select>
                    </label>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label>{labels.lat}<input name="lat" type="number" step="any" min={-90} max={90} defaultValue={l.latitude ?? ''} className={field} /></label>
                    <label>{labels.lng}<input name="lng" type="number" step="any" min={-180} max={180} defaultValue={l.longitude ?? ''} className={field} /></label>
                  </div>
                  <p className="text-xs text-[var(--muted)]">{labels.coordsNote}</p>
                  <button className={btn}>{labels.saveEdit}</button>
                </form>
              </details>
              <div className="space-y-2">
                <p className="font-semibold">{labels.photos}</p>
                <ul className="flex flex-wrap gap-2">
                  {l.images.map((im) => (
                    <li key={im.id} className="space-y-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={im.url} alt={im.alt ?? ''} className="h-20 w-28 rounded-lg object-cover" />
                      <button className={btn} onClick={() => removePhoto(l.id, im.id)}>{labels.removePhoto}</button>
                    </li>
                  ))}
                </ul>
                <form onSubmit={(e) => addPhoto(l.id, e)} className="flex flex-wrap items-end gap-2">
                  <label><span className="sr-only">{labels.photos}</span><input name="photo" type="file" accept="image/png,image/jpeg,image/webp" required className={field} /></label>
                  <label>{labels.photoAlt}<input name="alt" maxLength={200} className={field} /></label>
                  <button className={btn}>{labels.addPhoto}</button>
                </form>
                <p className="text-xs text-[var(--muted)]">{labels.photoNote}</p>
              </div>
              {l.bookingMode !== 'DISCOVERY_ONLY' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <form onSubmit={(e) => saveRates(l.id, e)} className="space-y-2">
                    <p className="font-semibold">{labels.rates}</p>
                    <div className="flex gap-2">
                      <label className="flex-1">{labels.adult}<input name="adult" type="number" min={0} step="0.01" className={field} /></label>
                      <label className="flex-1">{labels.child}<input name="child" type="number" min={0} step="0.01" className={field} /></label>
                    </div>
                    <p className="text-xs text-[var(--muted)]">{labels.freeNote}</p>
                    <button className={btn}>{labels.saveRates}</button>
                  </form>
                  <form onSubmit={(e) => addSlot(l.id, e)} className="space-y-2">
                    <p className="font-semibold">{labels.addSlot}</p>
                    <label className="block">{labels.when}<input name="when" type="datetime-local" required className={field} /></label>
                    <label className="block">{labels.capacity}<input name="capacity" type="number" min={1} max={500} defaultValue={10} required className={field} /></label>
                    <button className={btn}>{labels.addSlotCta}</button>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
