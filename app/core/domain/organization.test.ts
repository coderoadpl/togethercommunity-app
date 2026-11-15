import { describe, expect, it } from 'vitest';

import {
  CONFIG_GROUP_POLICY,
  CONFIG_GROUPS,
  configGroupSchema,
  NEVER_INHERIT_SECRET_KEYS,
  ORGANIZATION_SECRET_GROUP,
  organizationAuditEventSchema,
  organizationMemberSchema,
  organizationSchema,
  organizationSecretKeySchema,
  setOrganizationSecretInputSchema,
  updateOrganizationInputSchema,
  workspaceConfigSourcesOf,
} from './organization.js';
import { tenantSecretKeySchema } from './tenant-secret.js';

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

describe('organization secret allow-list', () => {
  it('rejects per-workspace callback identities, storage, video and analytics keys', () => {
    const refused = tenantSecretKeySchema.options.filter((key) => !organizationSecretKeySchema.safeParse(key).success);
    expect(refused.toSorted()).toEqual([
      'analyticsMetaCapiAccessToken',
      'bunny.apiKey',
      'bunny.securityKey',
      's3.accessKeyId',
      's3.configuration',
      's3.secretAccessKey',
      'stripe.testLastEventAt',
      'stripe.testWebhookEndpointId',
      'stripe.testWebhookSecret',
      'stripe.webhookEndpointId',
      'stripe.webhookSecret',
    ]);
  });

  it('maps every allowed key to the configuration group it feeds', () => {
    expect(Object.keys(ORGANIZATION_SECRET_GROUP).toSorted()).toEqual([...organizationSecretKeySchema.options].toSorted());
    expect(new Set(Object.values(ORGANIZATION_SECRET_GROUP))).toEqual(new Set(CONFIG_GROUPS));
    expect(ORGANIZATION_SECRET_GROUP['ksef.test.token']).toBe('invoicing');
    expect(ORGANIZATION_SECRET_GROUP['resend.apiKey']).toBe('email_transport');
  });

  it('keeps the dedicated-flow keys out of the generic setter', () => {
    for (const key of ['stripe.restrictedKey', 'stripe.testRestrictedKey', 'telemetry.mongodb', 'stripe.webhookSecret', 's3.accessKeyId']) {
      expect(setOrganizationSecretInputSchema.safeParse({ key, value: 'value-1234' }).success, key).toBe(false);
    }
    expect(setOrganizationSecretInputSchema.parse({ key: 'smtp.password', value: ' value-1234 ' })).toEqual({ key: 'smtp.password', value: 'value-1234' });
  });
});

describe('organization settings input', () => {
  it('needs at least one known field and validates enumerations', () => {
    expect(updateOrganizationInputSchema.safeParse({}).success).toBe(false);
    expect(updateOrganizationInputSchema.safeParse({ slug: 'renamed' }).success).toBe(false);
    expect(updateOrganizationInputSchema.safeParse({ invoicingProvider: 'other' }).success).toBe(false);
    expect(updateOrganizationInputSchema.safeParse({ legalName: '  ' }).success).toBe(false);
    expect(updateOrganizationInputSchema.parse({ invoicingProvider: null, shipxEnvironment: 'production' }))
      .toEqual({ invoicingProvider: null, shipxEnvironment: 'production' });
  });

  it('knows exactly the six inheritable configuration groups', () => {
    expect(configGroupSchema.options).toEqual(['payments_live', 'payments_test', 'invoicing', 'email_transport', 'telemetry', 'shipping_carrier']);
    for (const group of ['branding', 'vat', 'storage', 'analytics']) expect(configGroupSchema.safeParse(group).success, group).toBe(false);
  });

  it('reports every group, defaulting to the workspace source', () => {
    expect(workspaceConfigSourcesOf([
      { tenantId: 'acme', group: 'invoicing', source: 'organization', updatedAt: '2026-11-15T10:00:00.000Z', updatedByUserId: 'owner-1' },
    ])).toEqual(CONFIG_GROUPS.map((group) => group === 'invoicing'
      ? { group, source: 'organization', updatedAt: '2026-11-15T10:00:00.000Z', updatedByUserId: 'owner-1' }
      : { group, source: 'workspace', updatedAt: null, updatedByUserId: null }));
  });
});

describe('configuration group policy', () => {
  const expectedPolicy = {
    analyticsMetaCapiAccessToken: 'workspace',
    'stripe.restrictedKey': 'payments_live',
    'stripe.webhookSecret': 'workspace',
    'stripe.webhookEndpointId': 'workspace',
    'stripe.testRestrictedKey': 'payments_test',
    'stripe.testWebhookSecret': 'workspace',
    'stripe.testWebhookEndpointId': 'workspace',
    'stripe.testLastEventAt': 'workspace',
    'bunny.apiKey': 'workspace',
    'bunny.securityKey': 'workspace',
    's3.accessKeyId': 'workspace',
    's3.secretAccessKey': 'workspace',
    's3.configuration': 'workspace',
    'telemetry.mongodb': 'telemetry',
    'ses.accessKeyId': 'email_transport',
    'ses.secretAccessKey': 'email_transport',
    'ses.region': 'email_transport',
    'smtp.host': 'email_transport',
    'smtp.port': 'email_transport',
    'smtp.user': 'email_transport',
    'smtp.password': 'email_transport',
    'smtp.secure': 'email_transport',
    'resend.apiKey': 'email_transport',
    'ifirma.invoiceApiKey': 'invoicing',
    'ifirma.username': 'invoicing',
    'ksef.token': 'invoicing',
    'ksef.contextNip': 'invoicing',
    'ksef.test.token': 'invoicing',
    'ksef.test.contextNip': 'invoicing',
    'shipx.organizationId': 'shipping_carrier',
    'shipx.token': 'shipping_carrier',
  };

  it('classifies every workspace secret key, so a new key fails until it is classified', () => {
    expect(Object.keys(CONFIG_GROUP_POLICY).toSorted()).toEqual([...tenantSecretKeySchema.options].toSorted());
    expect(Object.keys(expectedPolicy).toSorted()).toEqual([...tenantSecretKeySchema.options].toSorted());
    expect(CONFIG_GROUP_POLICY).toEqual(expectedPolicy);
  });

  it('never inherits the webhook signing secrets, endpoint IDs and delivery evidence', () => {
    expect(NEVER_INHERIT_SECRET_KEYS).toEqual(expect.arrayContaining([
      'stripe.webhookSecret',
      'stripe.webhookEndpointId',
      'stripe.testWebhookSecret',
      'stripe.testWebhookEndpointId',
      'stripe.testLastEventAt',
    ]));
    expect([...NEVER_INHERIT_SECRET_KEYS].toSorted()).toEqual(
      tenantSecretKeySchema.options.filter((key) => expectedPolicy[key] === 'workspace').toSorted(),
    );
  });

  it('inherits exactly the organization allow-list, each key through its group', () => {
    const inheritable = tenantSecretKeySchema.options.filter((key) => CONFIG_GROUP_POLICY[key] !== 'workspace');
    expect(inheritable.toSorted()).toEqual([...organizationSecretKeySchema.options].toSorted());
    for (const key of organizationSecretKeySchema.options) {
      expect(CONFIG_GROUP_POLICY[key]).toBe(ORGANIZATION_SECRET_GROUP[key]);
    }
    expect(NEVER_INHERIT_SECRET_KEYS.filter((key) => organizationSecretKeySchema.safeParse(key).success)).toEqual([]);
  });
});
