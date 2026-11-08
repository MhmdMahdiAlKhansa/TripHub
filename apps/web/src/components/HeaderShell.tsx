'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * The site header. On pages that open with a full-bleed photo (home, experience pages) it floats
 * transparently over the image and becomes solid once the page is scrolled; elsewhere it is always solid.
 */
export function HeaderShell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? '';
  // Every page opens with the hero photo band, so the header always floats over it first.
  const overPhoto = /^\/(en|ar)(\/|$)/.test(path);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [path]);

  const floating = overPhoto && !scrolled;
  return (
    <header
      className={`${overPhoto ? 'fixed inset-x-0 top-0' : 'sticky top-0'} z-30 transition-colors duration-300 ${
        floating ? 'header-hero border-b border-transparent' : 'border-b border-[var(--border)] bg-[var(--bg)]/92 backdrop-blur'
      }`}
    >
      {children}
    </header>
  );
}
