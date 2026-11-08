import type { CSSProperties, ReactNode } from 'react';

/**
 * Drifts its child slightly as the page scrolls (CSS scroll-driven animation, transform only, capped
 * travel). No JavaScript; off for reduced motion and touch devices; unsupported browsers show it still.
 */
export function Parallax({ children, speed = 0.15, maxTravel = 40, className = '' }: { children: ReactNode; speed?: number; maxTravel?: number; className?: string }) {
  // Travel over the first screen of scrolling, scaled by speed and capped.
  const travel = Math.min(maxTravel, Math.round(speed * 800));
  return (
    <div className={`parallax ${className}`} style={{ ['--travel' as string]: `${travel}px` } as CSSProperties}>
      {children}
    </div>
  );
}
