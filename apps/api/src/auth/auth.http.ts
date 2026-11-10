import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { RequestCtx } from './auth.service';
import { SESSION_DAYS } from './auth.service';

export const SESSION_COOKIE = 'th_session';

export function readSessionToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [n, ...rest] = part.trim().split('=');
    if (n === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 86_400_000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function requestCtx(req: Request): RequestCtx {
  const ip = req.ip ?? '';
  return {
    userAgent: req.headers['user-agent'],
    ipHash: ip ? createHash('sha256').update(ip).digest('hex').slice(0, 32) : undefined,
    requestId: (req as Request & { id?: string }).id,
  };
}
