'use client';

import { useEffect, useState } from 'react';

const KEY = 'th_theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeToggle({ label }: { label: string }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    setDark(attr ? attr === 'dark' : systemPrefersDark());
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
    try {
      localStorage.setItem(KEY, next ? 'dark' : 'light');
    } catch {
      /* storage blocked: the choice simply won't persist */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label={label}
      className="inline-flex size-11 items-center justify-center rounded-full hover:bg-[var(--surface-2)]"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        {dark ? (
          <path d="M12 3a1 1 0 0 0 0 18 9 9 0 0 0 9-9 7 7 0 0 1-9-9z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
      </svg>
    </button>
  );
}

/** Runs before first paint to avoid a theme flash. Static string, no user input. */
export const themeInitScript = `try{var t=localStorage.getItem('${KEY}');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;
