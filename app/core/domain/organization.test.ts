import { describe, expect, it } from 'vitest';

import { organizationAuditEventSchema, organizationMemberSchema, organizationSchema } from './organization.js';

const organization = {
  id: 'org-1', slug: 'holding', name: 'Holding', status: 'active', maxWorkspaces: 2,
  createdAt: '2026-11-15T10:00:00.000Z', updatedAt: '2026-11-15T10:00:00.000Z',
};

describe('organization schemas', () => {
  it('applies the tenant slug rules to organization slugs', () => {
    expect(organizationSchema.parse({ ...organization, slug: ' Holding-Group ' }).slug).toBe('holding-group');
    expect(organizationSchema.safeParse({ ...organization, slug: 'www' }).success).toBe(false);
    expect(organizationSchema.safeParse({ ...organization, slug: '-holding' }).success).toBe(false);
    expect(organizationSchema.safeParse({ ...organization, slug: 'ab' }).success).toBe(false);
  });

  it('refuses a negative workspace limit and an unknown member role', () => {
    expect(organizationSchema.safeParse({ ...organization, maxWorkspaces: -1 }).success).toBe(false);
    expect(organizationMemberSchema.safeParse({
      id: 'member-1', organizationId: 'org-1', userId: 'user-1', role: 'member',
      createdAt: '2026-11-15T10:00:00.000Z', createdByUserId: 'operator',
    }).success).toBe(false);
  });

  it('refuses an audit kind outside the organization audit vocabulary', () => {
    const event = {
      id: 'audit-1', organizationId: 'org-1', kind: 'workspace.linked', actorUserId: 'user-1',
      actorEmail: 'owner@example.test', actorKeyId: null, subjectTenantId: 'acme', subjectUserId: null,
      data: {}, at: '2026-11-15T10:00:00.000Z',
    };
    expect(organizationAuditEventSchema.safeParse(event).success).toBe(true);
    expect(organizationAuditEventSchema.safeParse({ ...event, kind: 'tenant_provisioned' }).success).toBe(false);
  });
});
