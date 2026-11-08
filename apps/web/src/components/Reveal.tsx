import type { ElementType, ReactNode } from 'react';

/**
 * Fades and lifts its children into view as they scroll on screen. This is pure CSS (scroll-driven
 * animation, see globals.css), so it ships no JavaScript, content is always in the HTML, and browsers
 * without support or visitors who prefer reduced motion simply see the content in place.
 */
export function Reveal({ children, as: Tag = 'div', className = '' }: { children: ReactNode; delay?: number; as?: ElementType; className?: string }) {
  return <Tag className={`reveal ${className}`}>{children}</Tag>;
}
