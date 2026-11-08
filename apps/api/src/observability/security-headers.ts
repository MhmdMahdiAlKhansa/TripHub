import type { NextFunction, Request, Response } from 'express';

/**
 * Baseline security headers for every API response. The API only ever returns JSON (plus the
 * Swagger UI in non-production), so the policy is strict. Responses may contain personal data, so
 * they are never cached by shared caches unless a route says otherwise.
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (!req.path.startsWith('/api/docs')) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  }
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
  next();
}
