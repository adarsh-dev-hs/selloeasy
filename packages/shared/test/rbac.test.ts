import { describe, expect, it } from 'vitest';
import { can, ROLE_PERMISSIONS } from '../src/rbac';

describe('RBAC matrix (plan §8.2)', () => {
  it('super admins only hold platform permissions (ADR-0010)', () => {
    expect(ROLE_PERMISSIONS.SUPER_ADMIN.every((p) => p.startsWith('platform:'))).toBe(true);
    expect(can('SUPER_ADMIN', 'leads:read')).toBe(false);
  });
  it('org roles never hold platform permissions', () => {
    for (const r of ['ORG_ADMIN', 'SALES_MANAGER', 'SDR', 'VIEWER'] as const) {
      expect(ROLE_PERMISSIONS[r].some((p) => p.startsWith('platform:'))).toBe(false);
    }
  });
  it('viewers are read-only', () => {
    expect(ROLE_PERMISSIONS.VIEWER.every((p) => p.endsWith(':read'))).toBe(true);
  });
  it('only admins manage users and read the org audit log', () => {
    expect(can('ORG_ADMIN', 'org:users:manage')).toBe(true);
    expect(can('SALES_MANAGER', 'org:users:manage')).toBe(false);
    expect(can('SALES_MANAGER', 'audit:org:read')).toBe(false);
    expect(can('SDR', 'leads:assign')).toBe(false);
    expect(can('SDR', 'leads:claim')).toBe(true);
  });
});
