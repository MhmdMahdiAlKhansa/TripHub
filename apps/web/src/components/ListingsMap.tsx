'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';

export interface MapPoint { id: string; lng: number; lat: number; title: string; href: string; price?: string }

/**
 * Interactive map of real experiences (only those that have coordinates). MapLibre is loaded on demand,
 * so pages without a map never download it. Markers are real buttons: keyboard-focusable and labelled.
 */
export function ListingsMap({ points, style, label, openLabel, single = false }: { points: MapPoint[]; style: string | object; label: string; openLabel: string; single?: boolean }) {
  const el = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = el.current;
    if (!host || points.length === 0) return;
    let map: import('maplibre-gl').Map | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const ml = await import('maplibre-gl');
        if (cancelled) return;
        map = new ml.Map({ container: host, style: style as never, center: [points[0]!.lng, points[0]!.lat], zoom: single ? 11 : 7, attributionControl: { compact: true } });
        map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        const bounds = new ml.LngLatBounds();
        for (const p of points) {
          const b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('aria-label', `${p.title}${p.price ? ` · ${p.price}` : ''}`);
          b.className = 'h-8 w-8 rounded-full border-2 border-white bg-[#f08a3c] shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2';
          const popupEl = document.createElement('div');
          const a = document.createElement('a');
          a.href = p.href;
          a.textContent = p.title;
          a.style.cssText = 'font-weight:700;color:#0858b0;text-decoration:underline';
          popupEl.appendChild(a);
          if (p.price) {
            const s = document.createElement('div');
            s.textContent = p.price;
            popupEl.appendChild(s);
          }
          new ml.Marker({ element: b }).setLngLat([p.lng, p.lat]).setPopup(new ml.Popup({ offset: 16 }).setDOMContent(popupEl)).addTo(map);
          bounds.extend([p.lng, p.lat]);
        }
        if (!single && points.length > 1) map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 0 });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [points, style, single]);

  if (points.length === 0 || failed) return null;
  return <div ref={el} role="group" aria-label={label} className="h-80 w-full overflow-hidden rounded-3xl border border-[var(--border)] sm:h-96" data-open={openLabel} />;
}
