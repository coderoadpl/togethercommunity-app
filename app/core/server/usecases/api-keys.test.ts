import { describe, expect, it } from 'vitest';

import {
  capabilitiesForApiKey,
  capabilitiesForPrincipal,
  type Identity,
  type ImportAuditEvent,
  type StaffRole,
  type TenantApiKey,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { ApiKeyCrypto, TenantApiKeyRepository } from '../ports.js';
import {
  createTenantApiKey,
  listImportAuditForApiKey,
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
  image: null,
  memberDisplayName: null,
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
    expect(h.rows[0]?.expiresAt).toBeNull();
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

  it('creates an expiring key with both import scopes', async () => {
    const h = harness();
    const expiresAt = '2026-06-08T00:00:00.000Z';
    const result = await createTenantApiKey(ctx('owner'), {
      name: 'Migration',
      scopes: ['import:content', 'import:users'],
      expiresAt,
    }, h.deps);
    expect(result).toMatchObject({
      ok: true,
      value: {
        apiKey: {
          name: 'Migration',
          scopes: ['import:content', 'import:users'],
          expiresAt,
        },
      },
    });
  });

  it('rejects import scopes without an expiry', async () => {
    const h = harness();
    const result = await createTenantApiKey(ctx('owner'), {
      name: 'Migration',
      scopes: ['import:content'],
    }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.rows).toHaveLength(0);
  });

  it('rejects import scopes combined with existing scopes', async () => {
    const h = harness();
    const result = await createTenantApiKey(ctx('owner'), {
      name: 'Unsafe migration',
      scopes: ['import:users', 'transactional'],
      expiresAt: '2026-06-08T00:00:00.000Z',
    }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.rows).toHaveLength(0);
  });

  it('rejects import expiry beyond 30 days', async () => {
    const h = harness();
    const result = await createTenantApiKey(ctx('owner'), {
      name: 'Long migration',
      scopes: ['import:content'],
      expiresAt: '2026-07-02T00:00:00.001Z',
    }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.rows).toHaveLength(0);
  });

  it('rejects an expiry that is not in the future', async () => {
    const h = harness();
    const result = await createTenantApiKey(ctx('owner'), {
      name: 'Expired migration',
      scopes: ['import:users'],
      expiresAt: NOW,
    }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.rows).toHaveLength(0);
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

  it('isolates import capabilities from existing and unscoped keys', () => {
    expect(capabilitiesForApiKey({ scopes: ['import:content', 'import:users'] })).toEqual([
      'import:content-write',
      'import:validate',
      'import:users-write',
    ]);
    expect(capabilitiesForApiKey({ scopes: null })).not.toContain('import:content-write');
    expect(capabilitiesForApiKey({ scopes: null })).not.toContain('import:users-write');
  });
});

describe('listTenantApiKeys', () => {
  it('lists keys without hashes for staff', async () => {
    const h = harness([
      { id: 'key-a', tenantId: 't1', name: 'A', keyHash: 'hash:a', scopes: null, createdAt: NOW, expiresAt: null, revokedAt: null },
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
      { id: 'key-a', tenantId: 't1', name: 'A', keyHash: 'hash:a', scopes: null, createdAt: NOW, expiresAt: null, revokedAt: null },
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
      { id: 'key-a', tenantId: 't1', name: 'A', keyHash: 'hash:a', scopes: null, createdAt: NOW, expiresAt: null, revokedAt: null },
    ]);
    const result = await revokeTenantApiKey(ctx('admin'), { id: 'key-a' }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });
});

describe('listImportAuditForApiKey', () => {
  const event: ImportAuditEvent = {
    id: 'audit-1', tenantId: 't1', apiKeyId: 'key-a', kind: 'member',
    importKey: 'member-source', resourceId: 'member-source', action: 'credential_created',
    payloadHash: 'a'.repeat(64), at: NOW,
  };

  it('lists the selected tenant key audit for the owner', async () => {
    const h = harness([
      { id: 'key-a', tenantId: 't1', name: 'A', keyHash: 'hash:a', scopes: ['import:users'], createdAt: NOW, expiresAt: '2026-06-08T00:00:00.000Z', revokedAt: null },
    ]);
    const result = await listImportAuditForApiKey(ctx('owner'), {
      id: 'key-a', limit: 50,
    }, {
      tenantApiKeys: h.deps.tenantApiKeys,
      importAuditEvents: {
        listByApiKey: async (tenantId, apiKeyId) => ({
          events: tenantId === 't1' && apiKeyId === 'key-a' ? [event] : [],
          nextCursor: null,
        }),
      },
    });

    expect(result).toEqual({ ok: true, value: { events: [event], nextCursor: null } });
  });

  it('forbids an admin from reading import audit', async () => {
    const h = harness([
      { id: 'key-a', tenantId: 't1', name: 'A', keyHash: 'hash:a', scopes: ['import:users'], createdAt: NOW, expiresAt: '2026-06-08T00:00:00.000Z', revokedAt: null },
    ]);
    const result = await listImportAuditForApiKey(ctx('admin'), {
      id: 'key-a', limit: 50,
    }, {
      tenantApiKeys: h.deps.tenantApiKeys,
      importAuditEvents: {
        listByApiKey: async () => ({ events: [event], nextCursor: null }),
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('does not expose audit for a key outside the tenant', async () => {
    const h = harness([
      { id: 'key-foreign', tenantId: 't2', name: 'Foreign', keyHash: 'hash:f', scopes: ['import:users'], createdAt: NOW, expiresAt: '2026-06-08T00:00:00.000Z', revokedAt: null },
    ]);
    const result = await listImportAuditForApiKey(ctx('owner'), {
      id: 'key-foreign', limit: 50,
    }, {
      tenantApiKeys: h.deps.tenantApiKeys,
      importAuditEvents: {
        listByApiKey: async () => ({ events: [event], nextCursor: null }),
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
