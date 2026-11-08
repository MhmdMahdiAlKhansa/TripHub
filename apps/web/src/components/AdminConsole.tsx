'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface Company { id: string; name: string; city: string | null; submittedAt: string | null }
interface Doc { id: string; kind: string; name: string; scanStatus: string; sizeBytes: number }
interface Pay { id: string; method: string; amountMinor: string; currency: string; reference: string | null; bookingReference: string; customerEmail: string }

export interface AdminLabels {
  signIn: string; loginCta: string; working: string; notStaff: string; error: string;
  companies: string; noCompanies: string; documents: string; noDocuments: string; notScanned: string; download: string;
  approve: string; changes: string; reject: string; reasonLabel: string; submit: string;
  payments: string; noPayments: string; verify: string; rejectPay: string; unverifiedNote: string; reference: string;
  stepUpTitle: string; password: string; code: string; stepUpCta: string;
}

type Me = { platformRole: string; mfaEnabled: boolean };

async function api(method: string, url: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  }).catch(() => null);
  let json: { code?: string } & Record<string, unknown> = {};
  try {
    json = r ? await r.json() : {};
  } catch {
    /* empty body */
  }
  return { status: r?.status ?? 0, ok: !!r?.ok, json };
}

export function AdminConsole({ locale, labels, children }: { locale: string; labels: AdminLabels; children?: React.ReactNode }) {
  const [me, setMe] = useState<'loading' | 'out' | Me>('loading');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [docs, setDocs] = useState<Record<string, Doc[]>>({});
  const [pays, setPays] = useState<Pay[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [needStepUp, setNeedStepUp] = useState<null | (() => Promise<void>)>(null);
  const [decide, setDecide] = useState<{ id: string; decision: 'CHANGES_REQUESTED' | 'REJECTED' | 'payment' } | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    const meRes = await api('GET', '/api/v1/auth/me');
    if (!meRes.ok) return setMe('out');
    const user = (meRes.json as unknown as { user: Me }).user;
    setMe(user);
    if (user.platformRole === 'NONE') return;
    const c = await api('GET', '/api/v1/admin/companies?status=PENDING_REVIEW');
    if (c.ok) setCompanies((c.json as unknown as { companies: Company[] }).companies);
    const p = await api('GET', '/api/v1/admin/payments?status=PROOF_SUBMITTED');
    if (p.ok) setPays((p.json as unknown as { payments: Pay[] }).payments);
    else setPays([]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function showDocs(id: string) {
    const r = await api('GET', `/api/v1/admin/companies/${id}/documents`);
    if (r.ok) setDocs((d) => ({ ...d, [id]: (r.json as unknown as { documents: Doc[] }).documents }));
  }

  /** Runs a sensitive action; if the API asks for step-up, shows the password prompt and retries once. */
  async function sensitive(run: () => Promise<{ ok: boolean; json: { code?: string } }>) {
    setMsg(null);
    const r = await run();
    if (!r.ok && r.json.code === 'step_up_required') {
      setNeedStepUp(() => async () => {
        const again = await run();
        setMsg(again.ok ? null : labels.error);
        await load();
      });
      return;
    }
    setMsg(r.ok ? null : labels.error);
    setDecide(null);
    setReason('');
    await load();
  }

  if (me === 'loading') return <p className="text-[var(--muted)]">{labels.working}</p>;
  if (me === 'out') {
    return (
      <p>
        {labels.signIn}{' '}
        <Link href={`/${locale}/login`} className="text-[var(--brand)] underline">
          {labels.loginCta}
        </Link>
      </p>
    );
  }
  if (me.platformRole === 'NONE') return <p className="text-[var(--muted)]">{labels.notStaff}</p>;

  const btn = 'min-h-11 rounded-full border border-[var(--border)] px-4 text-sm font-semibold disabled:opacity-60';
  const input = 'mt-1 block min-h-12 w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4';

  return (
    <div className="space-y-8">
      {msg ? (
        <p role="alert" className="rounded-xl border border-red-500 px-4 py-3">
          {msg}
        </p>
      ) : null}

      {needStepUp ? (
        <form
          className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const code = String(f.get('code') ?? '').trim();
            const r = await api('POST', '/api/v1/auth/step-up', { password: String(f.get('password') ?? ''), ...(code ? { code } : {}) });
            if (!r.ok) return setMsg(labels.error);
            const retry = needStepUp;
            setNeedStepUp(null);
            await retry();
          }}
        >
          <h2 className="text-lg font-semibold">{labels.stepUpTitle}</h2>
          <label className="block">
            {labels.password}
            <input name="password" type="password" required autoComplete="current-password" dir="ltr" className={input} />
          </label>
          <label className="block">
            {labels.code}
            <input name="code" autoComplete="one-time-code" maxLength={32} dir="ltr" className={input} />
          </label>
          <button className="min-h-12 rounded-full bg-[var(--brand)] px-6 font-semibold text-[var(--on-brand)]">{labels.stepUpCta}</button>
        </form>
      ) : null}

      <section aria-labelledby="cq" className="space-y-3">
        <h2 id="cq" className="text-xl font-semibold">{labels.companies}</h2>
        {companies.length === 0 ? <p className="text-[var(--muted)]">{labels.noCompanies}</p> : null}
        <ul className="space-y-3">
          {companies.map((c) => (
            <li key={c.id} className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="font-semibold">{c.name} <span className="text-sm font-normal text-[var(--muted)]">{c.city ?? ''}</span></p>
              <button className={btn} onClick={() => showDocs(c.id)}>{labels.documents}</button>
              {docs[c.id] ? (
                docs[c.id]!.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">{labels.noDocuments}</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {docs[c.id]!.map((d) => (
                      <li key={d.id}>
                        {d.kind} · {d.name} ·{' '}
                        <span className="text-[var(--muted)]">{d.scanStatus === 'PENDING' ? labels.notScanned : d.scanStatus}</span> ·{' '}
                        <a className="text-[var(--brand)] underline" href={`/api/v1/admin/documents/${d.id}/download`}>{labels.download}</a>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button className={btn} onClick={() => sensitive(() => api('POST', `/api/v1/admin/companies/${c.id}/review`, { decision: 'APPROVED' }))}>{labels.approve}</button>
                <button className={btn} onClick={() => setDecide({ id: c.id, decision: 'CHANGES_REQUESTED' })}>{labels.changes}</button>
                <button className={btn} onClick={() => setDecide({ id: c.id, decision: 'REJECTED' })}>{labels.reject}</button>
              </div>
              {decide?.id === c.id && decide.decision !== 'payment' ? (
                <div className="flex gap-2">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} aria-label={labels.reasonLabel} placeholder={labels.reasonLabel} maxLength={1000} className="min-h-11 flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3" />
                  <button className={btn} disabled={reason.trim().length < 10} onClick={() => sensitive(() => api('POST', `/api/v1/admin/companies/${c.id}/review`, { decision: decide.decision, reason: reason.trim() }))}>{labels.submit}</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="pq" className="space-y-3">
        <h2 id="pq" className="text-xl font-semibold">{labels.payments}</h2>
        <p className="text-sm text-[var(--muted)]">{labels.unverifiedNote}</p>
        {pays.length === 0 ? <p className="text-[var(--muted)]">{labels.noPayments}</p> : null}
        <ul className="space-y-3">
          {pays.map((p) => (
            <li key={p.id} className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <p className="font-semibold">
                <span dir="ltr">{p.bookingReference}</span> · {p.method} · {Number(p.amountMinor) / 100} {p.currency}
              </p>
              <p className="text-sm text-[var(--muted)]">
                {labels.reference}: <span dir="ltr">{p.reference ?? '-'}</span> · <span dir="ltr">{p.customerEmail}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <button className={btn} onClick={() => sensitive(() => api('POST', `/api/v1/admin/payments/${p.id}/verify`))}>{labels.verify}</button>
                <button className={btn} onClick={() => setDecide({ id: p.id, decision: 'payment' })}>{labels.rejectPay}</button>
              </div>
              {decide?.id === p.id && decide.decision === 'payment' ? (
                <div className="flex gap-2">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} aria-label={labels.reasonLabel} placeholder={labels.reasonLabel} maxLength={500} className="min-h-11 flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3" />
                  <button className={btn} disabled={reason.trim().length < 10} onClick={() => sensitive(() => api('POST', `/api/v1/admin/payments/${p.id}/reject`, { reason: reason.trim() }))}>{labels.submit}</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      {children}
    </div>
  );
}
