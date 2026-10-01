import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as cheerio from 'cheerio';

/**
 * Website crawler with SSRF protection (plan §9.2, §24):
 * - http(s) only, same host as the root URL, depth/page limits,
 * - DNS resolved and private/link-local/loopback addresses rejected before every request,
 * - redirects followed manually and re-validated, response size and time capped,
 * - robots.txt `Disallow` rules for `User-agent: *` respected.
 */

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const UA = 'SelloEasyBot/1.0 (+https://selloeasy.local/docs)';

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb');
}

export class UnsafeUrlError extends Error {}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new UnsafeUrlError('Only http(s) URLs are allowed');
  if (url.username || url.password) throw new UnsafeUrlError('Credentials in URLs are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new UnsafeUrlError('Internal hostnames are not allowed');
  }
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new UnsafeUrlError(`Could not resolve ${host}`);
  if (addrs.some((a) => isPrivateIp(a.address))) throw new UnsafeUrlError('URL resolves to a private network address');
  return url;
}

async function safeFetch(raw: string, redirects = 3): Promise<{ url: URL; contentType: string; body: string } | null> {
  const url = await assertPublicUrl(raw);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': UA, Accept: 'text/html,text/plain' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (redirects <= 0) return null;
      return safeFetch(new URL(res.headers.get('location')!, url).toString(), redirects - 1);
    }
    if (!res.ok || !res.body) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!/text\/(html|plain)/i.test(contentType)) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return { url, contentType, body: Buffer.concat(chunks).toString('utf8') };
  } finally {
    clearTimeout(timer);
  }
}

async function robotsDisallows(origin: string): Promise<string[]> {
  try {
    const r = await safeFetch(`${origin}/robots.txt`);
    if (!r) return [];
    const lines = r.body.split(/\r?\n/).map((l) => l.trim());
    const out: string[] = [];
    let applies = false;
    for (const l of lines) {
      const [k, ...rest] = l.split(':');
      const v = rest.join(':').trim();
      if (/^user-agent$/i.test(k ?? '')) applies = v === '*' || /selloeasy/i.test(v);
      else if (applies && /^disallow$/i.test(k ?? '') && v) out.push(v);
    }
    return out;
  } catch {
    return [];
  }
}

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
}

export function extractPage(html: string, baseUrl: URL): { title: string; text: string; links: string[] } {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim() || baseUrl.pathname;
  const links = $('a[href]')
    .map((_, a) => $(a).attr('href'))
    .get()
    .map((h) => {
      try {
        const u = new URL(h, baseUrl);
        u.hash = '';
        return u.toString();
      } catch {
        return null;
      }
    })
    .filter((u): u is string => !!u);
  $('script, style, noscript, svg, nav, footer, header, form, iframe').remove();
  const text = $('main').length ? $('main').text() : $('body').text();
  return { title, text: text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim(), links };
}

export async function crawlSite(rootUrl: string, opts: { maxPages: number; maxDepth: number }): Promise<CrawledPage[]> {
  const root = await assertPublicUrl(rootUrl);
  const disallow = await robotsDisallows(root.origin);
  const seen = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: root.toString(), depth: 0 }];
  const pages: CrawledPage[] = [];

  while (queue.length && pages.length < opts.maxPages) {
    const { url, depth } = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const u = new URL(url);
    if (u.host !== root.host) continue;
    if (disallow.some((d) => u.pathname.startsWith(d))) continue;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|zip|mp4|webp|css|js)$/i.test(u.pathname)) continue;
    const res = await safeFetch(url).catch(() => null);
    if (!res) continue;
    const page = /html/i.test(res.contentType)
      ? extractPage(res.body, res.url)
      : { title: res.url.pathname, text: res.body, links: [] as string[] };
    if (page.text.length > 200) pages.push({ url, title: page.title, text: page.text });
    if (depth < opts.maxDepth) {
      for (const l of page.links) if (!seen.has(l)) queue.push({ url: l, depth: depth + 1 });
    }
  }
  return pages;
}
