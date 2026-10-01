import { NextResponse } from 'next/server';

// Like the web app's /api proxy, this route reads its URL at runtime so one image works in every environment.
const TARGETS: Record<string, string> = { app: '/login', 'api-docs': '/api/docs' };

export function GET(_req: Request, ctx: RouteContext<'/go/[target]'>) {
  return ctx.params.then(({ target }) => {
    const path = TARGETS[target];
    if (!path) return new NextResponse('Not found', { status: 404 });
    const base = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    return NextResponse.redirect(`${base}${path}`, 307);
  });
}
