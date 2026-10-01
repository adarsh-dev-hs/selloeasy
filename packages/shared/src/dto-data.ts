import { z } from 'zod';
import {
  CONNECTOR_TYPES,
  DATA_BATCH_KINDS,
  DATA_BATCH_STATUSES,
  DATA_ROW_STATUSES,
  DATA_SOURCE_TYPES,
  FEED_FORMATS,
  MARKET_TAGS,
  type ConnectorType,
  type DataBatchKind,
  type DataBatchStatus,
  type DataRowStatus,
  type DataSourceType,
  type PipelineStatus,
} from './enums';
import { pageQuerySchema } from './pagination';

/**
 * Platform data source DTOs (plan2 §8, §11). Super Admin only — the data source holds no tenant data;
 * distribution views expose org names + counts only (plan2 §8.4, decision Q3).
 */

/** Data-explorer pages default to 25 rows, max 100 (plan2 §9). */
export const dataPageQuerySchema = pageQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const dataEventsQuerySchema = dataPageQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  tag: z.enum(MARKET_TAGS).optional(),
  source: z.string().trim().max(80).optional(),
  sourceType: z.enum(DATA_SOURCE_TYPES).optional(),
  batchId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  retracted: z.enum(['exclude', 'include', 'only']).default('exclude'),
  /** Keyset cursor for deep pages: "<publishedAt ISO>|<id>" (plan2 §9, ADR-0018). */
  after: z.string().max(80).optional(),
});
export type DataEventsQuery = z.infer<typeof dataEventsQuerySchema>;

export const dataCompaniesQuerySchema = dataPageQuerySchema.extend({
  q: z.string().trim().max(160).optional(),
  industry: z.enum(MARKET_TAGS).optional(),
  country: z.string().length(2).optional(),
  sourceType: z.enum(DATA_SOURCE_TYPES).optional(),
});
export const dataContactsQuerySchema = dataPageQuerySchema.extend({
  q: z.string().trim().max(160).optional(),
  sourceType: z.enum(DATA_SOURCE_TYPES).optional(),
});
export const dataBatchesQuerySchema = dataPageQuerySchema.extend({
  kind: z.enum(DATA_BATCH_KINDS).optional(),
  status: z.enum(DATA_BATCH_STATUSES).optional(),
});
export const dataBatchRowsQuerySchema = dataPageQuerySchema.extend({
  status: z.enum(DATA_ROW_STATUSES).optional(),
});

/** Paginated list whose total may be an estimate (plan2 §9). */
export interface DataPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalIsEstimate: boolean;
  totalPages: number;
  /** Present when more rows exist — pass as `after` for keyset paging on deep pages. */
  nextAfter: string | null;
}

export interface Provenance {
  sourceType: DataSourceType;
  batch: { id: string; label: string; kind: DataBatchKind } | null;
}

export interface DataEventListItem extends Provenance {
  id: string;
  externalId: string | null;
  publishedAt: string;
  title: string;
  snippet: string;
  source: string;
  sourceUrl: string | null;
  industryTags: string[];
  subjectCompany: { name: string; domain: string | null } | null;
  amount: number | null;
  currency: string | null;
  region: string | null;
  retractedAt: string | null;
  orgsMatched: number;
}

export interface DistributionRow {
  orgId: string;
  orgName: string;
  matches: number;
  leads: number;
}
export interface Distribution {
  orgsMatched: number;
  matches: number;
  leads: number;
  byOrg: DistributionRow[];
}

/** Full record in template-v1 field names, plus provenance and distribution. */
export interface DataEventDetail extends Provenance {
  id: string;
  record: Record<string, unknown>;
  retractedAt: string | null;
  ingestedAt: string;
  ingestedBy: string | null;
  schemaVersion: number;
  distribution: Distribution;
}

export interface DataCompanyListItem extends Provenance {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  hqCountry: string | null;
  sizeBand: string | null;
  employees: number | null;
  contactsCount: number;
  eventsCount: number;
  retractedAt: string | null;
}

export interface DataContactListItem extends Provenance {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  linkedinUrl: string | null;
  company: { id: string; name: string; domain: string | null };
  retractedAt: string | null;
}

export interface DataCompanyDetail extends DataCompanyListItem {
  description: string | null;
  contacts: DataContactListItem[];
  recentEvents: DataEventListItem[];
}

export interface DataOverview {
  events: number;
  eventsLast7d: number;
  eventsLast30d: number;
  companies: number;
  contacts: number;
  sources: number;
  retractedEvents: number;
  newestPublishedAt: string | null;
  bySourceType: { sourceType: DataSourceType; count: number }[];
  byTag: { tag: string; count: number }[];
  weekly: { week: string; SEED: number; CSV_IMPORT: number; JSONL_IMPORT: number; CONNECTOR: number }[];
  connectors: number;
  lastIngestionAt: string | null;
}

export interface DataBatchStatsDto {
  rows: number;
  valid: number;
  warnings: number;
  invalid: number;
  duplicates: number;
  inserted: number;
  companiesCreated: number;
  companiesUpdated: number;
  contactsCreated: number;
  fetched?: number;
}

export interface DataBatchDto {
  id: string;
  kind: DataBatchKind;
  status: DataBatchStatus;
  label: string;
  fileName: string | null;
  format: string | null;
  fileIssues: { field: string; code: string; message: string }[];
  stats: DataBatchStatsDto;
  fanOut: boolean;
  error: string | null;
  createdBy: string | null;
  committedBy: string | null;
  createdAt: string;
  validatedAt: string | null;
  committedAt: string | null;
  rolledBackAt: string | null;
  /** Whether committing is allowed under IMPORT_MAX_INVALID_RATIO. */
  committable: boolean;
  maxInvalidRatio: number;
}

export interface DataBatchDetail extends DataBatchDto {
  distribution: Distribution | null;
}

export interface DataBatchRowDto {
  rowNumber: number;
  status: DataRowStatus;
  issues: { field: string; code: string; message: string; severity: 'error' | 'warning' }[];
  raw: Record<string, unknown>;
  duplicateOfEventId: string | null;
  insertedEventId: string | null;
}

export const connectorConfigSchema = z.object({
  url: z.url().max(2048).optional(),
  format: z.enum(FEED_FORMATS).optional(),
  sinceParam: z
    .string()
    .regex(/^[A-Za-z0-9_]{1,40}$/)
    .optional(),
  authHeader: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,60}$/)
    .optional(),
  /** Only CONNECTOR_* env vars are readable (see readConnectorSecret). */
  authEnvVar: z
    .string()
    .regex(/^CONNECTOR_[A-Z0-9_]{1,60}$/, 'Must be an env var named CONNECTOR_*')
    .optional(),
  maxRowsPerRun: z.number().int().min(1).max(5000).optional(),
  batchSize: z.number().int().min(1).max(100).optional(),
});

/** Standard 5-field cron (min hour dom mon dow). */
const cron = z.string().regex(/^(\S+\s+){4}\S+$/, 'Use a 5-field cron expression, e.g. 0 */6 * * *');

export const connectorSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    type: z.enum(CONNECTOR_TYPES),
    config: connectorConfigSchema.default({}),
    schedule: z
      .union([cron, z.literal('')])
      .optional()
      .transform((v) => v || null),
    enabled: z.boolean().default(true),
    fanOut: z.boolean().default(true),
  })
  .refine((c) => c.type !== 'HTTP_FEED' || (c.config.url && c.config.url.startsWith('https://')), {
    path: ['config', 'url'],
    message: 'HTTP feeds need an https:// URL',
  })
  .refine((c) => !c.config.authHeader === !c.config.authEnvVar, {
    path: ['config', 'authEnvVar'],
    message: 'Set both authHeader and authEnvVar, or neither',
  });
export const updateConnectorSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  config: connectorConfigSchema.optional(),
  schedule: z
    .union([cron, z.literal('')])
    .optional()
    .nullable()
    // Omitted → leave unchanged; '' / null → clear the schedule.
    .transform((v) => (v === undefined ? undefined : v || null)),
  enabled: z.boolean().optional(),
  fanOut: z.boolean().optional(),
});

export interface ConnectorDto {
  id: string;
  name: string;
  type: ConnectorType;
  config: z.infer<typeof connectorConfigSchema>;
  schedule: string | null;
  enabled: boolean;
  fanOut: boolean;
  cursor: Record<string, unknown> | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  createdAt: string;
  runningRunId: string | null;
}

export interface IngestionRunDto {
  id: string;
  connector: { id: string; name: string };
  batchId: string | null;
  trigger: string;
  status: PipelineStatus;
  stats: {
    fetched: number;
    valid: number;
    warnings: number;
    invalid: number;
    duplicates: number;
    inserted: number;
    orgsNotified: number;
  };
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  triggeredBy: string | null;
}

export interface IngestionProgressEvent {
  runId: string;
  status: 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  stage: 'fetching' | 'validating' | 'inserting' | 'fanout' | 'done' | 'failed' | 'snapshot';
  progress: number;
  stats: IngestionRunDto['stats'];
  message?: string;
}

export const commitBatchSchema = z.object({ fanOut: z.boolean().optional() });
