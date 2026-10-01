import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  connectorTypeEnum,
  dataBatchKindEnum,
  dataBatchStatusEnum,
  dataRowStatusEnum,
  id,
  pipelineStatusEnum,
  timestamps,
  tsz,
} from './_helpers';
import { users } from './identity';

/**
 * Platform data source provenance & ingestion (plan2 §5). Global (not tenant) tables — Super Admin only.
 */

export interface DataBatchStats {
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

export const dataBatches = pgTable(
  'data_batches',
  {
    id: id(),
    kind: dataBatchKindEnum('kind').notNull(),
    status: dataBatchStatusEnum('status').notNull().default('UPLOADED'),
    label: text('label').notNull(),
    fileName: text('file_name'),
    fileS3Key: text('file_s3_key'),
    format: text('format'),
    fileIssues: jsonb('file_issues').$type<{ field: string; code: string; message: string }[]>().notNull().default([]),
    stats: jsonb('stats')
      .$type<DataBatchStats>()
      .notNull()
      .default({ rows: 0, valid: 0, warnings: 0, invalid: 0, duplicates: 0, inserted: 0, companiesCreated: 0, companiesUpdated: 0, contactsCreated: 0 }),
    /** Whether to enqueue org pipeline runs after commit (plan2 §6.2 fan-out). */
    fanOut: boolean('fan_out').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    committedBy: uuid('committed_by').references(() => users.id, { onDelete: 'set null' }),
    validatedAt: tsz('validated_at'),
    committedAt: tsz('committed_at'),
    rolledBackAt: tsz('rolled_back_at'),
    error: text('error'),
    ...timestamps,
  },
  (t) => [index('data_batches_created_idx').on(t.createdAt.desc())],
);

export interface RowIssueJson {
  field: string;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

/** Staging rows for imports — nothing reaches market_events before commit (plan2 §7.1). */
export const dataBatchRows = pgTable(
  'data_batch_rows',
  {
    id: id(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => dataBatches.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull(),
    normalized: jsonb('normalized').$type<Record<string, unknown>>(),
    status: dataRowStatusEnum('status').notNull(),
    issues: jsonb('issues').$type<RowIssueJson[]>().notNull().default([]),
    duplicateOfEventId: uuid('duplicate_of_event_id'),
    insertedEventId: uuid('inserted_event_id'),
    ...timestamps,
  },
  (t) => [index('data_batch_rows_batch_status_idx').on(t.batchId, t.status, t.rowNumber)],
);

export interface ConnectorConfigJson {
  url?: string;
  format?: 'csv' | 'jsonl' | 'json';
  /** Query param used to request records newer than the cursor, e.g. "since". */
  sinceParam?: string;
  /** Header name for auth and the NAME of the env var holding its value — never the secret itself. */
  authHeader?: string;
  authEnvVar?: string;
  maxRowsPerRun?: number;
  /** DEMO_FEED: rows released per run. */
  batchSize?: number;
}

export const dataConnectors = pgTable(
  'data_connectors',
  {
    id: id(),
    name: text('name').notNull(),
    type: connectorTypeEnum('type').notNull(),
    config: jsonb('config').$type<ConnectorConfigJson>().notNull().default({}),
    schedule: text('schedule'),
    enabled: boolean('enabled').notNull().default(true),
    fanOut: boolean('fan_out').notNull().default(true),
    cursor: jsonb('cursor').$type<Record<string, unknown>>(),
    lastRunAt: tsz('last_run_at'),
    lastStatus: text('last_status'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('data_connectors_name_uq').on(t.name)],
);

export interface IngestionStatsJson {
  fetched: number;
  valid: number;
  warnings: number;
  invalid: number;
  duplicates: number;
  inserted: number;
  orgsNotified: number;
}

export const ingestionRuns = pgTable(
  'ingestion_runs',
  {
    id: id(),
    connectorId: uuid('connector_id')
      .notNull()
      .references(() => dataConnectors.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id').references(() => dataBatches.id, { onDelete: 'set null' }),
    trigger: text('trigger').notNull().default('MANUAL'),
    status: pipelineStatusEnum('status').notNull().default('QUEUED'),
    stats: jsonb('stats').$type<IngestionStatsJson>().notNull().default({ fetched: 0, valid: 0, warnings: 0, invalid: 0, duplicates: 0, inserted: 0, orgsNotified: 0 }),
    error: text('error'),
    triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: tsz('started_at'),
    finishedAt: tsz('finished_at'),
    ...timestamps,
  },
  (t) => [index('ingestion_runs_connector_idx').on(t.connectorId, t.createdAt.desc())],
);
