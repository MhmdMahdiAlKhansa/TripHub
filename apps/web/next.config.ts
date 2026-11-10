import type { NextConfig } from 'next';

const apiOrigin = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const isProd = process.env.NODE_ENV === 'production';
// Map tiles/styles come from the configured provider only (see src/lib/map.ts). Dev uses OpenStreetMap tiles.
const mapOrigins = (process.env.NEXT_PUBLIC_MAPTILER_KEY
  ? ['https://api.maptiler.com']
  : process.env.NEXT_PUBLIC_MAP_STYLE_URL
  ? (process.env.NEXT_PUBLIC_MAP_ORIGIN ?? '').split(',').map((o) => o.trim()).filter(Boolean)
  : isProd ? [] : ['https://tile.openstreetmap.org']
).join(' ');
// Next injects small inline scripts, so script-src needs 'unsafe-inline' until nonces are wired in.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${mapOrigins}`,
  "font-src 'self'",
  `connect-src 'self' ${mapOrigins}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@triphub/shared'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=()' },
          ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
        ],
      },
    ];
  },
  // The browser talks to the API through the web origin, so the session cookie is first-party
  // (SameSite=Lax, HttpOnly) and the API's Origin check sees the web origin.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
