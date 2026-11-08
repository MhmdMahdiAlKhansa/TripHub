'use client';

import { useEffect, useRef, useState } from 'react';

/** Muted looping background video with a visible pause control; does not autoplay under reduced motion. */
export function HeroVideo({ mp4, webm, poster, pauseLabel, playLabel }: { mp4: string; webm?: string; poster?: string; pauseLabel: string; playLabel: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, []);

  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().then(() => setPlaying(true));
    else {
      v.pause();
      setPlaying(false);
    }
  }

  return (
    <div className="absolute inset-0">
      <video ref={ref} muted loop playsInline preload="metadata" poster={poster} aria-hidden="true" className="h-full w-full object-cover">
        {webm ? <source src={webm} type="video/webm" /> : null}
        <source src={mp4} type="video/mp4" />
      </video>
      <button
        type="button"
        onClick={toggle}
        className="absolute bottom-4 end-4 z-20 min-h-11 rounded-full bg-[#263c36]/80 px-4 text-sm font-semibold text-[#f7f8f3] backdrop-blur"
      >
        {playing ? pauseLabel : playLabel}
      </button>
    </div>
  );
}
