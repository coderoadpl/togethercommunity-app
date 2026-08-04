import { describe, expect, it } from 'vitest';

import {
  capabilitiesForApiKey,
  capabilitiesForPrincipal,
  type Identity,
  type StaffRole,
  type TenantApiKey,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { ApiKeyCrypto, TenantApiKeyRepository } from '../ports.js';
import {
  createTenantApiKey,
  listTenantApiKeys,
  revokeTenantApiKey,
  type ApiKeyDeps,
} from './api-keys.js';

const NOW = '2026-06-01T00:00:00.000Z';

const ctx = (staffRole: StaffRole | null, tenantId: string | null = 't1'): Ctx => {
  const identity: Identity = {
    userId: 'u1',
    email: 'owner@together.dev',
    name: 'Owner',
    emailVerified: true,
    tenantId,
    tenantSlug: tenantId ? 'acme' : null,
    tenantName: tenantId ? 'Acme' : null,
    staffRole,
    memberId: null,
  memberBannedAt: null,
  };
  return { identity };
};

const harness = (rows: TenantApiKey[] = []): { deps: ApiKeyDeps; rows: TenantApiKey[] } => {
  const store = [...rows];
  let seq = 0;
  const tenantApiKeys: TenantApiKeyRepository = {
    listByTenant: async (tenantId) => store.filter((r) => r.tenantId === tenantId),
    create: async (_t, apiKey) => {
      store.push(apiKey);
    },
    findActiveByHash: async () => null,
    revoke: async (tenantId, id, revokedAt) => {
      const row = store.find((r) => r.tenantId === tenantId && r.id === id && r.revokedAt === null);
      if (!row) return null;
      row.revokedAt = revokedAt;
      return row;
    },
  };
  const apiKeyCrypto: ApiKeyCrypto = {
    generateSecret: () => 'super-secret-value',
    hash: (secret) => `hash:${secret}`,
  };
  return {
    rows: store,
    deps: { tenantApiKeys, apiKeyCrypto, ids: { nextId: () => `key-${(seq += 1)}` }, clock: { nowIso: () => NOW } },
  };
};

describe('createTenantApiKey', () => {
  it('lets the owner create a key and returns the secret once', async () => {
    const h = harness();
    const result = await createTenantApiKey(ctx('owner'), { name: 'CI key' }, h.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.secret).toBe('super-secret-value');
    expect(result.value.apiKey.name).toBe('CI key');
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]?.keyHash).toBe('hash:super-secret-value');
    expect(h.rows[0]?.scopes).toBeNull();
    expect('keyHash' in result.value.apiKey).toBe(false);
  });

  it('creates a key limited to transactional e-mail', async () => {
    const h = harness();
    const result = await createTenantApiKey(ctx('owner'), {
      name: 'Orders',
      scopes: ['transactional'],
    }, h.deps);
    expect(result).toMatchObject({
      ok: true,
      value: { apiKey: { name: 'Orders', scopes: ['transactional'] } },
    });
    expect(h.rows[0]?.scopes).toEqual(['transactional']);
  });

  it('forbids an admin from creating a key', async () => {
    const h = harness();
    const result = await createTenantApiKey(ctx('admin'), { name: 'CI key' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.rows).toHaveLength(0);
  });

  it('rejects a blank name', async () => {
    const h = harness();
    const result = await createTenantApiKey(ctx('owner'), { name: '  ' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

describe('API key scope capabilities', () => {
  it('derives the marketing scope from the legacy API-key principal', () => {
    expect(capabilitiesForApiKey({ scopes: ['marketing'] })).toEqual(
      capabilitiesForPrincipal('api-key').filter((capability) => capability !== 'enrollment:create'),
    );
  });
});

describe('listTenantApiKeys', () => {
  it('lists keys without hashes for staff', async () => {
    const h = harness([
      { id: 'key-a', tenantId: 't1', name: 'A', keyHash: 'hash:a', scopes: null, createdAt: NOW, revokedAt: null },
    ]);
    const result = await listTenantApiKeys(ctx('admin'), h.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(JSON.stringify(result.value)).not.toContain('hash:a');
  });

  it('forbids a non-staff caller', async () => {
    const h = harness();
    const result = await listTenantApiKeys(ctx(null), h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});

describe('revokeTenantApiKey', () => {
  it('lets the owner revoke a key', async () => {
    const h = harness([
      { id: 'key-a', tenantId: 't1', name: 'A', keyHash: 'hash:a', scopes: null, createdAt: NOW, revokedAt: null },
    ]);
    const result = await revokeTenantApiKey(ctx('owner'), { id: 'key-a' }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { id: 'key-a', revokedAt: NOW } });
    expect(h.rows[0]?.revokedAt).toBe(NOW);
  });

  it('is not found for an unknown key', async () => {
    const h = harness();
    const result = await revokeTenantApiKey(ctx('owner'), { id: 'ghost' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('forbids an admin from revoking', async () => {
    const h = harness([
      { id: 'key-a', tenantId: 't1', name: 'A', keyHash: 'hash:a', scopes: null, createdAt: NOW, revokedAt: null },
    ]);
    const result = await revokeTenantApiKey(ctx('admin'), { id: 'key-a' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});
