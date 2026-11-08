import type { ReactNode } from 'react';
import { HeroBackdrop } from './HeroBackdrop';

/**
 * The title band at the top of every inner page. It uses the same photograph, scrim and type as the home
 * hero so the whole site feels like one continuous place; the header floats over it. Server-rendered,
 * no JavaScript of its own.
 */
export function PageHero({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <section className="full-bleed relative -mt-24 mb-8 flex min-h-[30svh] items-end overflow-hidden text-white">
      <HeroBackdrop pauseLabel="" playLabel="" />
      <div aria-hidden="true" className="hero-scrim absolute inset-0" />
      <div aria-hidden="true" className="hero-fade absolute inset-x-0 bottom-0 h-20" />
      <div className="relative z-10 mx-auto w-full max-w-6xl space-y-2 px-4 pb-10 pt-28">
        <h1 className="max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">{title}</h1>
        {subtitle ? <p className="max-w-2xl text-lg text-[#e4effb]">{subtitle}</p> : null}
        {children}
      </div>
    </section>
  );
}
