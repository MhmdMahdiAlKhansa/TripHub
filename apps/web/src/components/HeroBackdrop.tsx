import { existsSync } from 'node:fs';
import path from 'node:path';
import { HeroVideo } from './HeroVideo';
import { Parallax } from './Parallax';

const pub = (name: string) => existsSync(path.join(process.cwd(), 'public', 'brand', name));

/**
 * The hero background. It uses real photography/video the moment you drop them in `public/brand/`
 * (hero.mp4 + hero.jpg/webp for video, or just hero.jpg/webp/avif). Until then it shows an illustrated
 * layered landscape built from the brand colours. It is decoration: it never stands in for a real photo
 * of a real listing, and it is hidden from assistive technology.
 */
export function HeroBackdrop({ pauseLabel, playLabel }: { pauseLabel: string; playLabel: string }) {
  const image = ['hero.avif', 'hero.webp', 'hero.jpg'].find(pub);
  const video = pub('hero.mp4') ? { mp4: '/brand/hero.mp4', webm: pub('hero.webm') ? '/brand/hero.webm' : undefined } : null;

  if (video) {
    return <HeroVideo mp4={video.mp4} webm={video.webm} poster={image ? `/brand/${image}` : undefined} pauseLabel={pauseLabel} playLabel={playLabel} />;
  }
  if (image) {
    return (
      <Parallax speed={0.12} maxTravel={36} className="absolute inset-x-0 -top-10 -bottom-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/brand/${image}`}
          srcSet={image.endsWith('.webp') && pub('hero-640.webp') ? '/brand/hero-640.webp 640w, /brand/hero-1024.webp 1024w, /brand/hero-1440.webp 1440w, /brand/hero.webp 1774w' : undefined}
          sizes="100vw"
          alt=""
          width={1774}
          height={887}
          fetchPriority="high"
          decoding="async"
          className="h-full w-full object-cover object-[78%_50%] rtl:-scale-x-100"
        />
      </Parallax>
    );
  }
  return <HeroScene />;
}

function HeroScene() {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-[#263c36] rtl:-scale-x-100">
      <svg viewBox="0 0 1440 820" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0a4a9a" />
            <stop offset="0.4" stopColor="#2b93e6" />
            <stop offset="0.72" stopColor="#a8e4f5" />
            <stop offset="0.9" stopColor="#ffe08a" />
            <stop offset="1" stopColor="#ffb46b" />
          </linearGradient>
          <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fff1b8" stopOpacity="0.95" />
            <stop offset="0.4" stopColor="#ffd166" stopOpacity="0.4" />
            <stop offset="1" stopColor="#ffd166" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1440" height="820" fill="url(#sky)" />
        <circle cx="1090" cy="360" r="260" fill="url(#sun)" />
        <circle cx="1090" cy="360" r="46" fill="#ffe066" />
      </svg>
      <Parallax speed={0.05} maxTravel={16} className="absolute inset-0">
        <svg viewBox="0 0 1440 820" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
          <path d="M0 520 L140 430 L260 500 L420 380 L600 490 L760 400 L940 500 L1120 410 L1300 480 L1440 420 V820 H0Z" fill="#8fdcb5" opacity="0.75" />
        </svg>
      </Parallax>
      <Parallax speed={0.1} maxTravel={26} className="absolute inset-0">
        <svg viewBox="0 0 1440 820" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
          <path d="M0 600 L180 500 L330 580 L520 450 L700 570 L880 480 L1060 590 L1240 500 L1440 580 V820 H0Z" fill="#3fa57f" />
        </svg>
      </Parallax>
      <Parallax speed={0.16} maxTravel={36} className="absolute inset-0">
        <svg viewBox="0 0 1440 820" preserveAspectRatio="xMidYMid slice" className="h-full w-full">
          <path d="M0 680 L200 610 L380 670 L600 590 L820 680 L1040 620 L1260 690 L1440 640 V820 H0Z" fill="#0c8458" />
          <path d="M880 700 C1040 660 1200 700 1440 670 V820 H880Z" fill="#1b8fe0" opacity="0.9" />
          {/* cedars */}
          <g fill="#0f4a38">
            <path d="M210 700 l40 -150 l-26 0 l36 -120 l-24 0 l44 -130 l44 130 l-24 0 l36 120 l-26 0 l40 150z" />
            <path d="M340 720 l30 -110 l-20 0 l28 -90 l-18 0 l34 -100 l34 100 l-18 0 l28 90 l-20 0 l30 110z" />
            <path d="M1210 720 l26 -96 l-18 0 l24 -78 l-16 0 l30 -88 l30 88 l-16 0 l24 78 l-18 0 l26 96z" />
          </g>
        </svg>
      </Parallax>
      <svg viewBox="0 0 1440 820" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <path d="M0 760 C240 720 420 780 700 750 C980 720 1180 780 1440 740 V820 H0Z" fill="#14543f" />
      </svg>
    </div>
  );
}
