// Domain enums shared by the database schema, API contracts and the web app.
// Keep these as plain `as const` tuples so they work with zod, drizzle pgEnum and React alike.

export const INDUSTRIES = [
  'HEALTHCARE',
  'AUTOMOTIVE',
  'SEMICONDUCTORS',
  'RENEWABLE_ENERGY',
  'LOGISTICS',
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const INDUSTRY_LABELS: Record<Industry, string> = {
  HEALTHCARE: 'Healthcare',
  AUTOMOTIVE: 'Automotive',
  SEMICONDUCTORS: 'Semiconductors',
  RENEWABLE_ENERGY: 'Renewable Energy',
  LOGISTICS: 'Logistics',
};

export const ORG_STATUSES = ['INVITED', 'ONBOARDING', 'ACTIVE', 'SUSPENDED'] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

/** Roles inside an organization. SUPER_ADMIN is a platform flag on the user, not a membership role. */
export const ORG_ROLES = ['ORG_ADMIN', 'SALES_MANAGER', 'SDR', 'VIEWER'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export type Role = OrgRole | 'SUPER_ADMIN';

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ORG_ADMIN: 'Org Admin',
  SALES_MANAGER: 'Sales Manager',
  SDR: 'SDR',
  VIEWER: 'Viewer',
};

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const VISIBILITIES = ['PUBLIC', 'INTERNAL'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const SOURCE_TYPES = ['WEBSITE', 'PDF', 'DOC', 'TEXT'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_STATUSES = ['PENDING', 'PROCESSING', 'READY', 'FAILED'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const ICP_SOURCES = ['AI_SUGGESTED', 'CUSTOM'] as const;
export type IcpSource = (typeof ICP_SOURCES)[number];

export const SIGNAL_SOURCES = ['PREDEFINED', 'CUSTOM'] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

/** DATA_REFRESH = fan-out after new platform data was imported/ingested (plan2 §6.2). */
export const PIPELINE_TRIGGERS = ['MANUAL', 'SCHEDULED', 'ONBOARDING', 'DATA_REFRESH'] as const;
export type PipelineTrigger = (typeof PIPELINE_TRIGGERS)[number];

export const PIPELINE_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED'] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const LEAD_STAGES = [
  'NEW',
  'CONTACTED',
  'ENGAGED',
  'MEETING_SCHEDULED',
  'QUALIFIED',
  'PROPOSAL',
  'WON',
  'LOST',
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  ENGAGED: 'Engaged',
  MEETING_SCHEDULED: 'Meeting scheduled',
  QUALIFIED: 'Qualified',
  PROPOSAL: 'Proposal',
  WON: 'Won',
  LOST: 'Lost',
};

/** Stages that count as "approached" in dashboards: anything past NEW. */
export const APPROACHED_STAGES: readonly LeadStage[] = LEAD_STAGES.filter((s) => s !== 'NEW');

export const SCORE_BANDS = ['HOT', 'WARM', 'COLD'] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export const ACTIVITY_TYPES = [
  'EMAIL',
  'WHATSAPP',
  'CALL',
  'MEETING',
  'NOTE',
  'STAGE_CHANGE',
  'ASSIGNMENT',
  'TASK',
  'SCORE_CHANGED',
  'SIGNAL',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Activity types that count as an outbound touch ("approached"). */
export const OUTBOUND_ACTIVITY_TYPES = ['EMAIL', 'WHATSAPP', 'CALL', 'MEETING'] as const satisfies readonly ActivityType[];

export const OUTREACH_CHANNELS = ['email', 'whatsapp', 'call', 'meeting'] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

export const OUTREACH_STATUSES = ['DRAFT', 'SENT', 'FAILED'] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export const CONTACT_SOURCES = ['SYNTHETIC', 'MANUAL', 'ENRICHED'] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export const AUDIT_SCOPES = ['PLATFORM', 'ORG'] as const;
export type AuditScope = (typeof AUDIT_SCOPES)[number];

export const LEAD_VISIBILITY_MODES = ['ALL', 'ASSIGNED_ONLY'] as const;
export type LeadVisibilityMode = (typeof LEAD_VISIBILITY_MODES)[number];

/**
 * Controlled vocabulary for market data: event `industry_tags`, org `targetIndustries` and ICP industries.
 * The pipeline prefilter and the data-template validator match on these (case-insensitive).
 */
export const MARKET_TAGS = [
  'Automotive',
  'Electric Vehicles',
  'Two-Wheelers',
  'Commercial Vehicles',
  'Fleet & Mobility',
  'Hospitals',
  'Diagnostics',
  'Pharma',
  'Healthcare Services',
  'Semiconductors',
  'Electronics Manufacturing',
  'Consumer Electronics',
  'Telecom',
  'Data Centers',
  'Manufacturing',
  'Utilities',
  'Renewable Energy',
  'Real Estate',
  'E-commerce',
  'Retail',
  'FMCG',
  'Logistics',
  'Ports & Shipping',
  'Cold Chain',
  'Government',
] as const;
export type MarketTag = (typeof MARKET_TAGS)[number];

export const COMPANY_SIZE_BANDS = ['1-50', '51-200', '201-1000', '1001-5000', '5001-10000', '10000+'] as const;
export type CompanySizeBand = (typeof COMPANY_SIZE_BANDS)[number];

/** Where a platform data-source record came from (plan2 §5). */
export const DATA_SOURCE_TYPES = ['SEED', 'CSV_IMPORT', 'JSONL_IMPORT', 'CONNECTOR'] as const;
export type DataSourceType = (typeof DATA_SOURCE_TYPES)[number];

export const DATA_BATCH_KINDS = ['IMPORT', 'INGESTION', 'SEED'] as const;
export type DataBatchKind = (typeof DATA_BATCH_KINDS)[number];

export const DATA_BATCH_STATUSES = ['UPLOADED', 'VALIDATING', 'VALIDATED', 'COMMITTING', 'COMMITTED', 'DISCARDED', 'FAILED', 'ROLLED_BACK'] as const;
export type DataBatchStatus = (typeof DATA_BATCH_STATUSES)[number];

export const DATA_ROW_STATUSES = ['VALID', 'WARNING', 'INVALID', 'DUPLICATE'] as const;
export type DataRowStatus = (typeof DATA_ROW_STATUSES)[number];

export const CONNECTOR_TYPES = ['HTTP_FEED', 'DEMO_FEED'] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export const FEED_FORMATS = ['csv', 'jsonl', 'json'] as const;
export type FeedFormat = (typeof FEED_FORMATS)[number];
