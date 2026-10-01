/**
 * Typed fetch wrapper for the Fastify API (same-origin `/api/v1/*`, cookie session).
 * - Parses RFC 7807 problem+json into ApiError.
 * - On 401 it transparently rotates the session via /auth/refresh once, then retries.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown,
    readonly fieldErrors?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(query?: Query): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

let refreshing: Promise<boolean> | null = null;
async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => (refreshing = null), 0);
    });
  return refreshing;
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Query; signal?: AbortSignal; raw?: boolean } = {},
  retried = false,
): Promise<T> {
  const res = await fetch(`/api/v1${path}${qs(opts.query)}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (res.status === 401 && !retried && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    if (await refreshSession()) return api<T>(path, opts, true);
  }
  if (!res.ok) {
    let body: { title?: string; code?: string; details?: unknown; errors?: { path: string; message: string }[] } = {};
    try {
      body = await res.json();
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, body.title ?? res.statusText, body.code, body.details, body.errors);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const get = <T>(path: string, query?: Query) => api<T>(path, { query });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.fieldErrors?.length) return e.fieldErrors.map((f) => (f.path ? `${f.path}: ${f.message}` : f.message)).join('; ');
    return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}
