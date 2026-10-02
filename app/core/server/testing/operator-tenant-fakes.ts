import { capabilitiesForPrincipal, tenantSettingsSchema, type Identity, type Product, type StorageCorsCacheEntry, type Tenant, type TenantAuditEventInput, type TenantSecret } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { ProvisionTenantDeps } from '../usecases/provision-tenant.js';

export const operatorIdentity: Identity = {
  userId: 'operator-secret', email: 'operator@together.invalid', name: 'Instance operator',
  emailVerified: true, image: null, tenantAccess: 'none', tenantId: null,
  tenantSlug: null, tenantName: null, staffRole: null, memberId: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null,
  memberLanguage: null, memberVideoAutoplay: false,
};

export const operatorCtx: Ctx = { identity: operatorIdentity, capabilities: capabilitiesForPrincipal('operator-secret') };

export const operatorTenantHarness = () => {
  const tenants: Tenant[] = [];
  const owners = new Map<string, string>();
  const audits: TenantAuditEventInput[] = [];
  const secrets: TenantSecret[] = [];
  const products: Product[] = [];
  const initialProbe: StorageCorsCacheEntry | null = null;
  const state: {
    owner: { userId: string; emailVerified: boolean }; ownerExists: boolean;
    probe: StorageCorsCacheEntry | null; settings: ReturnType<typeof tenantSettingsSchema.parse>;
    calls: number; ownerEmails: string[]; creationOptions: Array<{ requireEmpty: boolean; idempotentOwner?: boolean } | undefined>;
  } = {
    owner: { userId: 'owner-1', emailVerified: true },
    ownerExists: true,
    probe: initialProbe,
    settings: tenantSettingsSchema.parse({ name: 'Acme', billingPortalUrl: null, bunnyStreamLibraryId: null }),
    calls: 0,
    ownerEmails: new Array<string>(),
    creationOptions: new Array<{ requireEmpty: boolean; idempotentOwner?: boolean } | undefined>(),
  };
  let nextId = 0;
  const deps: ProvisionTenantDeps = {
    ids: { nextId: () => `id-${++nextId}` },
    clock: { nowIso: () => '2026-10-01T12:00:00.000Z' },
    authPort: { findUserByEmail: async (email) => {
      state.calls += 1;
      state.ownerEmails.push(email);
      return state.ownerExists ? state.owner : null;
    } },
    tenants: {
      findBySlug: async (slug) => { state.calls += 1; return tenants.find((tenant) => tenant.slug === slug) ?? null; },
      findById: async (id) => tenants.find((tenant) => tenant.id === id) ?? null,
      findSole: async () => tenants.length === 1 ? tenants[0] ?? null : null,
      findSettings: async () => state.settings,
      updateSettings: async (_tenantId, settings) => settings,
      hasAny: async () => tenants.length > 0,
      createTenantWithOwnerGrant: async (input, options) => {
        state.creationOptions.push(options);
        const existing = tenants.find((tenant) => tenant.slug === input.tenant.slug);
        if (existing !== undefined) return owners.get(existing.id) === input.ownerGrant.userId ? existing : null;
        const tenant: Tenant = { ...input.tenant, status: 'active', plan: 'self_hosted', contentVersion: 1 };
        tenants.push(tenant);
        owners.set(tenant.id, input.ownerGrant.userId);
        if (input.provisionAudit !== undefined) audits.push(input.provisionAudit);
        return tenant;
      },
    },
    tenantAccess: { listStaffForTenant: async (id) => {
      const owner = owners.get(id);
      return owner === undefined ? [] : [{ userId: owner, email: 'owner@example.test', staffRole: 'owner', language: null }];
    } },
    tenantSecrets: { listByTenant: async () => secrets },
    storageCorsCache: { read: async () => state.probe },
    products: { listPublishedByTenant: async () => products },
  };
  return { deps, state, tenants, owners, audits, secrets, products };
};
