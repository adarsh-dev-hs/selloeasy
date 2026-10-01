import type { NextRequest } from 'next/server';

/**
 * Same-origin proxy: /api/* → Fastify (API_INTERNAL_URL, read at runtime).
 * Keeps auth cookies first-party (SameSite=Lax, HttpOnly) and streams SSE unchanged.
 * In AWS the ALB routes /api/* straight to the API service, so this is only a local/dev hop (plan §6).
 */
export const dynamic = 'force-dynamic';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'host', 'content-length', 'content-encoding']);

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const base = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  const target = `${base}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
  });
  const fwd = req.headers.get('x-forwarded-for');
  headers.set('x-forwarded-for', fwd ?? '127.0.0.1');
  headers.set('x-forwarded-proto', req.nextUrl.protocol.replace(':', ''));
  headers.set('x-forwarded-host', req.headers.get('host') ?? '');

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: 'manual',
      // @ts-expect-error — required by Node fetch when streaming a request body
      duplex: hasBody ? 'half' : undefined,
      cache: 'no-store',
    });
  } catch {
    return Response.json({ title: 'API unavailable', status: 502, code: 'bad_gateway' }, { status: 502, headers: { 'content-type': 'application/problem+json' } });
  }

  const out = new Headers();
  upstream.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k.toLowerCase()) && k.toLowerCase() !== 'set-cookie') out.set(k, v);
  });
  for (const c of upstream.headers.getSetCookie()) out.append('set-cookie', c);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
