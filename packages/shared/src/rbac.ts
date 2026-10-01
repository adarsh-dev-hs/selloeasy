import type { OrgRole, Role } from './enums';

/**
 * Permission matrix (plan §8.2). The server is the only enforcement point;
 * the web app uses the same matrix purely to hide controls.
 *
 * Super Admin permissions are intentionally limited to `platform:*` —
 * Super Admins have no org membership and cannot read tenant data (ADR-0010).
 */
export const PERMISSIONS = [
  'platform:orgs:manage',
  'platform:orgs:public:read',
  'platform:orgs:aggregates:read',
  'platform:dashboard:read',
  'platform:signal_templates:manage',
  'platform:audit:read',
  // Platform data source (plan2 §11.1)
  'platform:data:read',
  'platform:data:import',
  'platform:data:manage',
  'org:profile:read',
  'org:profile:write',
  'org:users:manage',
  'icps:read',
  'icps:write',
  'signals:read',
  'signals:write',
  'pipeline:read',
  'pipeline:run',
  'leads:read',
  'leads:assign',
  'leads:claim',
  'leads:update',
  'leads:export',
  'outreach:send',
  'tasks:write',
  'dashboard:org:read',
  'dashboard:self:read',
  'audit:org:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ORG_READ: Permission[] = [
  'org:profile:read',
  'icps:read',
  'signals:read',
  'pipeline:read',
  'leads:read',
  'dashboard:self:read',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: [
    'platform:orgs:manage',
    'platform:orgs:public:read',
    'platform:orgs:aggregates:read',
    'platform:dashboard:read',
    'platform:signal_templates:manage',
    'platform:audit:read',
    'platform:data:read',
    'platform:data:import',
    'platform:data:manage',
  ],
  ORG_ADMIN: [
    ...ORG_READ,
    'org:profile:write',
    'org:users:manage',
    'icps:write',
    'signals:write',
    'pipeline:run',
    'leads:assign',
    'leads:claim',
    'leads:update',
    'leads:export',
    'outreach:send',
    'tasks:write',
    'dashboard:org:read',
    'audit:org:read',
  ],
  SALES_MANAGER: [
    ...ORG_READ,
    'icps:write',
    'signals:write',
    'pipeline:run',
    'leads:assign',
    'leads:claim',
    'leads:update',
    'leads:export',
    'outreach:send',
    'tasks:write',
    'dashboard:org:read',
  ],
  // SDR mutations are further restricted to leads they own (see `requiresOwnership`).
  SDR: [...ORG_READ, 'leads:claim', 'leads:update', 'outreach:send', 'tasks:write'],
  VIEWER: [...ORG_READ, 'dashboard:org:read'],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * Roles whose lead mutations are limited to leads they own.
 * Managers and admins may act on any lead in their org.
 */
export function requiresOwnership(role: Role): boolean {
  return role === 'SDR';
}

/** Roles that an org admin may grant via invites. */
export const INVITABLE_ROLES: readonly OrgRole[] = ['ORG_ADMIN', 'SALES_MANAGER', 'SDR', 'VIEWER'];
