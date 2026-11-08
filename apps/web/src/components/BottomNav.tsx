'use client';

import type { Locale } from '@triphub/shared';
import { cx } from '@triphub/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

interface Item {
  href: string;
  label: string;
  icon: ReactNode;
}

const svg = (d: string) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function BottomNav({
  locale,
  labels,
  ariaLabel,
}: {
  locale: Locale;
  labels: { home: string; explore: string; saved: string; profile: string };
  ariaLabel: string;
}) {
  const pathname = usePathname() ?? '';
  const items: Item[] = [
    { href: `/${locale}`, label: labels.home, icon: svg('M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10') },
    { href: `/${locale}/explore`, label: labels.explore, icon: svg('M21 21l-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z') },
    { href: `/${locale}/saved`, label: labels.saved, icon: svg('M12 21s-7-4.4-9.3-9A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9.3 6c-2.3 4.6-9.3 9-9.3 9z') },
    { href: `/${locale}/profile`, label: labels.profile, icon: svg('M20 21a8 8 0 0 0-16 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z') },
  ];

  return (
    <nav
      aria-label={ariaLabel}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)] md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {items.map((it) => {
          const active = it.href === `/${locale}` ? pathname === it.href : pathname.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium',
                  active ? 'text-[var(--brand)]' : 'text-[var(--muted)]',
                )}
              >
                {it.icon}
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
