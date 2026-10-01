import { z } from 'zod';
import { COMPANY_SIZE_BANDS, MARKET_TAGS } from './enums';

/**
 * Platform data template v1 — the canonical "Market Event Record" (plan2 §4, ADR-0015).
 * One record = one business-news event + its subject (buyer) company + optionally one contact.
 *
 * Single source of truth for: CSV/JSONL import validation, connector ingestion, the Super Admin data
 * explorer's field reference, the downloadable CSV template and the JSON Schema export.
 */
export const TEMPLATE_VERSION = 1;

export type FieldRequirement = 'required' | 'recommended' | 'optional' | 'conditional';

export interface TemplateField {
  name: string;
  type: string;
  requirement: FieldRequirement;
  rules: string;
  example: string;
  group: 'event' | 'company' | 'contact';
}

export const TEMPLATE_V1_FIELDS: readonly TemplateField[] = [
  {
    name: 'external_id',
    type: 'string ≤ 100',
    requirement: 'recommended',
    rules: 'Unique per source; makes re-imports idempotent. A content hash is used when empty.',
    example: 'imp-001',
    group: 'event',
  },
  {
    name: 'source',
    type: 'string 2–80',
    requirement: 'required',
    rules: 'Publisher or feed name.',
    example: 'AutoWire India',
    group: 'event',
  },
  {
    name: 'source_url',
    type: 'https URL',
    requirement: 'required',
    rules: 'https:// only, public host, unique.',
    example: 'https://autowire-india.example/2026/torvia-launch',
    group: 'event',
  },
  {
    name: 'title',
    type: 'string 20–300',
    requirement: 'required',
    rules: 'Headline; not all caps, not a placeholder.',
    example: 'Torvia Motors to launch Aera electric crossover in Q1 2027',
    group: 'event',
  },
  {
    name: 'body',
    type: 'string 200–10 000',
    requirement: 'required',
    rules: '≥ 30 words, ≥ 95 % printable characters.',
    example: 'Torvia Motors on Tuesday announced …',
    group: 'event',
  },
  {
    name: 'published_at',
    type: 'ISO 8601 date/datetime',
    requirement: 'required',
    rules: 'Not more than 1 day in the future, not older than the age limit (2 years).',
    example: '2026-09-22',
    group: 'event',
  },
  {
    name: 'industry_tags',
    type: 'list of market tags',
    requirement: 'required',
    rules: `1–4 tags separated by "|" (CSV) or an array (JSON). Allowed: ${MARKET_TAGS.join(', ')}.`,
    example: 'Automotive|Electric Vehicles',
    group: 'event',
  },
  {
    name: 'region',
    type: 'string ≤ 120',
    requirement: 'optional',
    rules: 'City / state / region.',
    example: 'Sanand, India',
    group: 'event',
  },
  {
    name: 'country',
    type: 'ISO 3166-1 alpha-2',
    requirement: 'optional',
    rules: 'Two uppercase letters.',
    example: 'IN',
    group: 'event',
  },
  {
    name: 'amount',
    type: 'number ≥ 0',
    requirement: 'optional',
    rules: 'Deal / investment / order size.',
    example: '4200000000',
    group: 'event',
  },
  {
    name: 'currency',
    type: 'INR | USD | EUR',
    requirement: 'conditional',
    rules: 'Required when amount is set.',
    example: 'INR',
    group: 'event',
  },
  {
    name: 'subject_company_name',
    type: 'string 2–160',
    requirement: 'required',
    rules: 'The company that would buy.',
    example: 'Torvia Motors',
    group: 'company',
  },
  {
    name: 'subject_company_domain',
    type: 'hostname',
    requirement: 'required',
    rules: 'Lower-cased; directory dedupe key; not a free-mail domain.',
    example: 'torviamotors.example',
    group: 'company',
  },
  {
    name: 'subject_company_industry',
    type: 'one market tag',
    requirement: 'optional',
    rules: 'From the allowed tags.',
    example: 'Automotive',
    group: 'company',
  },
  {
    name: 'subject_company_country',
    type: 'ISO-2',
    requirement: 'optional',
    rules: 'Two uppercase letters.',
    example: 'IN',
    group: 'company',
  },
  {
    name: 'subject_company_size_band',
    type: COMPANY_SIZE_BANDS.join(' | '),
    requirement: 'optional',
    rules: 'Employee band.',
    example: '5001-10000',
    group: 'company',
  },
  {
    name: 'subject_company_employees',
    type: 'integer 1–5 000 000',
    requirement: 'optional',
    rules: 'Must fall inside size_band when both are given.',
    example: '7800',
    group: 'company',
  },
  {
    name: 'mentioned_companies',
    type: 'list of names',
    requirement: 'optional',
    rules: 'Up to 5, separated by "|" (CSV) or an array (JSON).',
    example: 'Kestrel Silicon|Lumora Semiconductors',
    group: 'company',
  },
  {
    name: 'contact_name',
    type: 'string 2–120',
    requirement: 'conditional',
    rules: 'Required when any contact_* field is set, together with an email or phone.',
    example: 'Kavita Rao',
    group: 'contact',
  },
  {
    name: 'contact_title',
    type: 'string ≤ 160',
    requirement: 'optional',
    rules: 'Job title.',
    example: 'VP Procurement',
    group: 'contact',
  },
  {
    name: 'contact_email',
    type: 'email',
    requirement: 'optional',
    rules: 'Domain should match subject_company_domain (warning otherwise).',
    example: 'kavita.rao@torviamotors.example',
    group: 'contact',
  },
  {
    name: 'contact_phone',
    type: 'E.164',
    requirement: 'optional',
    rules: '+ followed by 6–15 digits.',
    example: '+919000050001',
    group: 'contact',
  },
  {
    name: 'contact_whatsapp',
    type: 'E.164',
    requirement: 'optional',
    rules: 'Defaults to contact_phone.',
    example: '+919000050001',
    group: 'contact',
  },
  {
    name: 'contact_linkedin_url',
    type: 'URL',
    requirement: 'optional',
    rules: 'https:// profile URL.',
    example: 'https://linkedin.example/in/kavita-rao',
    group: 'contact',
  },
];

export const TEMPLATE_V1_COLUMNS: readonly string[] = TEMPLATE_V1_FIELDS.map((f) => f.name);
export const TEMPLATE_V1_REQUIRED_COLUMNS: readonly string[] = TEMPLATE_V1_FIELDS.filter(
  (f) => f.requirement === 'required',
).map((f) => f.name);
/** Columns that may be present but are dropped (e.g. spreadsheet notes). */
export const TEMPLATE_IGNORED_COLUMNS: readonly string[] = ['_comment'];
const LIST_FIELDS = new Set(['industry_tags', 'mentioned_companies']);
const NUMBER_FIELDS = new Set(['amount', 'subject_company_employees']);

const TAG_BY_LOWER = new Map<string, string>(MARKET_TAGS.map((t) => [t.toLowerCase(), t]));

export type RawRecord = Record<string, unknown>;

/**
 * Normalise a raw CSV/JSON row into the shape the zod schema expects:
 * trims strings, '' → undefined, "a|b" → ["a","b"], numeric strings → numbers,
 * tags → canonical casing. Unknown keys are kept so the schema can report them.
 */
export function normalizeRecord(raw: RawRecord): RawRecord {
  const out: RawRecord = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = k.trim().toLowerCase();
    if (TEMPLATE_IGNORED_COLUMNS.includes(key)) continue;
    let val: unknown = typeof v === 'string' ? v.trim() : v;
    if (val === '' || val === null) val = undefined;
    if (val !== undefined && LIST_FIELDS.has(key)) {
      const arr = Array.isArray(val) ? val : String(val).split('|');
      val = arr.map((x) => String(x).trim()).filter(Boolean);
      if (key === 'industry_tags') val = (val as string[]).map((t) => TAG_BY_LOWER.get(t.toLowerCase()) ?? t);
    }
    if (val !== undefined && NUMBER_FIELDS.has(key) && typeof val === 'string') {
      const n = Number(val.replace(/[,_\s]/g, ''));
      val = Number.isFinite(n) ? n : val;
    }
    if (key === 'subject_company_domain' && typeof val === 'string')
      val = val
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '');
    if (key === 'subject_company_industry' && typeof val === 'string')
      val = TAG_BY_LOWER.get(val.toLowerCase()) ?? val;
    if (
      (key === 'country' || key === 'subject_company_country' || key === 'currency') &&
      typeof val === 'string'
    )
      val = val.toUpperCase();
    if (key === 'contact_email' && typeof val === 'string') val = val.toLowerCase();
    out[key] = val;
  }
  return out;
}

const e164 = z.string().regex(/^\+\d{6,15}$/, 'Must be E.164, e.g. +919000050001');
const iso2 = z.string().regex(/^[A-Z]{2}$/, 'Must be an ISO 3166-1 alpha-2 code, e.g. IN');
const tag = z.enum(MARKET_TAGS, { error: () => `Unknown tag — allowed: ${MARKET_TAGS.join(', ')}` });
const isoDate = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/,
    'Must be an ISO 8601 date, e.g. 2026-09-22',
  )
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Not a real calendar date');
const httpsUrl = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Must be an https:// URL');

const SIZE_RANGE: Record<string, [number, number]> = {
  '1-50': [1, 50],
  '51-200': [51, 200],
  '201-1000': [201, 1000],
  '1001-5000': [1001, 5000],
  '5001-10000': [5001, 10000],
  '10000+': [10001, 5_000_000],
};

/** zod schema for a normalised v1 record (structural + cross-field rules). Quality heuristics live in @selloeasy/pipeline. */
export const marketEventRecordV1 = z
  .strictObject({
    external_id: z.string().max(100).optional(),
    source: z.string().min(2).max(80),
    source_url: httpsUrl,
    title: z.string().min(20, 'Title must be at least 20 characters').max(300),
    body: z.string().min(200, 'Body must be at least 200 characters').max(10_000),
    published_at: isoDate,
    industry_tags: z.array(tag).min(1, 'At least one tag').max(4, 'At most 4 tags'),
    region: z.string().max(120).optional(),
    country: iso2.optional(),
    amount: z.number({ error: 'Must be a number' }).min(0).max(1e15).optional(),
    currency: z.enum(['INR', 'USD', 'EUR']).optional(),
    subject_company_name: z.string().min(2).max(160),
    subject_company_domain: z
      .string()
      .max(253)
      .regex(/^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/, 'Must be a hostname, e.g. acme.example'),
    subject_company_industry: tag.optional(),
    subject_company_country: iso2.optional(),
    subject_company_size_band: z.enum(COMPANY_SIZE_BANDS).optional(),
    subject_company_employees: z
      .number({ error: 'Must be a whole number' })
      .int()
      .min(1)
      .max(5_000_000)
      .optional(),
    mentioned_companies: z.array(z.string().min(2).max(160)).max(5).optional(),
    contact_name: z.string().min(2).max(120).optional(),
    contact_title: z.string().max(160).optional(),
    contact_email: z.email().max(254).optional(),
    contact_phone: e164.optional(),
    contact_whatsapp: e164.optional(),
    contact_linkedin_url: httpsUrl.optional(),
  })
  .superRefine((r, ctx) => {
    if (r.amount !== undefined && !r.currency)
      ctx.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'Currency is required when amount is set',
      });
    if (r.subject_company_size_band && r.subject_company_employees !== undefined) {
      const [lo, hi] = SIZE_RANGE[r.subject_company_size_band]!;
      if (r.subject_company_employees < lo || r.subject_company_employees > hi) {
        ctx.addIssue({
          code: 'custom',
          path: ['subject_company_employees'],
          message: `Employees ${r.subject_company_employees} is outside size band ${r.subject_company_size_band}`,
        });
      }
    }
    const anyContact =
      r.contact_name ||
      r.contact_title ||
      r.contact_email ||
      r.contact_phone ||
      r.contact_whatsapp ||
      r.contact_linkedin_url;
    if (anyContact) {
      if (!r.contact_name)
        ctx.addIssue({
          code: 'custom',
          path: ['contact_name'],
          message: 'contact_name is required when contact fields are set',
        });
      if (!r.contact_email && !r.contact_phone)
        ctx.addIssue({
          code: 'custom',
          path: ['contact_email'],
          message: 'A contact needs an email or a phone',
        });
    }
  });

export type MarketEventRecord = z.infer<typeof marketEventRecordV1>;

/** Header row + one example row — the downloadable CSV template. */
export function templateCsv(): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `${TEMPLATE_V1_COLUMNS.join(',')}\n${TEMPLATE_V1_FIELDS.map((f) => esc(f.example)).join(',')}\n`;
}

/** JSON Schema for integrators (template-v1.schema.json). */
export function templateJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(marketEventRecordV1, { io: 'input', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;
  return {
    ...schema,
    $id: 'https://selloeasy.local/schemas/market-event-record-v1.json',
    title: 'SelloEasy Market Event Record v1',
  };
}
