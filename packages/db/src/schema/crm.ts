import type { ScoreBreakdown } from '@selloeasy/shared';
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  activityDirectionEnum,
  activityTypeEnum,
  contactSourceEnum,
  id,
  leadStageEnum,
  outreachStatusEnum,
  scoreBandEnum,
  timestamps,
  tsz,
} from './_helpers';
import { organizations, users } from './identity';
import { directoryCompanies, icps, signalMatches } from './intelligence';

const orgRef = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

/** Target companies, per org. */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    orgId: orgRef(),
    directoryCompanyId: uuid('directory_company_id').references(() => directoryCompanies.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    domain: text('domain'),
    industry: text('industry'),
    hqCountry: text('hq_country'),
    sizeBand: text('size_band'),
    employees: integer('employees'),
    description: text('description'),
    ...timestamps,
  },
  (t) => [index('accounts_org_idx').on(t.orgId), index('accounts_org_name_idx').on(t.orgId, t.name)],
);

export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    orgId: orgRef(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    title: text('title'),
    persona: text('persona'),
    seniority: text('seniority'),
    email: text('email'),
    phone: text('phone'),
    whatsapp: text('whatsapp'),
    linkedinUrl: text('linkedin_url'),
    source: contactSourceEnum('source').notNull().default('MANUAL'),
    ...timestamps,
  },
  (t) => [index('contacts_org_account_idx').on(t.orgId, t.accountId)],
);

export const leads = pgTable(
  'leads',
  {
    id: id(),
    orgId: orgRef(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    primaryContactId: uuid('primary_contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    icpId: uuid('icp_id').references(() => icps.id, { onDelete: 'set null' }),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    stage: leadStageEnum('stage').notNull().default('NEW'),
    scoreTotal: integer('score_total').notNull().default(0),
    scoreBand: scoreBandEnum('score_band').notNull().default('COLD'),
    breakdown: jsonb('breakdown').$type<ScoreBreakdown>().notNull(),
    fitScore: doublePrecision('fit_score').notNull().default(0),
    signalStrength: doublePrecision('signal_strength').notNull().default(0),
    recencyScore: doublePrecision('recency_score').notNull().default(0),
    suggestedPersonas: jsonb('suggested_personas').$type<string[]>().notNull().default([]),
    firstSignalAt: tsz('first_signal_at'),
    lastSignalAt: tsz('last_signal_at'),
    firstTouchAt: tsz('first_touch_at'),
    lastActivityAt: tsz('last_activity_at'),
    stageChangedAt: tsz('stage_changed_at'),
    lostReason: text('lost_reason'),
    wonValue: doublePrecision('won_value'),
    // Dedupe: one lead per target account per org (plan §11.1 stage 6).
    dedupeKey: text('dedupe_key').notNull(),
    // Optimistic lock for concurrent claims/updates (plan §13.5).
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('leads_org_dedupe_uq').on(t.orgId, t.dedupeKey),
    index('leads_org_score_idx').on(t.orgId, t.scoreTotal.desc(), t.id.desc()),
    index('leads_org_stage_idx').on(t.orgId, t.stage),
    index('leads_org_owner_idx').on(t.orgId, t.ownerUserId),
    index('leads_org_last_signal_idx').on(t.orgId, t.lastSignalAt.desc()),
  ],
);

/** Evidence: many signal matches can support one lead. */
export const leadSignals = pgTable(
  'lead_signals',
  {
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    signalMatchId: uuid('signal_match_id')
      .notNull()
      .references(() => signalMatches.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.leadId, t.signalMatchId] })],
);

export const activities = pgTable(
  'activities',
  {
    id: id(),
    orgId: orgRef(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    type: activityTypeEnum('type').notNull(),
    direction: activityDirectionEnum('direction').notNull().default('INTERNAL'),
    subject: text('subject'),
    body: text('body'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: tsz('occurred_at').defaultNow().notNull(),
    ...timestamps,
  },
  (t) => [
    index('activities_org_lead_idx').on(t.orgId, t.leadId, t.occurredAt.desc()),
    index('activities_org_type_idx').on(t.orgId, t.type, t.occurredAt),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    orgId: orgRef(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    dueAt: tsz('due_at'),
    completedAt: tsz('completed_at'),
    ...timestamps,
  },
  (t) => [index('tasks_org_assignee_idx').on(t.orgId, t.assigneeUserId, t.completedAt)],
);

export const outreachMessages = pgTable(
  'outreach_messages',
  {
    id: id(),
    orgId: orgRef(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    channel: text('channel').notNull(),
    to: text('to').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    status: outreachStatusEnum('status').notNull().default('DRAFT'),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    sentBy: uuid('sent_by').references(() => users.id, { onDelete: 'set null' }),
    sentAt: tsz('sent_at'),
    ...timestamps,
  },
  (t) => [index('outreach_org_lead_idx').on(t.orgId, t.leadId)],
);

