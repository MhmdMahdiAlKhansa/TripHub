'use client';

import { useCallback, useEffect, useState } from 'react';

type Json = Record<string, unknown>;

export interface QueueAction {
  /** Label shown on the button. */
  label: string;
  /** POST path; `{id}` is replaced with the row id. */
  path: string;
  /** What extra input the API needs: nothing, a written reason, or a transfer method + reference. */
  input?: 'reason' | 'reference' | 'method-reference';
  /** Fixed extra fields sent with the request (for example the review status). */
  extra?: Record<string, unknown>;
}
export interface QueueConfig {
  title: string;
  empty: string;
  listUrl: string;
  /** Property of the response that holds the rows. */
  rowsKey: string;
  /** Row fields to display as "Label: value". */
  fields: Array<{ label: string; path: string }>;
  actions: QueueAction[];
}
export interface QueueLabels {
  reasonLabel: string; referenceLabel: string; methodLabel: string; submit: string; error: string;
  stepUpTitle: string; password: string; code: string; stepUpCta: string; working: string;
}

const pick = (o: unknown, path: string): string => {
  const v = path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Json)[k] : undefined), o);
  if (v === null || v === undefined) return '-';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

async function api(method: string, url: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  }).catch(() => null);
  let json: Json = {};
  try {
    json = r ? await r.json() : {};
  } catch {
    /* empty body */
  }
  return { ok: !!r?.ok, status: r?.status ?? 0, json };
}

const btn = 'min-h-11 rounded-full border border-[var(--border)] px-4 text-sm font-semibold disabled:opacity-60';
const input = 'min-h-11 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3';

/** A staff work queue: list rows from an admin endpoint and run actions on them, with step-up when required. */
export function AdminQueue({ config, labels }: { config: QueueConfig; labels: QueueLabels }) {
  const [rows, setRows] = useState<Json[] | null>(null);
  const [open, setOpen] = useState<{ id: string; action: QueueAction } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [retry, setRetry] = useState<null | (() => Promise<void>)>(null);

  const load = useCallback(async () => {
    const r = await api('GET', config.listUrl);
    setRows(r.ok ? ((r.json[config.rowsKey] as Json[]) ?? []) : []);
  }, [config.listUrl, config.rowsKey]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(id: string, action: QueueAction, body: Json) {
    const go = async () => api('POST', action.path.replace('{id}', id), body);
    setMsg(null);
    const r = await go();
    if (!r.ok && (r.json as { code?: string }).code === 'step_up_required') {
      setRetry(() => async () => {
        const again = await go();
        setMsg(again.ok ? null : labels.error);
        setOpen(null);
        await load();
      });
      return;
    }
    setMsg(r.ok ? null : labels.error);
    setOpen(null);
    await load();
  }

  return (
    <section aria-label={config.title} className="space-y-3">
      <h2 className="text-xl font-semibold">{config.title}</h2>
      {msg ? <p role="alert" className="rounded-xl border border-red-500 px-4 py-2">{msg}</p> : null}

      {retry ? (
        <form
          className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const code = String(f.get('code') ?? '').trim();
            const r = await api('POST', '/api/v1/auth/step-up', { password: String(f.get('password') ?? ''), ...(code ? { code } : {}) });
            if (!r.ok) return setMsg(labels.error);
            const go = retry;
            setRetry(null);
            await go();
          }}
        >
          <p className="font-semibold">{labels.stepUpTitle}</p>
          <label className="block">{labels.password}<input name="password" type="password" required autoComplete="current-password" dir="ltr" className={`${input} mt-1 block w-full max-w-sm`} /></label>
          <label className="block">{labels.code}<input name="code" autoComplete="one-time-code" maxLength={32} dir="ltr" className={`${input} mt-1 block w-full max-w-sm`} /></label>
          <button className="min-h-11 rounded-full bg-[var(--brand)] px-5 font-semibold text-[var(--on-brand)]">{labels.stepUpCta}</button>
        </form>
      ) : null}

      {rows === null ? null : rows.length === 0 ? (
        <p className="text-[var(--muted)]">{config.empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const id = String(row.id);
            return (
              <li key={id} className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  {config.fields.map((f) => (
                    <div key={f.path} className="flex gap-2">
                      <dt className="text-[var(--muted)]">{f.label}:</dt>
                      <dd className="break-all" dir="auto">{pick(row, f.path)}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-2">
                  {config.actions.map((a) => (
                    <button
                      key={a.label}
                      className={btn}
                      onClick={() => (a.input ? setOpen(open?.id === id && open.action === a ? null : { id, action: a }) : run(id, a, {}))}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                {open?.id === id ? (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      const a = open.action;
                      const body: Json = { ...(a.extra ?? {}), ...(
                        a.input === 'reason' ? { reason: String(f.get('reason') ?? '').trim() }
                        : a.input === 'reference' ? { payoutReference: String(f.get('reference') ?? '').trim() }
                        : { method: String(f.get('method')), reference: String(f.get('reference') ?? '').trim() }) };
                      void run(id, a, body);
                    }}
                  >
                    {open.action.input === 'reason' ? (
                      <label>{labels.reasonLabel}<input name="reason" required minLength={10} maxLength={500} className={`${input} mt-1 block w-72`} /></label>
                    ) : null}
                    {open.action.input === 'method-reference' ? (
                      <label>{labels.methodLabel}
                        <select name="method" className={`${input} mt-1 block`}>
                          <option>WHISH</option><option>OMT</option><option>BANK</option>
                        </select>
                      </label>
                    ) : null}
                    {open.action.input === 'reference' || open.action.input === 'method-reference' ? (
                      <label>{labels.referenceLabel}<input name="reference" required minLength={4} maxLength={64} dir="ltr" className={`${input} mt-1 block w-56`} /></label>
                    ) : null}
                    <button className={btn}>{labels.submit}</button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
