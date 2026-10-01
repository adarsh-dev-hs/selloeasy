import type { OrgSettings } from '@selloeasy/shared';
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  id,
  industryEnum,
  orgRoleEnum,
  orgStatusEnum,
  timestamps,
  tsz,
  userStatusEnum,
} from './_helpers';

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    industry: industryEnum('industry').notNull(),
    status: orgStatusEnum('status').notNull().default('INVITED'),
    websiteUrl: text('website_url'),
    logoKey: text('logo_key'),
    hq: text('hq'),
    regions: text('regions').array().notNull().default(sql`'{}'::text[]`),
    companySize: text('company_size'),
    description: text('description'),
    settings: jsonb('settings').$type<OrgSettings>().notNull().default({}),
    activatedAt: tsz('activated_at'),
    suspendedAt: tsz('suspended_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('organizations_slug_uq').on(t.slug)],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    // Stored lower-cased; uniqueness enforced on the normalised value.
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    isSuperAdmin: boolean('is_super_admin').notNull().default(false),
    status: userStatusEnum('status').notNull().default('ACTIVE'),
    calendlyUrl: text('calendly_url'),
    phone: text('phone'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: tsz('locked_until'),
    lastLoginAt: tsz('last_login_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: orgRoleEnum('role').notNull(),
    status: userStatusEnum('status').notNull().default('ACTIVE'),
    ...timestamps,
  },
  (t) => [uniqueIndex('memberships_user_org_uq').on(t.userId, t.orgId), index('memberships_org_idx').on(t.orgId)],
);

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: orgRoleEnum('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: tsz('expires_at').notNull(),
    acceptedAt: tsz('accepted_at'),
    revokedAt: tsz('revoked_at'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('invitations_token_uq').on(t.tokenHash), index('invitations_org_idx').on(t.orgId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    familyId: uuid('family_id').notNull(),
    expiresAt: tsz('expires_at').notNull(),
    revokedAt: tsz('revoked_at'),
    replacedBy: uuid('replaced_by'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    ...timestamps,
  },
  (t) => [uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash), index('refresh_tokens_family_idx').on(t.familyId)],
);

export const passwordResets = pgTable(
  'password_resets',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: tsz('expires_at').notNull(),
    usedAt: tsz('used_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('password_resets_hash_uq').on(t.tokenHash)],
);
