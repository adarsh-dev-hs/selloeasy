import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js 16 proxy (formerly middleware): cheap auth gate for app areas.
 * It only checks that a session cookie exists; the API enforces real auth + RBAC on every call.
 */
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.has('se_at') || req.cookies.has('se_rt');
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/app/:path*', '/platform/:path*'] };
