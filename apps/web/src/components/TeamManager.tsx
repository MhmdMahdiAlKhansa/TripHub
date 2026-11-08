'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface Member { id: string; role: string; user: { id: string; email: string; displayName: string | null } }
export interface TeamLabels {
  title: string; invite: string; email: string; role: string; send: string; remove: string; change: string; roles: Record<string, string>;
  invited: string; error: string; limit: string; stepUp: string; password: string; code: string; confirm: string; inviteNote: string;
}

async function api(method: string, url: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  }).catch(() => null);
  let json: { code?: string } = {};
  try {
    json = r ? await r.json() : {};
  } catch {
    /* empty body */
  }
  return { ok: !!r?.ok, json };
}

const field = 'mt-1 block min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3';
const btn = 'min-h-11 rounded-full border border-[var(--border)] px-4 text-sm font-semibold disabled:opacity-60';

export function TeamManager({ companyId, labels }: { companyId: string; labels: TeamLabels }) {
  const [rows, setRows] = useState<Member[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [retry, setRetry] = useState<null | (() => Promise<void>)>(null);
  const base = `/api/v1/companies/${companyId}`;

  const load = useCallback(async () => {
    const r = await api('GET', `${base}/members`);
    setRows(r.ok ? (r.json as unknown as { members: Member[] }).members : []);
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Role changes and removals need a recent password confirmation; prompt once and retry. */
  async function sensitive(run: () => Promise<{ ok: boolean; json: { code?: string } }>) {
    setMsg(null);
    const r = await run();
    if (!r.ok && r.json.code === 'step_up_required') {
      setRetry(() => async () => {
        const again = await run();
        setMsg(again.ok ? null : labels.error);
        await load();
      });
      return;
    }
    setMsg(r.ok ? null : labels.error);
    await load();
  }

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const r = await api('POST', `${base}/invitations`, { email: String(f.get('email')).trim(), role: String(f.get('role')) });
    if (r.ok) {
      setMsg(labels.invited);
      form.reset();
    } else setMsg(r.json.code === 'plan_limit_reached' ? labels.limit : labels.error);
  }

  return (
    <section aria-labelledby="team" className="space-y-4">
      <h2 id="team" className="text-xl font-semibold">{labels.title}</h2>
      {msg ? <p role="status" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2">{msg}</p> : null}

      {retry ? (
        <form
          className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const code = String(f.get('code') ?? '').trim();
            const r = await api('POST', '/api/v1/auth/step-up', { password: String(f.get('password') ?? ''), ...(code ? { code } : {}) });
            if (!r.ok) return setMsg(labels.error);
            const run = retry;
            setRetry(null);
            await run();
          }}
        >
          <p className="font-semibold">{labels.stepUp}</p>
          <label className="block">{labels.password}<input name="password" type="password" required autoComplete="current-password" dir="ltr" className={field} /></label>
          <label className="block">{labels.code}<input name="code" autoComplete="one-time-code" maxLength={32} dir="ltr" className={field} /></label>
          <button className="min-h-11 rounded-full bg-[var(--brand)] px-5 font-semibold text-[var(--on-brand)]">{labels.confirm}</button>
        </form>
      ) : null}

      {rows === null ? null : (
        <ul className="space-y-2">
          {rows.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <span>
                <strong>{m.user.displayName ?? ''}</strong> <span dir="ltr">{m.user.email}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`${labels.role}: ${m.user.email}`}
                  value={m.role}
                  onChange={(e) => sensitive(() => api('PATCH', `${base}/members/${m.id}`, { role: e.target.value }))}
                  className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-2"
                >
                  {Object.entries(labels.roles).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
                </select>
                <button className={btn} onClick={() => sensitive(() => api('DELETE', `${base}/members/${m.id}`))}>{labels.remove}</button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={invite} className="grid max-w-xl gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label>{labels.email}<input name="email" type="email" required dir="ltr" className={field} /></label>
        <label>{labels.role}
          <select name="role" defaultValue="BOOKING_STAFF" className={field}>
            {Object.entries(labels.roles).filter(([k]) => k !== 'OWNER').map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
          </select>
        </label>
        <button className="min-h-11 rounded-full bg-[var(--brand)] px-5 font-semibold text-[var(--on-brand)]">{labels.send}</button>
        <p className="text-xs text-[var(--muted)] sm:col-span-3">{labels.inviteNote}</p>
      </form>
    </section>
  );
}
