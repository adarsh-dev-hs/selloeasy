import { z } from 'zod';
import {
  ACTIVITY_TYPES,
  INDUSTRIES,
  LEAD_STAGES,
  LEAD_VISIBILITY_MODES,
  ORG_ROLES,
  SCORE_BANDS,
  USER_STATUSES,
  VISIBILITIES,
  type ActivityType,
  type AuditScope,
  type ContactSource,
  type IcpSource,
  type Industry,
  type LeadStage,
  type LeadVisibilityMode,
  type OrgRole,
  type OrgStatus,
  type OutreachChannel,
  type PipelineStatus,
  type PipelineTrigger,
  type Role,
  type ScoreBand,
  type SignalSource,
  type SourceStatus,
  type SourceType,
  type Visibility,
} from './enums';
import { pageQuerySchema } from './pagination';
import type { Permission } from './rbac';
import type { ScoreBreakdown } from './scoring';

// ────────────────────────────────────────────────────────────────────────────
// Common
// ────────────────────────────────────────────────────────────────────────────

export const idParamSchema = z.object({ id: z.uuid() });
const email = z.email().trim().toLowerCase();
const password = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[0-9]/, 'Include a number');
const url = z.url().max(2048);
const optionalUrl = z.union([url, z.literal('')]).optional().transform((v) => v || undefined);
const text = (max: number) => z.string().trim().max(max);
const stringList = z.array(z.string().trim().min(1).max(200)).max(50).default([]);

export const dateRangeQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

// ────────────────────────────────────────────────────────────────────────────
// Auth
// ────────────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  name: text(120).min(2),
  password,
});
export const inviteTokenQuerySchema = z.object({ token: z.string().min(20).max(200) });
export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password });

export interface MeResponse {
  user: {
    id: string;
    email: string;
    name: string;
    isSuperAdmin: boolean;
    calendlyUrl: string | null;
    phone: string | null;
  };
  role: Role;
  permissions: Permission[];
  org: { id: string; name: string; slug: string; industry: Industry; status: OrgStatus } | null;
  features: { leadVisibilityToggle: boolean };
}

export interface InvitePreview {
  email: string;
  role: OrgRole;
  orgName: string;
  expiresAt: string;
}

export const updateMeSchema = z.object({
  name: text(120).min(2).optional(),
  calendlyUrl: optionalUrl,
  phone: text(40).optional(),
});

// ────────────────────────────────────────────────────────────────────────────
// Platform (Super Admin) — allow-list DTOs only (ADR-0010)
// ────────────────────────────────────────────────────────────────────────────

export const createOrgSchema = z.object({
  name: text(120).min(2),
  industry: z.enum(INDUSTRIES),
  websiteUrl: optionalUrl,
  adminEmail: email,
});
export const updatePlatformOrgSchema = z.object({
  name: text(120).min(2).optional(),
  industry: z.enum(INDUSTRIES).optional(),
});
export const platformInviteSchema = z.object({ email });

/** Public-level org view for Super Admins. Never add internal fields here. */
export interface PlatformOrgPublicView {
  id: string;
  name: string;
  slug: string;
  industry: Industry;
  status: OrgStatus;
  websiteUrl: string | null;
  hq: string | null;
  regions: string[];
  companySize: string | null;
  createdAt: string;
  activatedAt: string | null;
  publicProfile: { summary: string | null; valueProps: string[] } | null;
  publicProducts: { id: string; name: string; category: string | null; description: string | null }[];
  publicDocuments: { id: string; title: string; type: SourceType; url: string | null }[];
}

export interface PlatformOrgListItem {
  id: string;
  name: string;
  slug: string;
  industry: Industry;
  status: OrgStatus;
  createdAt: string;
  userCount: number;
  pendingInvites: number;
}

/** Aggregate counts only — no record-level data. */
export interface PlatformOrgStats {
  orgId: string;
  leads: number;
  approached: number;
  meetings: number;
  converted: number;
  conversionRate: number;
  lastPipelineRun: { status: PipelineStatus; finishedAt: string | null; error: string | null } | null;
  llmCost30dUsd: number;
  llmCalls30d: number;
}

export interface PlatformOrgUser {
  id: string;
  name: string;
  email: string;
  role: OrgRole;
  status: string;
  lastLoginAt: string | null;
}

export interface PlatformInvite {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export const signalTemplateSchema = z.object({
  industry: z.enum(INDUSTRIES),
  key: z.string().regex(/^[a-z0-9_]+$/).max(80),
  name: text(120).min(2),
  description: text(1000),
  matchInstructions: text(2000),
  defaultKeywords: stringList,
  defaultWeight: z.number().min(0.5).max(2).default(1),
});

// ────────────────────────────────────────────────────────────────────────────
// Org, members, invites
// ────────────────────────────────────────────────────────────────────────────

export const orgSettingsSchema = z.object({
  calendlyUrl: optionalUrl,
  senderName: text(120).optional(),
  timezone: text(64).optional(),
  leadVisibility: z.enum(LEAD_VISIBILITY_MODES).optional(),
});
export type OrgSettings = {
  calendlyUrl?: string;
  senderName?: string;
  timezone?: string;
  leadVisibility?: LeadVisibilityMode;
};

export const updateOrgSchema = z.object({
  name: text(120).min(2).optional(),
  /** '' clears the website. */
  websiteUrl: z.union([url, z.literal('')]).optional(),
  hq: text(120).optional(),
  regions: z.array(text(80)).max(30).optional(),
  companySize: text(40).optional(),
  description: text(4000).optional(),
  settings: orgSettingsSchema.optional(),
});

export interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  industry: Industry;
  status: OrgStatus;
  websiteUrl: string | null;
  hq: string | null;
  regions: string[];
  companySize: string | null;
  description: string | null;
  settings: OrgSettings;
  activatedAt: string | null;
  onboarding: OnboardingState;
}

export interface OnboardingState {
  basics: boolean;
  website: boolean;
  documents: boolean;
  products: boolean;
  policies: boolean;
  profile: boolean;
  icps: boolean;
  signals: boolean;
}

export const inviteUserSchema = z.object({ email, role: z.enum(ORG_ROLES) });
export const updateMemberSchema = z.object({
  role: z.enum(ORG_ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
});

export interface OrgMember {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  status: string;
  lastLoginAt: string | null;
  calendlyUrl: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Knowledge: sources, products, plans, policies, profile
// ────────────────────────────────────────────────────────────────────────────

export const websiteSourceSchema = z.object({ url, visibility: z.enum(VISIBILITIES).default('PUBLIC') });
export const textSourceSchema = z.object({
  title: text(200).min(2),
  content: text(100_000).min(20),
  visibility: z.enum(VISIBILITIES).default('INTERNAL'),
});
export const uploadUrlSchema = z.object({
  filename: text(200).min(1),
  contentType: z.enum([
    'application/pdf',
    'text/markdown',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
  size: z.number().int().positive(),
  visibility: z.enum(VISIBILITIES).default('INTERNAL'),
});
export const updateVisibilitySchema = z.object({ visibility: z.enum(VISIBILITIES) });

export interface OrgSource {
  id: string;
  type: SourceType;
  title: string;
  url: string | null;
  visibility: Visibility;
  status: SourceStatus;
  error: string | null;
  bytes: number | null;
  chunkCount: number;
  createdAt: string;
}

export interface UploadUrlResponse {
  sourceId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

export const productSchema = z.object({
  name: text(160).min(2),
  category: text(120).optional(),
  description: text(4000).optional(),
  targetSegments: stringList,
  priceNotes: text(1000).optional(),
  visibility: z.enum(VISIBILITIES).default('PUBLIC'),
});
export const planSchema = z.object({
  name: text(160).min(2),
  pricing: text(2000).optional(),
  features: stringList,
  visibility: z.enum(VISIBILITIES).default('INTERNAL'),
});
export const policySchema = z.object({
  title: text(200).min(2),
  type: text(60).default('general'),
  body: text(20_000).min(10),
  visibility: z.enum(VISIBILITIES).default('INTERNAL'),
});

export interface Product {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  targetSegments: string[];
  priceNotes: string | null;
  visibility: Visibility;
}
export interface Plan {
  id: string;
  name: string;
  pricing: string | null;
  features: string[];
  visibility: Visibility;
}
export interface Policy {
  id: string;
  title: string;
  type: string;
  body: string;
  visibility: Visibility;
}

export const personaSchema = z.object({
  title: text(120),
  goals: z.array(text(300)).max(10).default([]),
  painPoints: z.array(text(300)).max(10).default([]),
});
export const orgProfileSchema = z.object({
  summary: text(4000),
  valueProps: z.array(text(400)).max(15),
  differentiators: z.array(text(400)).max(15),
  targetIndustries: z.array(text(120)).max(20),
  geographies: z.array(text(80)).max(30),
  personas: z.array(personaSchema).max(10),
});
export type OrgProfileContent = z.infer<typeof orgProfileSchema>;

export interface OrgProfile extends OrgProfileContent {
  id: string;
  version: number;
  generatedByModel: string | null;
  updatedAt: string;
  summaryVisibility: Visibility;
}

export const updateOrgProfileSchema = orgProfileSchema.partial().extend({
  summaryVisibility: z.enum(VISIBILITIES).optional(),
});

// ────────────────────────────────────────────────────────────────────────────
// ICPs & signals
// ────────────────────────────────────────────────────────────────────────────

export const icpCriteriaSchema = z.object({
  industries: stringList,
  companySize: z.object({ minEmployees: z.number().int().min(0).optional(), maxEmployees: z.number().int().optional() }).default({}),
  revenueBand: text(80).optional(),
  geographies: stringList,
  personas: stringList,
  painPoints: stringList,
  keywords: stringList,
});
export type IcpCriteria = z.infer<typeof icpCriteriaSchema>;

export const icpSchema = z.object({
  name: text(160).min(2),
  description: text(2000).default(''),
  criteria: icpCriteriaSchema,
  isActive: z.boolean().default(true),
});

export interface Icp {
  id: string;
  name: string;
  description: string;
  source: IcpSource;
  criteria: IcpCriteria;
  isActive: boolean;
  createdAt: string;
  leadCount?: number;
}

export const signalSchema = z.object({
  name: text(160).min(2),
  description: text(2000).default(''),
  matchInstructions: text(2000).min(10),
  keywords: stringList,
  negativeKeywords: stringList,
  weight: z.number().min(0.5).max(2).default(1),
  icpId: z.uuid().nullable().optional(),
  isActive: z.boolean().default(true),
});

export interface Signal {
  id: string;
  name: string;
  description: string;
  matchInstructions: string;
  keywords: string[];
  negativeKeywords: string[];
  weight: number;
  icpId: string | null;
  templateId: string | null;
  source: SignalSource;
  isActive: boolean;
  createdAt: string;
  leadCount?: number;
}

export interface SignalTemplate {
  id: string;
  industry: Industry;
  key: string;
  name: string;
  description: string;
  matchInstructions: string;
  defaultKeywords: string[];
  defaultWeight: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Pipeline
// ────────────────────────────────────────────────────────────────────────────

export interface PipelineRunStats {
  eventsScanned: number;
  prefiltered: number;
  matched: number;
  leadsCreated: number;
  leadsUpdated: number;
  llmCalls: number;
  cacheHits: number;
  costUsd: number;
  budgetExhausted?: boolean;
}

export interface PipelineRun {
  id: string;
  trigger: PipelineTrigger;
  status: PipelineStatus;
  startedAt: string | null;
  finishedAt: string | null;
  stats: PipelineRunStats;
  error: string | null;
  createdAt: string;
  triggeredBy: string | null;
}

/** Effective pipeline configuration (from env) shown in the UI. */
export interface PipelineConfig {
  maxLlmCallsPerRun: number;
  batchSize: number;
  matchThreshold: number;
  eventWindowDays: number;
  schedule: string;
  llmMode: 'live' | 'mock';
  model: string;
}

export interface PipelineProgressEvent {
  runId: string;
  status: PipelineStatus;
  stage: string;
  progress: number; // 0–100
  stats: Partial<PipelineRunStats>;
  message?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Leads & CRM
// ────────────────────────────────────────────────────────────────────────────

export const LEAD_SORTS = ['score', 'recent', 'oldest', 'account'] as const;

export const leadListQuerySchema = pageQuerySchema.extend({
  stage: z.enum(LEAD_STAGES).optional(),
  band: z.enum(SCORE_BANDS).optional(),
  signalId: z.uuid().optional(),
  icpId: z.uuid().optional(),
  owner: z.union([z.enum(['me', 'unassigned', 'any']), z.uuid()]).default('any'),
  q: z.string().trim().max(120).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  sort: z.enum(LEAD_SORTS).default('score'),
});
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

export interface LeadListItem {
  id: string;
  account: { id: string; name: string; domain: string | null; industry: string | null; hqCountry: string | null };
  headlineSignal: { signalName: string; eventTitle: string; publishedAt: string } | null;
  signalCount: number;
  scoreTotal: number;
  scoreBand: ScoreBand;
  bant: { budget: number; authority: number; need: number; timeline: number };
  stage: LeadStage;
  owner: { id: string; name: string } | null;
  primaryContact: { id: string; name: string; title: string | null } | null;
  lastSignalAt: string | null;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface LeadEvidence {
  matchId: string;
  signalId: string;
  signalName: string;
  confidence: number;
  rationale: string;
  event: {
    id: string;
    title: string;
    summary: string;
    url: string | null;
    source: string;
    publishedAt: string;
    amount: number | null;
    currency: string | null;
    region: string | null;
  };
}

export interface Contact {
  id: string;
  name: string;
  title: string | null;
  persona: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  linkedinUrl: string | null;
  source: ContactSource;
}

export interface LeadDetail extends Omit<LeadListItem, 'bant'> {
  breakdown: ScoreBreakdown;
  fitScore: number;
  signalStrength: number;
  recencyScore: number;
  lostReason: string | null;
  wonValue: number | null;
  icp: { id: string; name: string } | null;
  account: LeadListItem['account'] & { description: string | null; sizeBand: string | null };
  contacts: Contact[];
  evidence: LeadEvidence[];
  suggestedPersonas: string[];
  version: number;
}

export const updateLeadSchema = z
  .object({
    stage: z.enum(LEAD_STAGES).optional(),
    ownerUserId: z.uuid().nullable().optional(),
    lostReason: text(500).optional(),
    wonValue: z.number().min(0).optional(),
    primaryContactId: z.uuid().optional(),
    version: z.number().int().optional(),
  })
  .refine((v) => v.stage !== 'LOST' || (v.lostReason && v.lostReason.length > 0), {
    message: 'lostReason is required when moving a lead to LOST',
    path: ['lostReason'],
  });

export const bulkLeadSchema = z.object({
  leadIds: z.array(z.uuid()).min(1).max(100),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('assign'), ownerUserId: z.uuid().nullable() }),
    z.object({ type: z.literal('stage'), stage: z.enum(LEAD_STAGES).exclude(['LOST']) }),
  ]),
});

export const contactSchema = z.object({
  name: text(160).min(2),
  title: text(160).optional(),
  persona: text(120).optional(),
  email: z.union([email, z.literal('')]).optional().transform((v) => v || undefined),
  phone: text(40).optional(),
  whatsapp: text(40).optional(),
  linkedinUrl: optionalUrl,
});

export const taskListQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  status: z.enum(['open', 'done', 'all']).default('open'),
});

export const createActivitySchema = z.object({
  type: z.enum(['NOTE']),
  body: text(10_000).min(1),
});

export interface Activity {
  id: string;
  type: ActivityType;
  direction: 'OUTBOUND' | 'INBOUND' | 'INTERNAL';
  subject: string | null;
  body: string | null;
  metadata: Record<string, unknown>;
  actor: { id: string; name: string } | null;
  occurredAt: string;
}

export const taskSchema = z.object({
  title: text(300).min(2),
  dueAt: z.iso.datetime({ offset: true }).optional(),
  assigneeUserId: z.uuid().optional(),
});
export const updateTaskSchema = taskSchema.partial().extend({ completed: z.boolean().optional() });

export interface Task {
  id: string;
  leadId: string;
  createdBy: string | null;
  title: string;
  dueAt: string | null;
  completedAt: string | null;
  assignee: { id: string; name: string } | null;
  lead?: { id: string; accountName: string };
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Outreach
// ────────────────────────────────────────────────────────────────────────────

export const outreachDraftSchema = z.object({
  channel: z.enum(['email', 'whatsapp', 'call']),
  contactId: z.uuid().optional(),
  tone: z.enum(['formal', 'friendly', 'concise']).default('formal'),
});

export interface OutreachDraft {
  channel: Exclude<OutreachChannel, 'meeting'>;
  subject?: string;
  body: string;
  talkingPoints?: string[];
  objections?: { objection: string; response: string }[];
  model: string;
}

export const outreachSendSchema = z.object({
  channel: z.literal('email'),
  contactId: z.uuid().optional(),
  to: email,
  subject: text(300).min(1),
  body: text(20_000).min(1),
});

export const outreachLogSchema = z.discriminatedUnion('channel', [
  z.object({
    channel: z.literal('whatsapp'),
    contactId: z.uuid().optional(),
    body: text(5000).optional(),
    notes: text(2000).optional(),
  }),
  z.object({
    channel: z.literal('call'),
    contactId: z.uuid().optional(),
    outcome: z.enum(['CONNECTED', 'NO_ANSWER', 'VOICEMAIL', 'WRONG_NUMBER', 'CALLBACK_REQUESTED']),
    durationMin: z.number().min(0).max(600).optional(),
    notes: text(5000).optional(),
  }),
  z.object({
    channel: z.literal('meeting'),
    contactId: z.uuid().optional(),
    meetingAt: z.iso.datetime({ offset: true }),
    calendlyUrl: optionalUrl,
    notes: text(5000).optional(),
  }),
]);

// ────────────────────────────────────────────────────────────────────────────
// Dashboards
// ────────────────────────────────────────────────────────────────────────────

export interface DashboardSummary {
  leads: number;
  approached: number;
  engaged: number;
  meetings: number;
  converted: number;
  lost: number;
  conversionRate: number; // converted / approached
  avgHoursToFirstTouch: number | null;
  hot: number;
  warm: number;
  cold: number;
  pipelineValueWon: number;
}

export interface FunnelStage {
  stage: LeadStage;
  count: number;
}
export interface TimeseriesPoint {
  week: string;
  HOT: number;
  WARM: number;
  COLD: number;
}
export interface SignalPerformance {
  signalId: string;
  signalName: string;
  leads: number;
  approached: number;
  converted: number;
}
export interface TeamMemberStats {
  userId: string;
  name: string;
  role: OrgRole;
  owned: number;
  touches: number;
  meetings: number;
  won: number;
}
export interface ChannelStats {
  channel: string;
  touches: number;
  leadsTouched: number;
  engagedAfter: number;
}
export interface OrgDashboard {
  summary: DashboardSummary;
  funnel: FunnelStage[];
  timeseries: TimeseriesPoint[];
  bySignal: SignalPerformance[];
  team: TeamMemberStats[];
  channels: ChannelStats[];
}

export interface PlatformDashboard {
  totals: {
    orgs: number;
    activeOrgs: number;
    users: number;
    leads: number;
    approached: number;
    converted: number;
    conversionRate: number;
    llmCost30dUsd: number;
    llmCalls30d: number;
  };
  orgs: (PlatformOrgListItem & PlatformOrgStats)[];
  byIndustry: { industry: Industry; leads: number; approached: number; converted: number }[];
  pipelineHealth: { runs30d: number; failed30d: number; avgDurationSec: number | null };
  model: string | null;
  llmMode: 'live' | 'mock';
}

// ────────────────────────────────────────────────────────────────────────────
// Audit
// ────────────────────────────────────────────────────────────────────────────

export const auditQuerySchema = pageQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  actorUserId: z.uuid().optional(),
  action: z.string().max(100).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(80).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export interface AuditEntry {
  id: string;
  occurredAt: string;
  scope: AuditScope;
  orgId: string | null;
  orgName?: string | null;
  actor: { id: string; name: string; email: string } | null;
  actorRole: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export const ACTIVITY_TYPE_VALUES = ACTIVITY_TYPES;
