'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface Profile {
  status: string;
  name: string;
  description: string | null;
  contactEmail: string | null;
  phone: string | null;
  city: string | null;
  categories: string[];
  languages: string[];
}
interface Doc { id: string; kind: string; name: string; scanStatus: string }

export interface OnboardingLabels {
  title: string; status: string; statuses: Record<string, string>; editable: string; pendingNote: string;
  name: string; description: string; contactEmail: string; phone: string; city: string; categories: string; languages: string; save: string;
  docs: string; docKind: string; docKinds: Record<string, string>; upload: string; docNote: string; notScanned: string; remove: string;
  submit: string; submitNote: string; saved: string; error: string; missing: string; working: string;
  categoryNames: Record<string, string>; languageNames: Record<string, string>;
}

const field = 'mt-1 block min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3';
const btn = 'min-h-11 rounded-full border border-[var(--border)] px-4 text-sm font-semibold disabled:opacity-60';

async function api(method: string, url: string, body?: unknown, raw?: { data: ArrayBuffer; type: string }) {
  const r = await fetch(url, {
    method,
    headers: raw ? { 'content-type': raw.type } : body === undefined ? undefined : { 'content-type': 'application/json' },
    body: raw ? raw.data : body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  }).catch(() => null);
  let json: Record<string, unknown> = {};
  try {
    json = r ? await r.json() : {};
  } catch {
    /* empty body */
  }
  return { ok: !!r?.ok, json };
}

export function CompanyOnboarding({ companyId, labels }: { companyId: string; labels: OnboardingLabels }) {
  const [p, setP] = useState<Profile | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const base = `/api/v1/companies/${companyId}`;

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([api('GET', `${base}/profile`), api('GET', `${base}/documents`)]);
    if (a.ok) setP((a.json as { company: Profile }).company);
    if (b.ok) setDocs((b.json as { documents: Doc[] }).documents);
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!p) return null;
  const editable = ['DRAFT', 'CHANGES_REQUESTED', 'APPROVED'].includes(p.status);
  const canSubmit = ['DRAFT', 'CHANGES_REQUESTED'].includes(p.status);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const r = await api('PATCH', `${base}/profile`, {
      name: s('name'),
      description: s('description'),
      contactEmail: s('contactEmail'),
      phone: s('phone'),
      city: s('city'),
      categories: f.getAll('categories').map(String),
      languages: f.getAll('languages').map(String),
    });
    setMsg(r.ok ? labels.saved : labels.error);
    await load();
  }

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const file = f.get('file');
    if (!(file instanceof File) || file.size === 0) return setMsg(labels.error);
    const r = await api(
      'PUT',
      `${base}/documents?kind=${encodeURIComponent(String(f.get('kind')))}&name=${encodeURIComponent(file.name)}`,
      undefined,
      { data: await file.arrayBuffer(), type: file.type || 'application/octet-stream' },
    );
    setMsg(r.ok ? labels.saved : labels.error);
    if (r.ok) form.reset();
    await load();
  }

  async function removeDoc(id: string) {
    await api('DELETE', `${base}/documents/${id}`);
    await load();
  }

  async function submit() {
    const r = await api('POST', `${base}/submit`);
    const missing = (r.json as { missing?: string[] }).missing;
    setMsg(r.ok ? labels.saved : missing?.length ? `${labels.missing} ${missing.join(', ')}` : labels.error);
    await load();
  }

  return (
    <section aria-labelledby="onb" className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 id="onb" className="text-xl font-semibold">{labels.title}</h2>
      <p>
        {labels.status}: <strong>{labels.statuses[p.status] ?? p.status}</strong>
      </p>
      {p.status === 'PENDING_REVIEW' ? <p className="text-[var(--muted)]">{labels.pendingNote}</p> : null}
      {msg ? <p role="status" className="rounded-xl border border-[var(--border)] px-4 py-2">{msg}</p> : null}

      {editable ? (
        <>
          <form onSubmit={save} className="space-y-3">
            <label className="block">{labels.name}<input name="name" required defaultValue={p.name} maxLength={120} className={field} /></label>
            <label className="block">{labels.description}<textarea name="description" defaultValue={p.description ?? ''} maxLength={2000} rows={3} className={field} /></label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label>{labels.contactEmail}<input name="contactEmail" type="email" defaultValue={p.contactEmail ?? ''} dir="ltr" className={field} /></label>
              <label>{labels.phone}<input name="phone" defaultValue={p.phone ?? ''} dir="ltr" className={field} /></label>
              <label>{labels.city}<input name="city" defaultValue={p.city ?? ''} maxLength={80} className={field} /></label>
            </div>
            <fieldset className="flex flex-wrap gap-4">
              <legend>{labels.categories}</legend>
              {Object.entries(labels.categoryNames).map(([k, v]) => (
                <label key={k} className="flex items-center gap-2"><input type="checkbox" name="categories" value={k} defaultChecked={p.categories.includes(k)} />{v}</label>
              ))}
            </fieldset>
            <fieldset className="flex flex-wrap gap-4">
              <legend>{labels.languages}</legend>
              {Object.entries(labels.languageNames).map(([k, v]) => (
                <label key={k} className="flex items-center gap-2"><input type="checkbox" name="languages" value={k} defaultChecked={p.languages.includes(k)} />{v}</label>
              ))}
            </fieldset>
            <button className="min-h-12 rounded-full bg-[var(--brand)] px-6 font-semibold text-[var(--on-brand)]">{labels.save}</button>
          </form>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold">{labels.docs}</h3>
            <p className="text-sm text-[var(--muted)]">{labels.docNote}</p>
            <ul className="space-y-1 text-sm">
              {docs.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2">
                  {labels.docKinds[d.kind] ?? d.kind} · {d.name} · <span className="text-[var(--muted)]">{labels.notScanned}</span>
                  <button className={btn} onClick={() => removeDoc(d.id)}>{labels.remove}</button>
                </li>
              ))}
            </ul>
            <form onSubmit={upload} className="flex flex-wrap items-end gap-3">
              <label>{labels.docKind}
                <select name="kind" className={field}>
                  {Object.entries(labels.docKinds).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
                </select>
              </label>
              <label>
                <span className="sr-only">{labels.docs}</span>
                <input name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required className={field} />
              </label>
              <button className={btn}>{labels.upload}</button>
            </form>
          </div>

          {canSubmit ? (
            <div className="space-y-2">
              <p className="text-sm text-[var(--muted)]">{labels.submitNote}</p>
              <button onClick={submit} className="min-h-12 rounded-full bg-[var(--brand)] px-6 font-semibold text-[var(--on-brand)]">{labels.submit}</button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
