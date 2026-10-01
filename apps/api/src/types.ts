import type { Config, Redis } from '@selloeasy/core';
import type { LlmClient } from '@selloeasy/llm';
import type { OrgRole, Role } from '@selloeasy/shared';
import type { AuditEntryInput } from '@selloeasy/engine';
import type { DbOrTx } from '@selloeasy/db';

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  /** Effective role: SUPER_ADMIN for platform admins, otherwise the org membership role. */
  role: Role;
  orgRole: OrgRole | null;
  /** Tenant resolved from the membership — never from the request body (plan §8.1). */
  orgId: string | null;
}

export type AuditInput = Omit<AuditEntryInput, 'scope' | 'orgId' | 'actorUserId' | 'actorRole' | 'ip' | 'userAgent' | 'requestId'> & {
  scope?: AuditEntryInput['scope'];
  orgId?: string | null;
};

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
    auditRecorded: boolean;
    /** Record an audit entry for this request (use the same tx as the change). */
    audit(entry: AuditInput, db?: DbOrTx): Promise<void>;
  }
  interface FastifyInstance {
    config: Config;
    redis: Redis;
    llm: LlmClient;
  }
}
