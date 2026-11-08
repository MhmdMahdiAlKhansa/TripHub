'use client';

import { useState } from 'react';

/** A listing photo that falls back to a brand gradient if the file cannot be loaded (never a broken-image icon). */
export function CoverImage({ src, srcSet, sizes, alt, className = '' }: { src: string; srcSet: string; sizes: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div aria-hidden="true" className={className} style={{ background: 'linear-gradient(135deg, #0a6fd8 0%, #1fa3b8 100%)' }} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} srcSet={srcSet} sizes={sizes} width={640} height={480} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className={className} />
  );
}
