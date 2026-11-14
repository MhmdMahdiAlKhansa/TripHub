'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Staff and business pages are working tools, not the public site: they get their own frame instead of the marketing chrome. */
const WORKSPACE = /^\/(en|ar)\/(admin|business)(\/|$)/;

export const useIsWorkspace = () => WORKSPACE.test(usePathname() ?? '');

/** Shows its children only on public pages (`mode="public"`) or only inside a workspace (`mode="workspace"`). */
export function ChromeGate({ mode, children }: { mode: 'public' | 'workspace'; children: ReactNode }) {
  const inWorkspace = useIsWorkspace();
  return (mode === 'workspace') === inWorkspace ? <>{children}</> : null;
}

/** The page body: roomy under the transparent public header, compact and wide inside a workspace. */
export function MainFrame({ children }: { children: ReactNode }) {
  const inWorkspace = useIsWorkspace();
  return (
    <main id="main" className={inWorkspace ? 'mx-auto max-w-7xl px-4 pb-12 pt-6' : 'mx-auto max-w-6xl px-4 pb-8 pt-24'}>
      {children}
    </main>
  );
}
