import type { IcpCriteria, PipelineRunStats } from '@selloeasy/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  dataSourceTypeEnum,
  icpSourceEnum,
  id,
  industryEnum,
  pipelineStatusEnum,
  pipelineTriggerEnum,
  signalSourceEnum,
  timestamps,
  tsvector,
  tsz,
} from './_helpers';
import { dataBatches } from './data';
import { organizations, users } from './identity';

const orgRef = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

export const icps = pgTable(
  'icps',
  {
    id: id(),
    orgId: orgRef(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    source: icpSourceEnum('source').notNull().default('CUSTOM'),
    criteria: jsonb('criteria').$type<IcpCriteria>().notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('icps_org_idx').on(t.orgId)],
);

/** Platform-wide, per-industry signal templates managed by Super Admins. */
export const signalTemplates = pgTable(
  'signal_templates',
  {
    id: id(),
    industry: industryEnum('industry').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    matchInstructions: text('match_instructions').notNull(),
    defaultKeywords: text('default_keywords').array().notNull().default(sql`'{}'::text[]`),
    defaultWeight: doublePrecision('default_weight').notNull().default(1),
    ...timestamps,
  },
  (t) => [uniqueIndex('signal_templates_industry_key_uq').on(t.industry, t.key)],
);

export const signals = pgTable(
  'signals',
  {
    id: id(),
    orgId: orgRef(),
    templateId: uuid('template_id').references(() => signalTemplates.id, { onDelete: 'set null' }),
    icpId: uuid('icp_id').references(() => icps.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    matchInstructions: text('match_instructions').notNull(),
    keywords: text('keywords').array().notNull().default(sql`'{}'::text[]`),
    negativeKeywords: text('negative_keywords').array().notNull().default(sql`'{}'::text[]`),
    weight: doublePrecision('weight').notNull().default(1),
    source: signalSourceEnum('source').notNull().default('CUSTOM'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('signals_org_idx').on(t.orgId)],
);

export interface EventCompanyJson {
  name: string;
  domain?: string;
  role: 'subject' | 'mentioned';
}

/**
 * Global market-events corpus — ingested once, matched per org (plan §11.1, trade-off #9).
 * Contains no tenant data; per-org results live in `signal_matches`.
 */
export const marketEvents = pgTable(
  'market_events',
  {
    id: id(),
    externalId: text('external_id'),
    source: text('source').notNull(),
    url: text('url'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    publishedAt: tsz('published_at').notNull(),
    industryTags: text('industry_tags').array().notNull().default(sql`'{}'::text[]`),
    companies: jsonb('companies').$type<EventCompanyJson[]>().notNull().default([]),
    region: text('region'),
    amount: numeric('amount', { mode: 'number' }),
    currency: text('currency'),
    synthetic: boolean('synthetic').notNull().default(false),
    hash: text('hash').notNull(),
    /** sha256(normalised title + first 500 chars of body) — near-duplicate detection on import (plan2 §7.2). */
    contentHash: text('content_hash'),
    // Provenance (plan2 §5)
    country: text('country'),
    sourceType: dataSourceTypeEnum('source_type').notNull().default('SEED'),
    batchId: uuid('batch_id').references(() => dataBatches.id, { onDelete: 'set null' }),
    schemaVersion: integer('schema_version').notNull().default(1),
    /** Retracted events are hidden from org pipeline matching (plan2 §7.4, ADR-0016). */
    retractedAt: tsz('retracted_at'),
    ingestedBy: uuid('ingested_by').references(() => users.id, { onDelete: 'set null' }),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', title || ' ' || body)`),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('market_events_hash_uq').on(t.hash),
    uniqueIndex('market_events_source_external_uq').on(sql`lower(${t.source})`, sql`lower(${t.externalId})`).where(sql`${t.externalId} is not null`),
    uniqueIndex('market_events_url_uq').on(sql`lower(rtrim(${t.url}, '/'))`).where(sql`${t.url} is not null`),
    index('market_events_source_type_idx').on(t.sourceType, t.publishedAt.desc()),
    index('market_events_batch_idx').on(t.batchId),
    index('market_events_content_hash_idx').on(t.contentHash),
    index('market_events_published_idx').on(t.publishedAt.desc()),
    index('market_events_tags_idx').using('gin', t.industryTags),
    index('market_events_tsv_idx').using('gin', t.tsv),
  ],
);

/**
 * Global company directory — stands in for a data/enrichment provider (Apollo, ZoomInfo…).
 * v1 is filled from the synthetic dataset; the pipeline copies what it needs into tenant tables.
 */
export const directoryCompanies = pgTable(
  'directory_companies',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    domain: text('domain'),
    industry: text('industry'),
    hqCountry: text('hq_country'),
    sizeBand: text('size_band'),
    employees: integer('employees'),
    description: text('description'),
    synthetic: boolean('synthetic').notNull().default(true),
    sourceType: dataSourceTypeEnum('source_type').notNull().default('SEED'),
    batchId: uuid('batch_id').references(() => dataBatches.id, { onDelete: 'set null' }),
    updatedByBatchId: uuid('updated_by_batch_id').references(() => dataBatches.id, { onDelete: 'set null' }),
    retractedAt: tsz('retracted_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('directory_companies_key_uq').on(t.key),
    index('directory_companies_name_idx').on(t.name),
    uniqueIndex('directory_companies_domain_uq').on(t.domain).where(sql`${t.domain} is not null`),
  ],
);

export const directoryContacts = pgTable(
  'directory_contacts',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => directoryCompanies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    title: text('title'),
    persona: text('persona'),
    seniority: text('seniority'),
    email: text('email'),
    phone: text('phone'),
    whatsapp: text('whatsapp'),
    linkedinUrl: text('linkedin_url'),
    synthetic: boolean('synthetic').notNull().default(true),
    sourceType: dataSourceTypeEnum('source_type').notNull().default('SEED'),
    batchId: uuid('batch_id').references(() => dataBatches.id, { onDelete: 'set null' }),
    retractedAt: tsz('retracted_at'),
    ...timestamps,
  },
  (t) => [index('directory_contacts_company_idx').on(t.companyId), index('directory_contacts_email_idx').on(t.companyId, t.email)],
);

export const pipelineRuns = pgTable(
  'pipeline_runs',
  {
    id: id(),
    orgId: orgRef(),
    trigger: pipelineTriggerEnum('trigger').notNull(),
    status: pipelineStatusEnum('status').notNull().default('QUEUED'),
    triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: tsz('started_at'),
    finishedAt: tsz('finished_at'),
    stats: jsonb('stats')
      .$type<PipelineRunStats>()
      .notNull()
      .default({
        eventsScanned: 0,
        prefiltered: 0,
        matched: 0,
        leadsCreated: 0,
        leadsUpdated: 0,
        llmCalls: 0,
        cacheHits: 0,
        costUsd: 0,
      }),
    error: text('error'),
    ...timestamps,
  },
  (t) => [index('pipeline_runs_org_idx').on(t.orgId, t.createdAt.desc())],
);

export interface ExtractedJson {
  accountName?: string;
  accountDomain?: string;
  personas?: string[];
  dealHints?: { amount?: number; currency?: string; timeline?: string };
}

export const signalMatches = pgTable(
  'signal_matches',
  {
    id: id(),
    orgId: orgRef(),
    runId: uuid('run_id').references(() => pipelineRuns.id, { onDelete: 'set null' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => marketEvents.id, { onDelete: 'cascade' }),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => signals.id, { onDelete: 'cascade' }),
    confidence: doublePrecision('confidence').notNull(),
    rationale: text('rationale').notNull().default(''),
    extracted: jsonb('extracted').$type<ExtractedJson>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    // Idempotency: one match per (org, event, signal) — plan §11.3.
    uniqueIndex('signal_matches_org_event_signal_uq').on(t.orgId, t.eventId, t.signalId),
    index('signal_matches_org_idx').on(t.orgId),
  ],
);

export const llmCalls = pgTable(
  'llm_calls',
  {
    id: id(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    purpose: text('purpose').notNull(),
    provider: text('provider').notNull().default('openrouter'),
    model: text('model').notNull(),
    promptVersion: text('prompt_version'),
    promptHash: text('prompt_hash').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    status: text('status').notNull(),
    error: text('error'),
    cached: boolean('cached').notNull().default(false),
    ...timestamps,
  },
  (t) => [index('llm_calls_org_created_idx').on(t.orgId, t.createdAt.desc())],
);

/**
 * Which events were already evaluated for an org against a given set of signals.
 * Re-runs skip them (no repeated LLM spend); editing signals changes the hash → re-evaluation.
 */
export const orgEventEvaluations = pgTable(
  'org_event_evaluations',
  {
    orgId: orgRef(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => marketEvents.id, { onDelete: 'cascade' }),
    signalsHash: text('signals_hash').notNull(),
    runId: uuid('run_id').references(() => pipelineRuns.id, { onDelete: 'set null' }),
    matched: boolean('matched').notNull().default(false),
    evaluatedAt: tsz('evaluated_at').defaultNow().notNull(),
  },
  (t) => [uniqueIndex('org_event_eval_uq').on(t.orgId, t.eventId, t.signalsHash)],
);
