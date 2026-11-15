import { describe, expect, it } from 'vitest';

import {
  capabilitiesForApiKey,
  capabilitiesForPrincipal,
  type CreateApiKeyInput,
  type Identity,
  type ImpersonationPrincipal,
  type ImportAuditEvent,
  type ShopManagementKeysSwitch,
  type StaffRole,
  type TenantApiKey,
  type ShopManagementKeyEvent,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { ApiKeyCrypto, TenantApiKeyRepository } from '../ports.js';
import {
  createTenantApiKey,
  listImportAuditForApiKey,
  listTenantApiKeys,
  purgeShopManagementKeys,
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
    tenantAccess: tenantId === null ? 'none' : staffRole === null ? 'member' : 'staff',
    tenantId,
    tenantSlug: tenantId ? 'acme' : null,
    tenantName: tenantId ? 'Acme' : null,
    staffRole,
    memberId: null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
  };
  return { identity };
};

const harness = (rows: TenantApiKey[] = [], shopManagementKeys: ShopManagementKeysSwitch = 'enabled'): {
  deps: ApiKeyDeps;
  rows: TenantApiKey[];
  events: ShopManagementKeyEvent[];
} => {
  const store = [...rows];
  const events: ShopManagementKeyEvent[] = [];
  let seq = 0;
  const revokeKind = (tenantId: string, id: string, revokedAt: string, kind: TenantApiKey['kind']) => {
    const row = store.find((r) => r.tenantId === tenantId && r.id === id && r.kind === kind && r.revokedAt === null);
    if (!row) return null;
    row.revokedAt = revokedAt;
    return row;
  };
  const tenantApiKeys: TenantApiKeyRepository = {
    listByTenant: async (tenantId) => store.filter((r) => r.tenantId === tenantId),
    create: async (_t, apiKey) => {
      store.push(apiKey);
    },
    findActiveByHash: async () => null,
    findByHash: async () => null,
    revoke: async (tenantId, id, revokedAt) => revokeKind(tenantId, id, revokedAt, 'legacy'),
    createShopManagement: async (_t, apiKey, event) => {
      store.push(apiKey);
      events.push(event);
    },
    revokeShopManagement: async (tenantId, id, revokedAt, event) => {
      const row = revokeKind(tenantId, id, revokedAt, 'shop_management');
      if (row) events.push(event);
      return row;
    },
    purgeShopManagement: async (tenantId, event) => {
      const purged = store.filter((r) => r.tenantId === tenantId && r.kind === 'shop_management');
      for (const row of purged) {
        store.splice(store.indexOf(row), 1);
        events.push(event(row.id));
      }
      return purged.length;
    },
  };
  const apiKeyCrypto: ApiKeyCrypto = {
    generateSecret: () => 'super-secret-value',
    hash: (secret) => `hash:${secret}`,
  };
  return {
    rows: store,
    events,
    deps: {
      tenantApiKeys,
      apiKeyCrypto,
      ids: { nextId: () => `key-${(seq += 1)}` },
      clock: { nowIso: () => NOW },
      shopManagementKeys,
    },
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

  it.each(['subscriptions:read', 'subscriptions:adopt'] as const)('creates a key explicitly scoped to %s', async (scope) => {
    const h = harness();
    expect(await createTenantApiKey(ctx('owner'), { name: 'Subscriptions', scopes: [scope] }, h.deps))
      .toMatchObject({ ok: true, value: { apiKey: { scopes: [scope] } } });
    expect(h.rows[0]?.scopes).toEqual([scope]);
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

  it.each(['enrollment', 'marketing', 'transactional', 'subscriptions:read', 'subscriptions:adopt'] as const)('rejects import scopes combined with %s', async (scope) => {
    const h = harness();
    const result = await createTenantApiKey(ctx('owner'), {
      name: 'Unsafe migration',
      scopes: ['import:users', scope],
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
  it.each([null, undefined, 'enrollment', 'marketing', 'transactional', 'import:content', 'import:users'] as const)(
    'withholds subscription capabilities from existing scopes: %s', (scope) => {
      const capabilities = capabilitiesForApiKey(scope === undefined ? {} : { scopes: scope === null ? null : [scope] });
      expect(capabilities).not.toContain('subscriptions:read');
      expect(capabilities).not.toContain('subscriptions:adopt');
    },
  );

  it('keeps subscription read and adoption independent and combines them explicitly', () => {
    expect(capabilitiesForApiKey({ scopes: ['subscriptions:read'] })).toEqual(['subscriptions:read']);
    expect(capabilitiesForApiKey({ scopes: ['subscriptions:adopt'] })).toEqual(['subscriptions:adopt']);
    expect(capabilitiesForApiKey({ scopes: ['subscriptions:read', 'subscriptions:adopt'] }))
      .toEqual(['subscriptions:read', 'subscriptions:adopt']);
  });

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
      { id: 'key-a', tenantId: 't1', name: 'A', keyHash: 'hash:a', kind: 'legacy', issuedByUserId: null, scopes: null, createdAt: NOW, expiresAt: null, revokedAt: null },
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
      { id: 'key-a', tenantId: 't1', name: 'A', keyHash: 'hash:a', kind: 'legacy', issuedByUserId: null, scopes: null, createdAt: NOW, expiresAt: null, revokedAt: null },
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
      { id: 'key-a', tenantId: 't1', name: 'A', keyHash: 'hash:a', kind: 'legacy', issuedByUserId: null, scopes: null, createdAt: NOW, expiresAt: null, revokedAt: null },
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
      { id: 'key-a', tenantId: 't1', name: 'A', keyHash: 'hash:a', kind: 'legacy', issuedByUserId: null, scopes: ['import:users'], createdAt: NOW, expiresAt: '2026-06-08T00:00:00.000Z', revokedAt: null },
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
      { id: 'key-a', tenantId: 't1', name: 'A', keyHash: 'hash:a', kind: 'legacy', issuedByUserId: null, scopes: ['import:users'], createdAt: NOW, expiresAt: '2026-06-08T00:00:00.000Z', revokedAt: null },
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
      { id: 'key-foreign', tenantId: 't2', name: 'Foreign', keyHash: 'hash:f', kind: 'legacy', issuedByUserId: null, scopes: ['import:users'], createdAt: NOW, expiresAt: '2026-06-08T00:00:00.000Z', revokedAt: null },
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

describe('shop management keys', () => {
  const SEVEN_DAYS = '2026-06-08T00:00:00.000Z';
  const shopInput: CreateApiKeyInput = {
    name: 'Shop backend',
    kind: 'shop_management',
    scopes: ['shop:catalog:read', 'shop:catalog:write'],
    expiresAt: SEVEN_DAYS,
  };
  const shopRow = (overrides: Partial<TenantApiKey> = {}): TenantApiKey => ({
    id: 'shop-key', tenantId: 't1', name: 'Shop backend', keyHash: 'hash:shop', kind: 'shop_management',
    scopes: ['shop:orders:read'], issuedByUserId: 'u1', createdAt: NOW, expiresAt: SEVEN_DAYS, revokedAt: null,
    ...overrides,
  });
  const impersonation: ImpersonationPrincipal = {
    id: 'imp-1', actorUserId: 'u1', actorEmail: 'owner@together.dev', actorName: 'Owner', actorStaffRole: 'owner',
    subjectMemberId: 'm1', subjectName: 'Member', expiresAt: SEVEN_DAYS,
  };
  const denyingContexts: [string, Ctx][] = [
    ['an admin', ctx('admin')],
    ['an owner with an unverified email', { identity: { ...ctx('owner').identity, emailVerified: false } }],
    ['an impersonating owner', { ...ctx('owner'), impersonation }],
    ['a capability override context', { ...ctx('owner'), capabilities: ['api-key:write', 'api-key:read'] }],
  ];

  it('records the issuing owner and returns the secret only in the create result', async () => {
    const h = harness();
    const result = await createTenantApiKey(ctx('owner'), shopInput, h.deps);

    expect(result).toEqual({
      ok: true,
      value: {
        secret: 'super-secret-value',
        apiKey: {
          id: 'key-1', tenantId: 't1', name: 'Shop backend', kind: 'shop_management',
          scopes: ['shop:catalog:read', 'shop:catalog:write'], issuedByUserId: 'u1',
          createdAt: NOW, expiresAt: SEVEN_DAYS, revokedAt: null,
        },
      },
    });
    expect(h.rows).toEqual([expect.objectContaining({ kind: 'shop_management', issuedByUserId: 'u1', keyHash: 'hash:super-secret-value' })]);
    expect(h.events).toEqual([{
      id: 'key-2', tenantId: 't1', apiKeyId: 'key-1', kind: 'created', actorUserId: 'u1',
      method: null, route: null, resourceId: null, status: null, outcome: 'succeeded', at: NOW,
    }]);
    expect(JSON.stringify(h.events)).not.toContain('super-secret-value');

    const listed = await listTenantApiKeys(ctx('admin'), h.deps);
    expect(listed).toMatchObject({ ok: true, value: [{ id: 'key-1', kind: 'shop_management', issuedByUserId: 'u1' }] });
    expect(JSON.stringify(listed)).not.toContain('super-secret-value');
    expect(JSON.stringify(listed)).not.toContain('keyHash');
  });

  it('creates legacy keys without issuer or lifecycle event', async () => {
    const h = harness();
    expect(await createTenantApiKey(ctx('owner'), { name: 'CI key', kind: 'legacy' }, h.deps))
      .toMatchObject({ ok: true, value: { apiKey: { kind: 'legacy', issuedByUserId: null } } });
    expect(h.events).toEqual([]);
  });

  it.each(denyingContexts)('denies creation to %s', async (_label, denied) => {
    const h = harness();
    expect(await createTenantApiKey(denied, shopInput, h.deps)).toMatchObject({ ok: false });
    expect(h.rows).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it.each<[string, CreateApiKeyInput]>([
    ['without an expiry', { ...shopInput, expiresAt: undefined }],
    ['with a null expiry', { ...shopInput, expiresAt: null }],
    ['without scopes', { ...shopInput, scopes: undefined }],
    ['with a legacy scope mixed in', { ...shopInput, scopes: ['shop:catalog:read', 'marketing'] }],
    ['with an import scope mixed in', { ...shopInput, scopes: ['shop:orders:read', 'import:content'] }],
    ['with a report scope mixed in', { ...shopInput, scopes: ['shop:orders:read', 'report:read'] }],
    ['with an expiry in the past', { ...shopInput, expiresAt: NOW }],
    ['with an expiry beyond 30 days', { ...shopInput, expiresAt: '2026-07-01T00:00:00.001Z' }],
  ])('rejects a shop management key %s', async (_label, input) => {
    const h = harness();
    expect(await createTenantApiKey(ctx('owner'), input, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.rows).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it('accepts an expiry of exactly 30 days', async () => {
    const h = harness();
    expect(await createTenantApiKey(ctx('owner'), { ...shopInput, expiresAt: '2026-07-01T00:00:00.000Z' }, h.deps))
      .toMatchObject({ ok: true });
  });

  it('rejects shop scopes on a legacy key', async () => {
    const h = harness();
    expect(await createTenantApiKey(ctx('owner'), { name: 'Sneaky', scopes: ['shop:catalog:write'], expiresAt: SEVEN_DAYS }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.rows).toHaveLength(0);
  });

  it('revokes with a lifecycle event for a verified owner session', async () => {
    const h = harness([shopRow()]);
    expect(await revokeTenantApiKey(ctx('owner'), { id: 'shop-key' }, h.deps))
      .toMatchObject({ ok: true, value: { id: 'shop-key', kind: 'shop_management', revokedAt: NOW } });
    expect(h.events).toEqual([expect.objectContaining({
      kind: 'revoked', apiKeyId: 'shop-key', actorUserId: 'u1', outcome: 'succeeded',
    })]);
    expect(await revokeTenantApiKey(ctx('owner'), { id: 'shop-key' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.events).toHaveLength(1);
  });

  it.each(denyingContexts)('denies revocation to %s', async (_label, denied) => {
    const h = harness([shopRow()]);
    expect(await revokeTenantApiKey(denied, { id: 'shop-key' }, h.deps)).toMatchObject({ ok: false });
    expect(h.rows[0]?.revokedAt).toBeNull();
    expect(h.events).toHaveLength(0);
  });

  it('keeps legacy revocation unaudited', async () => {
    const h = harness([shopRow({ id: 'legacy-key', kind: 'legacy', scopes: null, issuedByUserId: null, expiresAt: null })]);
    expect(await revokeTenantApiKey(ctx('owner'), { id: 'legacy-key' }, h.deps)).toMatchObject({ ok: true });
    expect(h.events).toEqual([]);
  });

  describe('while SHOP_MANAGEMENT_KEYS is disabled', () => {
    it('refuses shop management key creation and names the switch state', async () => {
      const h = harness([], 'disabled');
      const result = await createTenantApiKey(ctx('owner'), shopInput, h.deps);
      expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(result.ok ? '' : result.error.message).toContain('SHOP_MANAGEMENT_KEYS=disabled');
      expect(h.rows).toHaveLength(0);
      expect(h.events).toHaveLength(0);
    });

    it('keeps legacy key creation, key listing and shop key revocation working', async () => {
      const h = harness([shopRow()], 'disabled');
      expect(await createTenantApiKey(ctx('owner'), { name: 'CI key' }, h.deps))
        .toMatchObject({ ok: true, value: { apiKey: { kind: 'legacy' } } });
      expect(await listTenantApiKeys(ctx('owner'), h.deps))
        .toMatchObject({ ok: true, value: [{ id: 'shop-key', kind: 'shop_management' }, { kind: 'legacy' }] });
      expect(await revokeTenantApiKey(ctx('owner'), { id: 'shop-key' }, h.deps))
        .toMatchObject({ ok: true, value: { id: 'shop-key', revokedAt: NOW } });
      expect(h.events).toEqual([expect.objectContaining({ kind: 'revoked', apiKeyId: 'shop-key' })]);
    });
  });

  describe('purgeShopManagementKeys', () => {
    const workspaceRows = () => [
      shopRow({ id: 'shop-active' }),
      shopRow({ id: 'shop-revoked', revokedAt: NOW }),
      shopRow({ id: 'legacy-key', kind: 'legacy', scopes: null, issuedByUserId: null, expiresAt: null }),
      shopRow({ id: 'other-workspace-shop', tenantId: 't2' }),
    ];
    const machineCtx: Ctx = {
      ...ctx('owner'),
      capabilities: ['api-key:write', 'api-key:read'],
      machineActor: { kind: 'shop_management_key', apiKeyId: 'shop-active' },
    };

    it.each<ShopManagementKeysSwitch>(['enabled', 'disabled'])(
      'deletes every shop management key of the workspace with one purge event per key while the switch is %s',
      async (switchState) => {
        const h = harness(workspaceRows(), switchState);
        expect(await purgeShopManagementKeys(ctx('owner'), h.deps)).toEqual({ ok: true, value: { purged: 2 } });
        expect(h.rows.map((row) => row.id)).toEqual(['legacy-key', 'other-workspace-shop']);
        const purgeEvent = (id: string, apiKeyId: string): ShopManagementKeyEvent => ({
          id, tenantId: 't1', apiKeyId, kind: 'purged', actorUserId: 'u1',
          method: null, route: null, resourceId: null, status: null, outcome: 'succeeded', at: NOW,
        });
        expect(h.events).toEqual([purgeEvent('key-1', 'shop-active'), purgeEvent('key-2', 'shop-revoked')]);
      },
    );

    it('records nothing when the workspace has no shop management key', async () => {
      const h = harness([shopRow({ id: 'legacy-key', kind: 'legacy', scopes: null, issuedByUserId: null, expiresAt: null })]);
      expect(await purgeShopManagementKeys(ctx('owner'), h.deps)).toEqual({ ok: true, value: { purged: 0 } });
      expect(h.rows).toHaveLength(1);
      expect(h.events).toEqual([]);
    });

    const purgeDenials: [string, Ctx][] = [...denyingContexts, ['a shop management key context', machineCtx]];

    it.each(purgeDenials)(
      'refuses the purge to %s',
      async (_label, denied) => {
        const h = harness(workspaceRows());
        expect(await purgeShopManagementKeys(denied, h.deps)).toMatchObject({ ok: false });
        expect(h.rows).toHaveLength(4);
        expect(h.events).toHaveLength(0);
      },
    );
  });
});
