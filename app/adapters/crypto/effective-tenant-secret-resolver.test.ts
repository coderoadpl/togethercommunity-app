import { describe, expect, it } from 'vitest';

import {
  CONFIG_GROUP_POLICY,
  CONFIG_GROUPS,
  err,
  notFound,
  ok,
  organizationSecretKeySchema,
  tenantSecretKeySchema,
  type ConfigGroup,
  type OrganizationSecret,
  type OrganizationSecretKey,
} from '#core/domain/index.js';
import type { EffectiveTenantConfigReader, SecretCrypto, TenantSecretResolver } from '#core/server/index.js';

import { createEffectiveTenantSecretResolver } from './effective-tenant-secret-resolver.js';

const workspaceSecrets: TenantSecretResolver = {
  resolve: async (tenantId, key) => key === 'bunny.apiKey' ? err(notFound('absent')) : ok(`workspace:${tenantId}:${key}`),
};

const crypto: SecretCrypto = {
  encrypt: () => ({ ciphertext: 'x', iv: 'y', authTag: 'z' }),
  decrypt: ({ ciphertext }) => ok(`decrypted:${ciphertext}`),
};

const organizationSecret = (key: OrganizationSecretKey): OrganizationSecret => ({
  id: `org-secret-${key}`, organizationId: 'org-1', key, ciphertext: `org:${key}`, iv: 'iv', authTag: 'tag',
  maskedPreview: '***', updatedAt: '2026-11-15T10:00:00.000Z',
});

const readerFor = (
  sources: ReadonlySet<ConfigGroup>,
  secrets: ReadonlySet<OrganizationSecretKey>,
  calls: OrganizationSecretKey[] = [],
): Pick<EffectiveTenantConfigReader, 'findInheritedSecret'> => ({
  findInheritedSecret: async (_tenantId, key) => {
    calls.push(key);
    const group = CONFIG_GROUP_POLICY[key];
    if (group === 'workspace' || !sources.has(group)) return { source: 'workspace' };
    return { source: 'organization', value: secrets.has(key) ? organizationSecret(key) : null };
  },
});

const allGroups: ReadonlySet<ConfigGroup> = new Set(CONFIG_GROUPS);

describe('createEffectiveTenantSecretResolver', () => {
  it('returns the organization value for every inheritable key of a switched group', async () => {
    const resolver = createEffectiveTenantSecretResolver(
      workspaceSecrets, readerFor(allGroups, new Set(organizationSecretKeySchema.options)), crypto,
    );
    for (const key of organizationSecretKeySchema.options.filter((candidate) => !candidate.startsWith('shipx.'))) {
      expect(await resolver.resolve('acme', key)).toEqual(ok(`decrypted:org:${key}`));
    }
    for (const key of organizationSecretKeySchema.options.filter((candidate) => candidate.startsWith('shipx.'))) {
      expect(await resolver.resolve('acme', key)).toEqual(await workspaceSecrets.resolve('acme', key));
    }
  });

  it('answers not_found instead of the workspace row when the organization has no value', async () => {
    const resolver = createEffectiveTenantSecretResolver(workspaceSecrets, readerFor(allGroups, new Set()), crypto);
    expect(await resolver.resolve('acme', 'stripe.restrictedKey')).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await resolver.resolve('acme', 'ifirma.invoiceApiKey')).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('keeps every never-inherit key on the workspace without asking for the organization', async () => {
    const calls: OrganizationSecretKey[] = [];
    const resolver = createEffectiveTenantSecretResolver(
      workspaceSecrets, readerFor(allGroups, new Set(organizationSecretKeySchema.options), calls), crypto,
    );
    const neverInherited = tenantSecretKeySchema.options.filter((key) => CONFIG_GROUP_POLICY[key] === 'workspace');
    for (const key of neverInherited) {
      expect(await resolver.resolve('acme', key)).toEqual(await workspaceSecrets.resolve('acme', key));
    }
    expect(await resolver.resolve('acme', 'stripe.webhookSecret')).toEqual(ok('workspace:acme:stripe.webhookSecret'));
    expect(calls).toEqual([]);
  });

  it('inherits only the groups that have a source row', async () => {
    const resolver = createEffectiveTenantSecretResolver(
      workspaceSecrets, readerFor(new Set(['payments_live']), new Set(organizationSecretKeySchema.options)), crypto,
    );
    expect(await resolver.resolve('acme', 'stripe.restrictedKey')).toEqual(ok('decrypted:org:stripe.restrictedKey'));
    expect(await resolver.resolve('acme', 'stripe.testRestrictedKey')).toEqual(ok('workspace:acme:stripe.testRestrictedKey'));
    expect(await resolver.resolve('acme', 'smtp.host')).toEqual(ok('workspace:acme:smtp.host'));
  });
});
