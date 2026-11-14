'use client';

import { useState, type ReactNode } from 'react';

export interface WorkspaceTab { id: string; label: string; node: ReactNode }

/**
 * The shell of a role's own desk: a coloured header that says whose desk this is and what it is for, then
 * only the tabs that role works in. Every role gets its own colour, title and set of tabs.
 */
export function WorkspaceTabs({ kicker, title, subtitle, accent, tabs }: { kicker: string; title: string; subtitle: string; accent: string; tabs: WorkspaceTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  const current = tabs.find((x) => x.id === active) ?? tabs[0];
  return (
    <div className="space-y-6">
      {/* Navy panel with the role's colour as a stripe: white text on navy keeps AA contrast for every desk colour. */}
      <header className="rounded-3xl bg-[#082a5a] p-6 text-white md:p-8" style={{ borderInlineStart: `12px solid ${accent}`, backgroundImage: `linear-gradient(135deg, ${accent}33 0%, transparent 60%)` }}>
        <p className="text-sm font-bold uppercase tracking-wide opacity-90">{kicker}</p>
        <h1 className="mt-1 text-3xl font-bold md:text-4xl">{title}</h1>
        <p className="mt-2 max-w-2xl opacity-95">{subtitle}</p>
      </header>
      {tabs.length > 1 ? (
        <div role="tablist" aria-label={title} className="flex flex-wrap gap-2">
          {tabs.map((x) => (
            <button
              key={x.id}
              role="tab"
              id={`tab-${x.id}`}
              aria-selected={x.id === current?.id}
              aria-controls={`panel-${x.id}`}
              onClick={() => setActive(x.id)}
              className={`min-h-11 rounded-full border-2 px-5 text-sm font-semibold ${x.id === current?.id ? 'bg-[#082a5a] text-white' : 'border-[var(--border)] bg-[var(--surface)]'}`}
              style={x.id === current?.id ? { borderColor: accent } : undefined}
            >
              {x.label}
            </button>
          ))}
        </div>
      ) : null}
      {current ? (
        <div role="tabpanel" id={`panel-${current.id}`} aria-labelledby={`tab-${current.id}`} className="space-y-6">
          {current.node}
        </div>
      ) : null}
    </div>
  );
}
