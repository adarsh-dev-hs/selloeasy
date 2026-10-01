import type { OutreachChannel, PipelineTrigger } from '@selloeasy/shared';
import { Queue, QueueEvents, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { getConfig } from './config';
import { redisOptions } from './redis';

/** Queue names (plan §6). One queue per job family so concurrency can be tuned independently. */
export const QUEUES = {
  profile: 'profile',
  pipeline: 'pipeline',
  outreach: 'outreach',
  maintenance: 'maintenance',
  ingestion: 'ingestion',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface ProcessSourceJob {
  kind: 'source.process';
  orgId: string;
  sourceId: string;
}
export interface GenerateProfileJob {
  kind: 'profile.generate';
  orgId: string;
  requestedBy: string | null;
}
export type ProfileJob = ProcessSourceJob | GenerateProfileJob;

export interface PipelineRunJob {
  kind: 'pipeline.run';
  orgId: string;
  runId: string;
  trigger: PipelineTrigger;
}
export interface PipelineScheduleTickJob {
  kind: 'pipeline.schedule-tick';
}
export type PipelineJob = PipelineRunJob | PipelineScheduleTickJob;

export interface SendEmailJob {
  kind: 'outreach.send-email';
  orgId: string;
  messageId: string;
}
export interface SendInviteEmailJob {
  kind: 'mail.invite';
  to: string;
  orgName: string;
  role: string;
  link: string;
  invitedByName: string | null;
}
export interface SendPasswordResetJob {
  kind: 'mail.password-reset';
  to: string;
  link: string;
}
export type OutreachJob = SendEmailJob | SendInviteEmailJob | SendPasswordResetJob;

/** Platform data source jobs (plan2 §6–7). */
export interface ImportValidateJob {
  kind: 'import.validate';
  batchId: string;
}
export interface ImportCommitJob {
  kind: 'import.commit';
  batchId: string;
  userId: string;
}
export interface IngestionRunJob {
  kind: 'ingestion.run';
  runId: string;
}
export interface ConnectorScheduleJob {
  kind: 'ingestion.schedule';
  connectorId: string;
}
export type IngestionJob = ImportValidateJob | ImportCommitJob | IngestionRunJob | ConnectorScheduleJob;

export interface AuditRetentionJob {
  kind: 'maintenance.audit-retention';
}
export interface StagingPurgeJob {
  kind: 'maintenance.staging-purge';
}
export type MaintenanceJob = AuditRetentionJob | StagingPurgeJob;

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

export function bullConnection(): ConnectionOptions {
  const config = getConfig();
  const u = new URL(config.REDIS_URL);
  const opts = redisOptions();
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0,
    ...opts,
  };
}

const queues = new Map<string, Queue>();

export function getQueue<T = unknown>(name: QueueName): Queue<T> {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: bullConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
    queues.set(name, q);
  }
  return q as Queue<T>;
}

export function createQueueEvents(name: QueueName): QueueEvents {
  return new QueueEvents(name, { connection: bullConnection() });
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}

/** Redis pub/sub channel used to stream pipeline progress to SSE clients. */
export const pipelineProgressChannel = (runId: string) => `pipeline:progress:${runId}`;
export const orgEventsChannel = (orgId: string) => `org:events:${orgId}`;
export const ingestionProgressChannel = (runId: string) => `ingestion:progress:${runId}`;
export const batchProgressChannel = (batchId: string) => `batch:progress:${batchId}`;

export type { OutreachChannel };
