import { describe, expect, it } from 'vitest';

import type {
  CreateShopManagementKeyInput,
  Identity,
  ImpersonationPrincipal,
  ShopManagementKey,
  ShopManagementKeyEvent,
  ShopManagementKeysSwitch,
  StaffRole,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { QuarantinedImageRelease, ShopManagementKeyRepository } from '../ports.js';
import { noProposedFiles } from '../testing/key-download-fakes.js';
import { createObjectStorageFake, fakeStorageSecrets } from '../testing/object-storage-fake.js';
import type { ChangeProposalFileReleaseDeps } from './change-proposal-files.js';
import type { ChangeProposalImageReleaseDeps } from './change-proposal-images.js';
import {
  createShopManagementKey,
  listShopManagementKeyEvents,
  listShopManagementKeys,
  purgeShopManagementKeys,
  revokeShopManagementKey,
  type ShopManagementKeyDeps,
} from './shop-management-keys.js';

const NOW = '2026-06-01T00:00:00.000Z';
const SEVEN_DAYS = '2026-06-08T00:00:00.000Z';

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

const shopRow = (overrides: Partial<ShopManagementKey> = {}): ShopManagementKey => ({
  id: 'shop-key', tenantId: 't1', name: 'Shop backend', keyHash: 'hash:shop',
  scopes: ['shop:orders:read'], mode: 'direct', issuedByUserId: 'u1', createdAt: NOW, expiresAt: SEVEN_DAYS, revokedAt: null,
  ...overrides,
});

const harness = (rows: ShopManagementKey[] = [], shopManagementKeysSwitch: ShopManagementKeysSwitch = 'enabled') => {
  const store = [...rows];
  const events: ShopManagementKeyEvent[] = [];
  const withdrawals: Array<{ proposalId: string; id: string; actorUserId: string; at: string }> = [];
  let seq = 0;
  const shopManagementKeys: ShopManagementKeyRepository = {
    listByTenant: async (tenantId) => store.filter((row) => row.tenantId === tenantId),
    create: async (_tenantId, key, event) => {
      store.push(key);
      events.push(event);
    },
    findByHash: async () => null,
    revoke: async (tenantId, id, revokedAt, event, withdrawal) => {
      const row = store.find((r) => r.tenantId === tenantId && r.id === id && r.revokedAt === null);
      if (!row) return null;
      row.revokedAt = revokedAt;
      events.push(event);
      if (row.mode === 'propose') withdrawals.push({ proposalId: `proposal-of-${id}`, id: withdrawal.nextEventId(), actorUserId: withdrawal.actorUserId, at: withdrawal.at });
      return row;
    },
    purge: async (tenantId, event, withdrawal) => {
      const purged = store.filter((row) => row.tenantId === tenantId);
      for (const row of purged) {
        store.splice(store.indexOf(row), 1);
        events.push(event(row.id));
        if (row.mode === 'propose') withdrawals.push({ proposalId: `proposal-of-${row.id}`, id: withdrawal.nextEventId(), actorUserId: withdrawal.actorUserId, at: withdrawal.at });
      }
      return purged.length;
    },
  };
  const releases: Array<{ tenantId: string; selection: QuarantinedImageRelease }> = [];
  const deps: ShopManagementKeyDeps & ChangeProposalImageReleaseDeps & ChangeProposalFileReleaseDeps = {
    ...noProposedFiles(),
    quarantinedImages: {
      release: async (tenantId, selection) => {
        releases.push({ tenantId, selection });
        return { kind: 'written', value: [] };
      },
      finishRelease: async () => 'removed',
    },
    storage: createObjectStorageFake().storage,
    secretResolver: fakeStorageSecrets,
    logger: { error: () => undefined },
    shopManagementKeys,
    apiKeyCrypto: { generateSecret: () => 'super-secret-value', hash: (value) => `hash:${value}` },
    ids: { nextId: () => `key-${String((seq += 1))}` },
    clock: { nowIso: () => NOW },
    shopManagementKeysSwitch,
  };
  return { rows: store, events, withdrawals, releases, deps };
};

const shopInput: CreateShopManagementKeyInput = {
  name: 'Shop backend',
  scopes: ['shop:catalog:read', 'shop:catalog:write'],
  expiresAt: SEVEN_DAYS,
};

const impersonation: ImpersonationPrincipal = {
  id: 'imp-1', actorUserId: 'u1', actorEmail: 'owner@together.dev', actorName: 'Owner', actorStaffRole: 'owner',
  subjectMemberId: 'm1', subjectName: 'Member', expiresAt: SEVEN_DAYS,
};

const machineCtx: Ctx = {
  ...ctx('owner'),
  capabilities: ['api-key:write', 'api-key:read'],
  machineActor: { kind: 'shop_management_key', apiKeyId: 'shop-active', mode: 'direct' },
};

const denyingContexts: [string, Ctx][] = [
  ['an admin', ctx('admin')],
  ['a member', ctx(null)],
  ['an owner with an unverified email', { identity: { ...ctx('owner').identity, emailVerified: false } }],
  ['an impersonating owner', { ...ctx('owner'), impersonation }],
  ['a capability override context', { ...ctx('owner'), capabilities: ['api-key:write', 'api-key:read'] }],
  ['a shop management key context', machineCtx],
];

describe('createShopManagementKey', () => {
  it('records the issuing owner and returns the secret only in the create result', async () => {
    const h = harness();
    const result = await createShopManagementKey(ctx('owner'), shopInput, h.deps);

    expect(result).toEqual({
      ok: true,
      value: {
        secret: 'super-secret-value',
        apiKey: {
          id: 'key-1', tenantId: 't1', name: 'Shop backend', scopes: ['shop:catalog:read', 'shop:catalog:write'], mode: 'direct',
          issuedByUserId: 'u1', createdAt: NOW, expiresAt: SEVEN_DAYS, revokedAt: null,
        },
      },
    });
    expect(h.rows).toEqual([expect.objectContaining({ issuedByUserId: 'u1', keyHash: 'hash:super-secret-value' })]);
    expect(h.events).toEqual([{
      id: 'key-2', tenantId: 't1', apiKeyId: 'key-1', kind: 'created', actorUserId: 'u1',
      method: null, route: null, resourceId: null, at: NOW,
    }]);
    expect(JSON.stringify(h.events)).not.toContain('super-secret-value');

    const listed = await listShopManagementKeys(ctx('owner'), h.deps);
    expect(listed).toMatchObject({ ok: true, value: [{ id: 'key-1', issuedByUserId: 'u1' }] });
    expect(JSON.stringify(listed)).not.toContain('super-secret-value');
    expect(JSON.stringify(listed)).not.toContain('keyHash');
  });

  it.each(denyingContexts)('denies creation to %s', async (_label, denied) => {
    const h = harness();
    expect(await createShopManagementKey(denied, shopInput, h.deps)).toMatchObject({ ok: false });
    expect(h.rows).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it.each<[string, CreateShopManagementKeyInput]>([
    ['with an empty scope list', { ...shopInput, scopes: [] }],
    ['with a blank name', { ...shopInput, name: '  ' }],
    ['with an expiry in the past', { ...shopInput, expiresAt: NOW }],
    ['with an expiry beyond 30 days', { ...shopInput, expiresAt: '2026-07-01T00:00:00.001Z' }],
  ])('rejects a key %s', async (_label, input) => {
    const h = harness();
    expect(await createShopManagementKey(ctx('owner'), input, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.rows).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it('accepts an expiry of exactly 30 days', async () => {
    const h = harness();
    expect(await createShopManagementKey(ctx('owner'), { ...shopInput, expiresAt: '2026-07-01T00:00:00.000Z' }, h.deps))
      .toMatchObject({ ok: true });
  });

  it('stores the propose mode the owner chose and refuses a live-only scope for it', async () => {
    const h = harness();
    expect(await createShopManagementKey(ctx('owner'), { ...shopInput, mode: 'propose' }, h.deps))
      .toMatchObject({ ok: true, value: { apiKey: { mode: 'propose' } } });
    expect(h.rows).toEqual([expect.objectContaining({ mode: 'propose' })]);
    expect(h.rows[0]?.keyHash).not.toBe('hash:super-secret-value');
    expect(h.rows[0]?.keyHash).toMatch(/^hash:.+super-secret-value$/u);
    expect(await createShopManagementKey(ctx('owner'), {
      ...shopInput, mode: 'propose', scopes: ['shop:catalog:read', 'shop:catalog:write', 'shop:integrations:write'],
    }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await createShopManagementKey(ctx('owner'), {
      ...shopInput, mode: 'propose', scopes: ['shop:catalog:write'],
    }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.rows).toHaveLength(1);
  });

  it('refuses creation while SHOP_MANAGEMENT_KEYS is disabled and names the switch state', async () => {
    const h = harness([], 'disabled');
    const result = await createShopManagementKey(ctx('owner'), shopInput, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(result.ok ? '' : result.error.message).toContain('SHOP_MANAGEMENT_KEYS=disabled');
    expect(h.rows).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });
});

describe('listShopManagementKeys', () => {
  it('lists only the keys of the session workspace', async () => {
    const h = harness([shopRow(), shopRow({ id: 'foreign', tenantId: 't2' })]);
    expect(await listShopManagementKeys(ctx('owner'), h.deps)).toMatchObject({ ok: true, value: [{ id: 'shop-key' }] });
  });

  it.each(denyingContexts)('refuses the list to %s', async (_label, denied) => {
    expect(await listShopManagementKeys(denied, harness([shopRow()]).deps)).toMatchObject({ ok: false });
  });
});

describe('revokeShopManagementKey', () => {
  it('revokes with a lifecycle event for a verified owner session', async () => {
    const h = harness([shopRow()]);
    expect(await revokeShopManagementKey(ctx('owner'), { id: 'shop-key' }, h.deps))
      .toMatchObject({ ok: true, value: { id: 'shop-key', revokedAt: NOW } });
    expect(h.events).toEqual([expect.objectContaining({ kind: 'revoked', apiKeyId: 'shop-key', actorUserId: 'u1' })]);
    expect(await revokeShopManagementKey(ctx('owner'), { id: 'shop-key' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.events).toHaveLength(1);
  });

  it.each(denyingContexts)('denies revocation to %s', async (_label, denied) => {
    const h = harness([shopRow()]);
    expect(await revokeShopManagementKey(denied, { id: 'shop-key' }, h.deps)).toMatchObject({ ok: false });
    expect(h.rows[0]?.revokedAt).toBeNull();
    expect(h.events).toHaveLength(0);
    expect(h.withdrawals).toHaveLength(0);
  });

  it('hands the repository the revoking owner for withdrawing the key\'s pending proposals', async () => {
    const h = harness([shopRow({ mode: 'propose', scopes: ['shop:catalog:read', 'shop:catalog:write'] })]);
    expect(await revokeShopManagementKey(ctx('owner'), { id: 'shop-key' }, h.deps)).toMatchObject({ ok: true });
    expect(h.withdrawals).toEqual([{ proposalId: 'proposal-of-shop-key', id: 'key-2', actorUserId: 'u1', at: NOW }]);
  });

  it('releases every quarantined image of a revoked propose-mode key after the revocation, and none for a direct-mode key', async () => {
    const h = harness([shopRow({ mode: 'propose', scopes: ['shop:catalog:read', 'shop:catalog:write'] }), shopRow({ id: 'direct-key' })]);
    expect(await revokeShopManagementKey(ctx('owner'), { id: 'shop-key' }, h.deps)).toMatchObject({ ok: true });
    expect(await revokeShopManagementKey(ctx('owner'), { id: 'direct-key' }, h.deps)).toMatchObject({ ok: true });
    expect(h.releases).toEqual([{ tenantId: 't1', selection: { kind: 'key', apiKeyId: 'shop-key' } }]);
  });

  it('keeps listing and revocation working while the switch is disabled', async () => {
    const h = harness([shopRow()], 'disabled');
    expect(await listShopManagementKeys(ctx('owner'), h.deps)).toMatchObject({ ok: true, value: [{ id: 'shop-key' }] });
    expect(await revokeShopManagementKey(ctx('owner'), { id: 'shop-key' }, h.deps))
      .toMatchObject({ ok: true, value: { id: 'shop-key', revokedAt: NOW } });
  });
});

describe('purgeShopManagementKeys', () => {
  const workspaceRows = () => [
    shopRow({ id: 'shop-active' }),
    shopRow({ id: 'shop-revoked', revokedAt: NOW }),
    shopRow({ id: 'other-workspace-shop', tenantId: 't2' }),
  ];

  it.each<ShopManagementKeysSwitch>(['enabled', 'disabled'])(
    'deletes every key of the workspace with one purge event per key while the switch is %s',
    async (switchState) => {
      const h = harness(workspaceRows(), switchState);
      expect(await purgeShopManagementKeys(ctx('owner'), h.deps)).toEqual({ ok: true, value: { purged: 2 } });
      expect(h.rows.map((row) => row.id)).toEqual(['other-workspace-shop']);
      const purgeEvent = (id: string, apiKeyId: string): ShopManagementKeyEvent => ({
        id, tenantId: 't1', apiKeyId, kind: 'purged', actorUserId: 'u1', method: null, route: null, resourceId: null, at: NOW,
      });
      expect(h.events).toEqual([purgeEvent('key-1', 'shop-active'), purgeEvent('key-2', 'shop-revoked')]);
    },
  );

  it('hands the repository the purging owner for withdrawing each propose-mode key\'s pending proposals', async () => {
    const h = harness([
      shopRow({ id: 'propose-a', mode: 'propose', scopes: ['shop:catalog:read', 'shop:catalog:write'] }),
      shopRow({ id: 'propose-b', mode: 'propose', scopes: ['shop:settings:read', 'shop:settings:write'] }),
    ]);
    expect(await purgeShopManagementKeys(ctx('owner'), h.deps)).toEqual({ ok: true, value: { purged: 2 } });
    expect(h.withdrawals.map(({ proposalId, actorUserId, at }) => ({ proposalId, actorUserId, at }))).toEqual([
      { proposalId: 'proposal-of-propose-a', actorUserId: 'u1', at: NOW },
      { proposalId: 'proposal-of-propose-b', actorUserId: 'u1', at: NOW },
    ]);
    const ids = [...h.events.map(({ id }) => id), ...h.withdrawals.map(({ id }) => id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('records nothing when the workspace has no key', async () => {
    const h = harness();
    expect(await purgeShopManagementKeys(ctx('owner'), h.deps)).toEqual({ ok: true, value: { purged: 0 } });
    expect(h.events).toEqual([]);
    expect(h.releases).toEqual([]);
  });

  it('sweeps the quarantined images of the purged keys after the purge', async () => {
    const h = harness(workspaceRows());
    expect(await purgeShopManagementKeys(ctx('owner'), h.deps)).toMatchObject({ ok: true });
    expect(h.releases).toEqual([{ tenantId: 't1', selection: { kind: 'sweep', createdBefore: '2026-05-25T00:00:00.000Z', limit: 200 } }]);
  });

  it.each(denyingContexts)('refuses the purge to %s', async (_label, denied) => {
    const h = harness(workspaceRows());
    expect(await purgeShopManagementKeys(denied, h.deps)).toMatchObject({ ok: false });
    expect(h.rows).toHaveLength(3);
    expect(h.events).toHaveLength(0);
  });
});

describe('listShopManagementKeyEvents', () => {
  const lister = () => {
    const calls: Array<{ tenantId: string; query: unknown }> = [];
    const event: ShopManagementKeyEvent = {
      id: 'event-1', tenantId: 't1', apiKeyId: 'shop-key', kind: 'created', actorUserId: 'u1',
      method: null, route: null, resourceId: null, at: NOW,
    };
    return {
      calls,
      deps: {
        shopManagementKeyEvents: {
          list: async (tenantId: string, query: unknown) => {
            calls.push({ tenantId, query });
            return { events: [event], nextCursor: null };
          },
        },
      },
    };
  };

  it('lists the history of the owner workspace with the key filter and paging', async () => {
    const l = lister();
    expect(await listShopManagementKeyEvents(ctx('owner'), { apiKeyId: 'shop-key', cursor: 'event-0', limit: 10 }, l.deps))
      .toMatchObject({ ok: true, value: { events: [{ id: 'event-1' }], nextCursor: null } });
    expect(l.calls).toEqual([{ tenantId: 't1', query: { apiKeyId: 'shop-key', cursor: 'event-0', limit: 10 } }]);
  });

  it('reads only the workspace of the session', async () => {
    const l = lister();
    await listShopManagementKeyEvents(ctx('owner', 't2'), { limit: 50 }, l.deps);
    expect(l.calls).toEqual([{ tenantId: 't2', query: { limit: 50 } }]);
  });

  it.each(denyingContexts)('refuses the history to %s', async (_label, denied) => {
    const l = lister();
    expect(await listShopManagementKeyEvents(denied, { limit: 50 }, l.deps)).toMatchObject({ ok: false });
    expect(l.calls).toEqual([]);
  });
});
