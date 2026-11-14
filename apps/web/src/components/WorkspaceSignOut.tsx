'use client';

export function WorkspaceSignOut({ locale, label }: { locale: string; label: string }) {
  return (
    <button
      className="inline-flex min-h-11 items-center rounded-full px-3 hover:bg-white/10"
      onClick={async () => {
        await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
        window.location.assign(`/${locale}`);
      }}
    >
      {label}
    </button>
  );
}
