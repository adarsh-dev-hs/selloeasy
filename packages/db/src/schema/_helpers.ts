import { customType, pgEnum, timestamp, uuid } from 'drizzle-orm/pg-core';
import {
  ACTIVITY_TYPES,
  AUDIT_SCOPES,
  CONNECTOR_TYPES,
  DATA_BATCH_KINDS,
  DATA_BATCH_STATUSES,
  DATA_ROW_STATUSES,
  DATA_SOURCE_TYPES,
  CONTACT_SOURCES,
  ICP_SOURCES,
  INDUSTRIES,
  LEAD_STAGES,
  ORG_ROLES,
  ORG_STATUSES,
  OUTREACH_STATUSES,
  PIPELINE_STATUSES,
  PIPELINE_TRIGGERS,
  SCORE_BANDS,
  SIGNAL_SOURCES,
  SOURCE_STATUSES,
  SOURCE_TYPES,
  USER_STATUSES,
  VISIBILITIES,
} from '@selloeasy/shared';
import { uuidv7 } from 'uuidv7';

/** uuidv7 primary keys: time-ordered, index-friendly, safe to expose. */
export const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

export const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const industryEnum = pgEnum('industry', INDUSTRIES);
export const orgStatusEnum = pgEnum('org_status', ORG_STATUSES);
export const orgRoleEnum = pgEnum('org_role', ORG_ROLES);
export const userStatusEnum = pgEnum('user_status', USER_STATUSES);
export const visibilityEnum = pgEnum('visibility', VISIBILITIES);
export const sourceTypeEnum = pgEnum('source_type', SOURCE_TYPES);
export const sourceStatusEnum = pgEnum('source_status', SOURCE_STATUSES);
export const icpSourceEnum = pgEnum('icp_source', ICP_SOURCES);
export const signalSourceEnum = pgEnum('signal_source', SIGNAL_SOURCES);
export const pipelineTriggerEnum = pgEnum('pipeline_trigger', PIPELINE_TRIGGERS);
export const pipelineStatusEnum = pgEnum('pipeline_status', PIPELINE_STATUSES);
export const leadStageEnum = pgEnum('lead_stage', LEAD_STAGES);
export const scoreBandEnum = pgEnum('score_band', SCORE_BANDS);
export const activityTypeEnum = pgEnum('activity_type', ACTIVITY_TYPES);
export const activityDirectionEnum = pgEnum('activity_direction', ['OUTBOUND', 'INBOUND', 'INTERNAL']);
export const outreachStatusEnum = pgEnum('outreach_status', OUTREACH_STATUSES);
export const contactSourceEnum = pgEnum('contact_source', CONTACT_SOURCES);
export const auditScopeEnum = pgEnum('audit_scope', AUDIT_SCOPES);
export const dataSourceTypeEnum = pgEnum('data_source_type', DATA_SOURCE_TYPES);
export const dataBatchKindEnum = pgEnum('data_batch_kind', DATA_BATCH_KINDS);
export const dataBatchStatusEnum = pgEnum('data_batch_status', DATA_BATCH_STATUSES);
export const dataRowStatusEnum = pgEnum('data_row_status', DATA_ROW_STATUSES);
export const connectorTypeEnum = pgEnum('connector_type', CONNECTOR_TYPES);
