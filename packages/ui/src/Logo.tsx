import type { SVGProps } from 'react';

/**
 * TripHub "Discovery Emblem": an original mark - a rounded diamond (a waypoint) holding a
 * compass needle that points up and onward. Colours come from the theme via currentColor.
 */
export function LogoMark({ title, ...props }: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={32}
      height={32}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      {...props}
    >
      <rect x="6" y="6" width="36" height="36" rx="11" transform="rotate(45 24 24)" fill="currentColor" />
      <path d="M24 12 L29 26 L24 23 L19 26 Z" fill="var(--logo-needle, #f7f8f3)" />
      <path d="M24 36 L19 26 L24 23 L29 26 Z" fill="var(--logo-needle, #f7f8f3)" opacity="0.55" />
    </svg>
  );
}
