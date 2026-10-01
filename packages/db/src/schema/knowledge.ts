import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, sourceStatusEnum, sourceTypeEnum, timestamps, tsvector, visibilityEnum } from './_helpers';
import { organizations } from './identity';

const orgRef = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

/** Raw inputs the org admin provides: website pages, uploaded documents, pasted text. */
export const orgSources = pgTable(
  'org_sources',
  {
    id: id(),
    orgId: orgRef(),
    type: sourceTypeEnum('type').notNull(),
    title: text('title').notNull(),
    url: text('url'),
    s3Key: text('s3_key'),
    contentType: text('content_type'),
    // ADR-0010: default INTERNAL — only PUBLIC sources are visible to Super Admins.
    visibility: visibilityEnum('visibility').notNull().default('INTERNAL'),
    status: sourceStatusEnum('status').notNull().default('PENDING'),
    error: text('error'),
    bytes: integer('bytes'),
    checksum: text('checksum'),
    ...timestamps,
  },
  (t) => [index('org_sources_org_idx').on(t.orgId)],
);

/** Chunked text used for retrieval (Postgres FTS — ADR-0004). */
export const orgSourceChunks = pgTable(
  'org_source_chunks',
  {
    id: id(),
    orgId: orgRef(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => orgSources.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull().default(0),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', content)`),
    ...timestamps,
  },
  (t) => [
    index('org_source_chunks_org_idx').on(t.orgId),
    index('org_source_chunks_tsv_idx').using('gin', t.tsv),
  ],
);

export const products = pgTable(
  'products',
  {
    id: id(),
    orgId: orgRef(),
    name: text('name').notNull(),
    category: text('category'),
    description: text('description'),
    targetSegments: text('target_segments').array().notNull().default(sql`'{}'::text[]`),
    priceNotes: text('price_notes'),
    visibility: visibilityEnum('visibility').notNull().default('PUBLIC'),
    ...timestamps,
  },
  (t) => [index('products_org_idx').on(t.orgId)],
);

export const plans = pgTable(
  'plans',
  {
    id: id(),
    orgId: orgRef(),
    name: text('name').notNull(),
    pricing: text('pricing'),
    features: text('features').array().notNull().default(sql`'{}'::text[]`),
    visibility: visibilityEnum('visibility').notNull().default('INTERNAL'),
    ...timestamps,
  },
  (t) => [index('plans_org_idx').on(t.orgId)],
);

export const policies = pgTable(
  'policies',
  {
    id: id(),
    orgId: orgRef(),
    title: text('title').notNull(),
    type: text('type').notNull().default('general'),
    body: text('body').notNull(),
    visibility: visibilityEnum('visibility').notNull().default('INTERNAL'),
    ...timestamps,
  },
  (t) => [index('policies_org_idx').on(t.orgId)],
);

export interface PersonaJson {
  title: string;
  goals: string[];
  painPoints: string[];
}

/** The AI-generated (and admin-editable) knowledge profile — one per org. */
export const orgProfiles = pgTable(
  'org_profiles',
  {
    id: id(),
    orgId: orgRef(),
    summary: text('summary').notNull().default(''),
    // Profile summary + value props are PUBLIC by default: they describe what the org sells.
    summaryVisibility: visibilityEnum('summary_visibility').notNull().default('PUBLIC'),
    valueProps: jsonb('value_props').$type<string[]>().notNull().default([]),
    differentiators: jsonb('differentiators').$type<string[]>().notNull().default([]),
    targetIndustries: text('target_industries').array().notNull().default(sql`'{}'::text[]`),
    geographies: text('geographies').array().notNull().default(sql`'{}'::text[]`),
    personas: jsonb('personas').$type<PersonaJson[]>().notNull().default([]),
    generatedByModel: text('generated_by_model'),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [uniqueIndex('org_profiles_org_uq').on(t.orgId)],
);
