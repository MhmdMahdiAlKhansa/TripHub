import type { ReactNode } from 'react';

/** "Continue with Google" button + divider + optional error. A plain link: the whole flow is server-side. */
export function GoogleButton({ locale, label, or, error }: { locale: string; label: string; or: string; error?: ReactNode }) {
  return (
    <div className="max-w-md space-y-4">
      {error ? (
        <p role="alert" className="rounded-xl border border-red-500 bg-[var(--surface)] px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}
      <a
        href={`/api/v1/auth/google/start?locale=${locale}`}
        className="flex min-h-12 items-center justify-center gap-3 rounded-full border border-[var(--border)] bg-white px-6 font-semibold text-[#1f1f1f] shadow-sm transition hover:shadow-md"
      >
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.2-3.9 7.2-9.6 7.2-16.9z" />
          <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
          <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.3-8.8 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
        </svg>
        {label}
      </a>
      <p className="text-center text-sm text-[var(--muted)]">{or}</p>
    </div>
  );
}
