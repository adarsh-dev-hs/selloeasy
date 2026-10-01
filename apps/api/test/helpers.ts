import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildServer } from '../src/server';

export const PW = 'Password@123';

export async function makeApp(): Promise<FastifyInstance> {
  const app = await buildServer({ logger: false });
  await app.ready();
  return app;
}

export interface Session {
  cookie: string;
  refresh: string;
  me: { user: { id: string }; role: string; org: { id: string } | null };
}

function cookieHeader(setCookie: string | string[] | undefined): { cookie: string; refresh: string } {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const pairs = list.map((c) => c.split(';')[0]!);
  return { cookie: pairs.join('; '), refresh: pairs.find((p) => p.startsWith('se_rt='))?.slice(6) ?? '' };
}

export async function login(app: FastifyInstance, email: string, password = PW): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login ${email} failed: ${res.statusCode} ${res.body}`);
  return { ...cookieHeader(res.headers['set-cookie']), me: res.json() };
}

export function call(app: FastifyInstance, s: Session | null, method: InjectOptions['method'], url: string, payload?: unknown) {
  return app.inject({ method, url: `/api/v1${url}`, headers: s ? { cookie: s.cookie } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
}

export { cookieHeader };
