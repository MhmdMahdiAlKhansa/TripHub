/**
 * Server-side client for the public API. It never throws: callers get `{ ok: false }` and must show
 * an honest "could not load" state, which is different from an empty result.
 */
export const API_URL = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '') + '/api/v1';

export type Result<T> = { ok: true; data: T } | { ok: false; status: number };

export async function apiGet<T>(path: string, timeoutMs = 4000): Promise<Result<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0 };
  }
}

export interface PublicListing {
  id: string;
  category: string;
  bookingMode: string;
  bookable: boolean;
  city: string | null;
  meetingPoint: string | null;
  latitude: number | null;
  longitude: number | null;
  featured: boolean;
  cancellationPolicy: string;
  fromPrice: { amountMinor: string; currency: string } | null;
  images: Array<{ id: string; url: string; alt: string | null }>;
  title: string | null;
  summary: string | null;
  description: string | null;
  company: { slug: string; name: string; verified: boolean } | null;
}

export interface Slot {
  id: string;
  startsAt: string;
  remaining: number;
}

export interface Rate {
  kind: string;
  amountMinor: string;
  currency: string;
}

export interface ReviewSummary {
  summary: { count: number; average: number | null };
  reviews: Array<{ id: string; rating: number; comment: string | null; author: string; createdAt: string }>;
}

/** Formats integer minor units for display only (never used for calculation). */
export function formatMoney(minor: string, currency: string, locale: string): string {
  const n = Number(minor);
  if (currency === 'USD') return new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
  return `${new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-US').format(n)} LBP`;
}

/** Responsive variants of a stored listing image (the API resizes on demand and caches them as immutable). */
export const imgSrcSet = (url: string) => [320, 640, 1280].map((w) => `${url}?w=${w} ${w}w`).join(', ');

export interface FxRate { lbpPerUsd: number }
export async function getFx(): Promise<number | null> {
  const r = await apiGet<{ rate: { lbpPerUsd: number } | null }>('/public/fx');
  return r.ok && r.data.rate ? r.data.rate.lbpPerUsd : null;
}
/** Indicative LBP amount for a USD price in cents, rounded to the nearest 1,000 LBP. */
export function lbpEstimate(usdMinor: string, lbpPerUsd: number, locale: string): string {
  const lbp = Math.round((Number(usdMinor) / 100) * lbpPerUsd / 1000) * 1000;
  return `≈ ${new Intl.NumberFormat(locale === 'ar' ? 'ar-LB' : 'en-US').format(lbp)} LBP`;
}
