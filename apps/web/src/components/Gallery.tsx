'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Img { id: string; url: string; alt: string | null }
export interface GalleryLabels { open: string; close: string; previous: string; next: string; of: string }

/**
 * Photo grid with a lightbox. The lightbox uses the native <dialog>, so focus is trapped, Escape closes
 * it and focus returns to the photo that opened it. Arrow keys move between photos (mirrored in RTL).
 */
export function Gallery({ images, labels, ariaLabel }: { images: Img[]; labels: GalleryLabels; ariaLabel: string }) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const close = useCallback(() => dialog.current?.close(), []);
  const step = useCallback((d: number) => setIndex((i) => (i === null ? i : (i + d + images.length) % images.length)), [images.length]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (index !== null && !el.open) el.showModal();
  }, [index]);

  function onKey(e: React.KeyboardEvent) {
    const rtl = document.documentElement.dir === 'rtl';
    if (e.key === 'ArrowRight') step(rtl ? -1 : 1);
    if (e.key === 'ArrowLeft') step(rtl ? 1 : -1);
  }

  if (images.length === 0) return null;
  const current = index === null ? null : images[index];
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label={ariaLabel}>
        {images.map((im, i) => (
          <li key={im.id} className={i === 0 ? 'col-span-2 sm:col-span-3' : ''}>
            <button
              type="button"
              aria-label={`${labels.open} ${i + 1} ${labels.of} ${images.length}${im.alt ? `: ${im.alt}` : ''}`}
              onClick={(e) => {
                opener.current = e.currentTarget;
                setIndex(i);
              }}
              className="card-lift block w-full overflow-hidden rounded-2xl"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${im.url}?w=640`} srcSet={`${im.url}?w=640 640w, ${im.url}?w=1280 1280w`} sizes="(min-width: 640px) 33vw, 50vw" alt={im.alt ?? ''} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" className={`card-img w-full object-cover ${i === 0 ? 'aspect-[16/8]' : 'aspect-[4/3]'}`} />
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialog}
        onClose={() => {
          setIndex(null);
          opener.current?.focus();
        }}
        onKeyDown={onKey}
        aria-label={ariaLabel}
        className="m-auto h-[92vh] w-[96vw] max-w-6xl rounded-3xl bg-[#263c36] p-0 text-[#f7f8f3] backdrop:bg-black/80"
      >
        {current ? (
          <div className="relative flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 p-3">
              <p className="text-sm" aria-live="polite">
                {(index ?? 0) + 1} {labels.of} {images.length}
                {current.alt ? ` · ${current.alt}` : ''}
              </p>
              <button type="button" onClick={close} className="min-h-11 rounded-full bg-[#f7f8f3] px-5 text-sm font-semibold text-[#263c36]">
                {labels.close}
              </button>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current.url} alt={current.alt ?? ''} className="max-h-full max-w-full rounded-xl object-contain" />
              {images.length > 1 ? (
                <>
                  <button type="button" onClick={() => step(-1)} aria-label={labels.previous} className="absolute start-3 top-1/2 min-h-12 min-w-12 -translate-y-1/2 rounded-full bg-[#f7f8f3] text-xl font-bold text-[#263c36]">
                    <span aria-hidden="true" className="rtl:hidden">‹</span>
                    <span aria-hidden="true" className="hidden rtl:inline">›</span>
                  </button>
                  <button type="button" onClick={() => step(1)} aria-label={labels.next} className="absolute end-3 top-1/2 min-h-12 min-w-12 -translate-y-1/2 rounded-full bg-[#f7f8f3] text-xl font-bold text-[#263c36]">
                    <span aria-hidden="true" className="rtl:hidden">›</span>
                    <span aria-hidden="true" className="hidden rtl:inline">‹</span>
                  </button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
