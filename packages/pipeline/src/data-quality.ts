import { createHash } from 'node:crypto';
import {
  marketEventRecordV1,
  normalizeRecord,
  TEMPLATE_IGNORED_COLUMNS,
  TEMPLATE_V1_COLUMNS,
  TEMPLATE_V1_REQUIRED_COLUMNS,
  type DataRowStatus,
  type FeedFormat,
  type MarketEventRecord,
  type RawRecord,
} from '@selloeasy/shared';

/**
 * Anti-garbage validation for the platform data source (plan2 §7.2, ADR-0015). Pure: no DB, no network.
 * Layers: file → schema (zod, template v1) → content-quality heuristics → consistency → in-file duplicates.
 * Duplicates against existing data are checked by the engine using the keys produced here.
 */

export interface Issue {
  field: string;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export const FILE_LIMITS = { maxBytes: 10 * 1024 * 1024, maxRows: 5000 };

// ─── File layer ───────────────────────────────────────────────────────────────

/** RFC 4180 CSV parser: quotes, escaped quotes, embedded newlines, CRLF/LF, BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (quoted) throw new Error('Unterminated quoted field');
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((x) => x !== '')) rows.push(row);
  }
  return rows;
}

export interface InspectedFile {
  ok: boolean;
  format: FeedFormat | null;
  rows: RawRecord[];
  columns: string[];
  fileIssues: Issue[];
}

function detectFormat(filename: string, text: string): FeedFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) return 'jsonl';
  if (lower.endsWith('.json')) return 'json';
  const t = text.trimStart();
  if (t.startsWith('[')) return 'json';
  if (t.startsWith('{')) return t.includes('\n{') ? 'jsonl' : 'json';
  return t.includes(',') ? 'csv' : null;
}

const fileError = (code: string, message: string): Issue => ({
  field: '(file)',
  code,
  message,
  severity: 'error',
});

/**
 * File layer: size, binary/zip sniffing, strict UTF-8, parseability, row limit, header checks
 * (all required columns present, no unknown columns). Any error here rejects the whole file.
 */
export function inspectFile(buf: Buffer, filename: string, limits = FILE_LIMITS): InspectedFile {
  const fail = (issue: Issue): InspectedFile => ({
    ok: false,
    format: null,
    rows: [],
    columns: [],
    fileIssues: [issue],
  });
  if (buf.byteLength === 0) return fail(fileError('empty', 'The file is empty'));
  if (buf.byteLength > limits.maxBytes)
    return fail(fileError('too_large', `File exceeds ${Math.round(limits.maxBytes / 1024 / 1024)} MB`));
  const head = buf.subarray(0, 4).toString('latin1');
  if (head.startsWith('PK') || head.startsWith('%PDF') || buf.subarray(0, 8192).includes(0)) {
    return fail(
      fileError(
        'binary',
        'Binary, spreadsheet (.xlsx) or archive files are not accepted — export as CSV (UTF-8) or JSONL',
      ),
    );
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return fail(fileError('encoding', 'File is not valid UTF-8 — re-export with UTF-8 encoding'));
  }
  const format = detectFormat(filename, text);
  if (!format) return fail(fileError('format', 'Unrecognised format — upload .csv, .jsonl or .json'));

  let rows: RawRecord[];
  let columns: string[];
  try {
    if (format === 'csv') {
      const table = parseCsv(text);
      if (table.length < 2) return fail(fileError('no_rows', 'The file has a header but no data rows'));
      columns = table[0]!.map((h) => h.trim().toLowerCase());
      const width = columns.length;
      rows = table.slice(1).map((cells, i) => {
        if (cells.length !== width)
          throw new Error(`Row ${i + 2} has ${cells.length} cells but the header has ${width}`);
        return Object.fromEntries(columns.map((c, j) => [c, cells[j]]));
      });
    } else if (format === 'jsonl') {
      rows = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l, i) => {
          try {
            const v = JSON.parse(l);
            if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
            return v as RawRecord;
          } catch {
            throw new Error(`Line ${i + 1} is not a JSON object`);
          }
        });
      columns = [...new Set(rows.flatMap((r) => Object.keys(r).map((k) => k.toLowerCase())))];
    } else {
      const parsed = JSON.parse(text) as unknown;
      const arr = Array.isArray(parsed) ? parsed : (parsed as { items?: unknown }).items;
      if (!Array.isArray(arr)) throw new Error('Expected a JSON array or an object with an "items" array');
      rows = arr.map((v, i) => {
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`Item ${i} is not an object`);
        return v as RawRecord;
      });
      columns = [...new Set(rows.flatMap((r) => Object.keys(r).map((k) => k.toLowerCase())))];
    }
  } catch (e) {
    return fail(fileError('parse', `Could not parse ${format.toUpperCase()}: ${(e as Error).message}`));
  }

  if (rows.length === 0) return fail(fileError('no_rows', 'No data rows found'));
  if (rows.length > limits.maxRows)
    return fail(
      fileError(
        'too_many_rows',
        `File has ${rows.length} rows; the limit is ${limits.maxRows} — split it or use a connector`,
      ),
    );
  const known = new Set([...TEMPLATE_V1_COLUMNS, ...TEMPLATE_IGNORED_COLUMNS]);
  const unknown = columns.filter((c) => !known.has(c));
  if (unknown.length)
    return fail(
      fileError(
        'unknown_columns',
        `Unknown column(s): ${unknown.join(', ')} — the file does not follow template v1`,
      ),
    );
  if (format === 'csv') {
    const missing = TEMPLATE_V1_REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
    if (missing.length)
      return fail(fileError('missing_columns', `Missing required column(s): ${missing.join(', ')}`));
  }
  return { ok: true, format, rows, columns, fileIssues: [] };
}

// ─── Row layers ───────────────────────────────────────────────────────────────

const FREE_MAIL = new Set([
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'aol.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'rediffmail.com',
  'yandex.com',
  'mail.com',
  'gmx.com',
]);
const PLACEHOLDER =
  /\b(lorem ipsum|dolor sit amet|test ?data|asdf|qwerty|placeholder|sample text|foo ?bar|xxx+|tbd)\b/i;

function heuristics(r: MarketEventRecord): Issue[] {
  const out: Issue[] = [];
  const err = (field: string, code: string, message: string) =>
    out.push({ field, code, message, severity: 'error' });
  const warn = (field: string, code: string, message: string) =>
    out.push({ field, code, message, severity: 'warning' });

  const words = r.body.split(/\s+/).filter(Boolean).length;
  if (words < 30) err('body', 'too_few_words', `Body has ${words} words; at least 30 are required`);
  const printable =
    [...r.body].filter((ch) => /[\p{L}\p{N}\p{P}\p{Zs}\p{S}\n\r\t]/u.test(ch)).length /
    Math.max(1, r.body.length);
  if (printable < 0.95) err('body', 'unprintable', 'Body contains too many non-printable characters');
  for (const [field, text] of [
    ['title', r.title],
    ['body', r.body],
  ] as const) {
    if (PLACEHOLDER.test(text) || /^test\b/i.test(text))
      err(field, 'placeholder', `${field} looks like placeholder text`);
    if (/(.)\1{7,}/.test(text)) err(field, 'repeated_chars', `${field} contains repeated-character spam`);
  }
  const letters = r.title.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 10 && letters === letters.toUpperCase())
    err('title', 'all_caps', 'Title is written in all caps');
  if (r.title.trim().toLowerCase() === r.body.trim().toLowerCase())
    err('body', 'title_equals_body', 'Body repeats the title');
  const host = (() => {
    try {
      return new URL(r.source_url).hostname;
    } catch {
      return '';
    }
  })();
  if (
    host === 'localhost' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    err('source_url', 'internal_host', 'source_url points to a local or IP host');
  }
  if (FREE_MAIL.has(r.subject_company_domain))
    err(
      'subject_company_domain',
      'free_mail_domain',
      'Company domain is a free-mail provider, not a company',
    );

  // Consistency → warnings (committed but flagged).
  if (r.contact_email) {
    const d = r.contact_email.split('@')[1]!;
    if (d !== r.subject_company_domain && !d.endsWith(`.${r.subject_company_domain}`)) {
      warn(
        'contact_email',
        'email_domain_mismatch',
        `Contact email domain ${d} differs from company domain ${r.subject_company_domain}`,
      );
    }
  }
  if (r.subject_company_industry && !r.industry_tags.includes(r.subject_company_industry)) {
    warn(
      'industry_tags',
      'industry_not_tagged',
      `Company industry ${r.subject_company_industry} is not among the event tags`,
    );
  }
  if (r.subject_company_employees === undefined && !r.subject_company_size_band) {
    warn('subject_company_size_band', 'no_company_size', 'No company size — ICP fit scoring will be weaker');
  }
  return out;
}

export interface RowValidationContext {
  now: Date;
  /** Oldest acceptable published_at, in days (default 730 = 2 years). */
  maxAgeDays?: number;
}

export interface ValidatedRow {
  rowNumber: number;
  raw: RawRecord;
  record: MarketEventRecord | null;
  status: DataRowStatus;
  issues: Issue[];
  keys: DedupeKeys | null;
}

export interface DedupeKeys {
  sourceExternal: string | null;
  sourceUrl: string;
  contentHash: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Near-duplicate fingerprint: normalised title + first 500 chars of body (stored as market_events.content_hash). */
export function contentHashOf(title: string, body: string): string {
  return createHash('sha256')
    .update(`${norm(title)}\n${norm(body).slice(0, 500)}`)
    .digest('hex');
}

/** Keys used to detect duplicates within a file and against the data source (plan2 §7.2). */
export function dedupeKeys(r: MarketEventRecord): DedupeKeys {
  return {
    sourceExternal: r.external_id ? `${norm(r.source)}::${r.external_id.trim().toLowerCase()}` : null,
    sourceUrl: r.source_url.trim().replace(/\/+$/, '').toLowerCase(),
    contentHash: contentHashOf(r.title, r.body),
  };
}

/** Stable hash stored in market_events.hash for records that come through the template. */
export function recordHash(r: MarketEventRecord): string {
  const k = dedupeKeys(r);
  return createHash('sha256')
    .update(k.sourceExternal ?? k.contentHash)
    .digest('hex');
}

/** Validate one raw row: normalise → zod schema → date window → heuristics. */
export function validateRow(raw: RawRecord, rowNumber: number, ctx: RowValidationContext): ValidatedRow {
  const normalized = normalizeRecord(raw);
  const parsed = marketEventRecordV1.safeParse(normalized);
  if (!parsed.success) {
    const issues: Issue[] = parsed.error.issues.map((i) => {
      // Report the column name; positions inside list fields go into the message ("industry_tags[2]: …").
      const [head, ...rest] = i.path;
      const unknownKeys =
        i.code === 'unrecognized_keys' ? ((i as { keys?: string[] }).keys ?? []).join(', ') : '';
      return {
        field: head !== undefined ? String(head) : unknownKeys || '(row)',
        code: i.code,
        message: rest.length
          ? `${String(head)}[${rest.map((p) => (typeof p === 'number' ? p + 1 : String(p))).join('.')}]: ${i.message}`
          : i.message,
        severity: 'error' as const,
      };
    });
    return { rowNumber, raw, record: null, status: 'INVALID', issues, keys: null };
  }
  const r = parsed.data;
  const issues = heuristics(r);
  const published = Date.parse(r.published_at);
  if (published > ctx.now.getTime() + 86_400_000)
    issues.push({
      field: 'published_at',
      code: 'future_date',
      message: 'published_at is in the future',
      severity: 'error',
    });
  const maxAge = (ctx.maxAgeDays ?? 730) * 86_400_000;
  if (published < ctx.now.getTime() - maxAge)
    issues.push({
      field: 'published_at',
      code: 'too_old',
      message: `published_at is older than ${ctx.maxAgeDays ?? 730} days`,
      severity: 'error',
    });
  const hasError = issues.some((i) => i.severity === 'error');
  return {
    rowNumber,
    raw,
    record: hasError ? null : r,
    status: hasError ? 'INVALID' : issues.length ? 'WARNING' : 'VALID',
    issues,
    keys: hasError ? null : dedupeKeys(r),
  };
}

/** Validate all rows and flag in-file duplicates (later rows duplicate earlier ones). */
export function validateRows(rows: RawRecord[], ctx: RowValidationContext): ValidatedRow[] {
  const seen = new Map<string, number>();
  return rows.map((raw, i) => {
    const v = validateRow(raw, i + 1, ctx);
    if (v.keys) {
      for (const key of [v.keys.sourceExternal, `url:${v.keys.sourceUrl}`, `hash:${v.keys.contentHash}`]) {
        if (!key) continue;
        const prev = seen.get(key);
        if (prev !== undefined) {
          v.status = 'DUPLICATE';
          v.issues.push({
            field: '(row)',
            code: 'duplicate_in_file',
            message: `Duplicate of row ${prev} in this file`,
            severity: 'error',
          });
          break;
        }
      }
      if (v.status !== 'DUPLICATE') {
        for (const key of [v.keys.sourceExternal, `url:${v.keys.sourceUrl}`, `hash:${v.keys.contentHash}`])
          if (key) seen.set(key, v.rowNumber);
      }
    }
    return v;
  });
}

export function summarize(rows: ValidatedRow[]) {
  const count = (s: DataRowStatus) => rows.filter((r) => r.status === s).length;
  return {
    rows: rows.length,
    valid: count('VALID'),
    warnings: count('WARNING'),
    invalid: count('INVALID'),
    duplicates: count('DUPLICATE'),
  };
}

/** Spreadsheet formula-injection guard for CSV exports of stored data. */
export function csvSafe(v: unknown): string {
  const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('|') : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
