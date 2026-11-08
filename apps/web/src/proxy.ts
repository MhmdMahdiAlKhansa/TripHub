import { NextResponse, type NextRequest } from 'next/server';
import { isLocale, LOCALE_COOKIE, negotiateLocale } from './i18n/locale';

/** Redirects locale-less paths to /<locale>/... using the cookie, then Accept-Language. */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const first = pathname.split('/')[1];
  if (isLocale(first)) return NextResponse.next();

  const locale = negotiateLocale({
    cookie: request.cookies.get(LOCALE_COOKIE)?.value,
    acceptLanguage: request.headers.get('accept-language'),
  });
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;
  url.search = search;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals, API routes and any path with a file extension (assets).
  matcher: ['/((?!_next|api|.*\\..*).*)'],
};
