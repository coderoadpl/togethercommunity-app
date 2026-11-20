import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CHANGE_PROPOSAL_LIMITS,
  changeProposalExpiresAt,
  type ChangeProposal,
  type ShopManagementKey,
  type ShopManagementKeyEvent,
} from '#core/domain/index.js';
import type { ChangeProposalEventDraft } from '#core/server/index.js';

import {
  createChangeProposalEventRepository,
  createChangeProposalRepository,
  createChangeProposalTargetLocks,
} from './change-proposals.js';
import {
  changeProposalEvents,
  changeProposals,
  productPrices,
  products,
  shopManagementKeyEvents,
  shopManagementKeys,
  tenants,
} from './schema.js';
import { createShopManagementKeyRepository } from './shop-management-keys.js';
import { createTestDatabase } from './test-database-name.js';

const TENANT = 't-change-proposals';
const NEIGHBOUR = 't-change-proposals-neighbour';
const CREATED = '2026-01-01T00:00:00.000Z';
const NOW = '2026-01-02T00:00:00.000Z';
const KEY_EXPIRY = '2026-01-20T00:00:00.000Z';
const OWNER = 'user-owner';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${String(++sequence)}`;

const proposal = (overrides: Partial<ChangeProposal> = {}): ChangeProposal => {
  const createdAt = overrides.createdAt ?? CREATED;
  return {
    id: nextId('proposal'),
    tenantId: TENANT,
    groupId: null,
    groupPosition: null,
    operation: 'product.update',
    input: { id: 'product-1', title: 'After' },
    effect: { title: { before: 'Before', after: 'After' } },
    target: { kind: 'product', id: 'product-1' },
    status: 'pending',
    proposedByKeyId: 'key-propose',
    proposedByKeyName: 'Catalogue agent',
    proposedByIssuerUserId: OWNER,
    createdAt,
    expiresAt: changeProposalExpiresAt(createdAt),
    decidedByUserId: null,
    decidedAt: null,
    decisionNote: null,
    appliedResourceId: null,
    failureCode: null,
    failureMessage: null,
    ...overrides,
  };
};

const keyEvent = (): ChangeProposalEventDraft =>
  ({ id: nextId('event'), actorUserId: null, apiKeyId: 'key-propose', note: null, at: CREATED });

const shopKey = (overrides: Partial<ShopManagementKey> = {}): ShopManagementKey => ({
  id: 'key-propose',
  tenantId: TENANT,
  name: 'Catalogue agent',
  keyHash: nextId('hash'),
  scopes: ['shop:catalog:write'],
  mode: 'propose',
  issuedByUserId: OWNER,
  createdAt: CREATED,
  expiresAt: KEY_EXPIRY,
  revokedAt: null,
  ...overrides,
});

const keyLifecycleEvent = (key: ShopManagementKey, kind: ShopManagementKeyEvent['kind'] = 'created'): ShopManagementKeyEvent => ({
  id: nextId('key-event'), tenantId: key.tenantId, apiKeyId: key.id, kind, actorUserId: OWNER,
  method: null, route: null, resourceId: null, at: CREATED,
});

const storeKey = async (overrides: Partial<ShopManagementKey> = {}): Promise<ShopManagementKey> => {
  const key = shopKey(overrides);
  await createShopManagementKeyRepository(database.db).create(key.tenantId, key, keyLifecycleEvent(key));
  return key;
};

const bulkInsert = async (count: number, overrides: Partial<ChangeProposal> = {}): Promise<void> => {
  const rows = Array.from({ length: count }, () => {
    const row = proposal(overrides);
    return {
      id: row.id, tenantId: row.tenantId, groupId: null, groupPosition: null, operation: row.operation, input: row.input,
      effect: row.effect, targetKind: row.target.kind, targetId: row.target.id, status: row.status,
      proposedByKeyId: row.proposedByKeyId, proposedByKeyName: row.proposedByKeyName,
      proposedByIssuerUserId: row.proposedByIssuerUserId, createdAt: row.createdAt, expiresAt: row.expiresAt,
      decidedByUserId: row.decidedByUserId, decidedAt: row.decidedAt,
    };
  });
  await database.db.insert(changeProposals).values(rows);
};

const repo = () => createChangeProposalRepository(database.db);

const eventsOf = async (proposalId: string) =>
  createChangeProposalEventRepository(database.db).listByProposal(TENANT, proposalId);

beforeAll(async () => {
  database = await createTestDatabase('together_change_proposals', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values([
    { id: TENANT, slug: 'acme', name: 'Acme', createdAt: CREATED },
    { id: NEIGHBOUR, slug: 'studio', name: 'Studio', createdAt: CREATED },
  ]);
  await database.db.insert(products).values({
    id: 'product-1', tenantId: TENANT, slug: 'course', title: 'Course', type: 'course', published: false,
    description: '', priceCents: 0, currency: 'EUR', createdAt: CREATED,
  });
  await database.db.insert(productPrices).values({
    id: 'price-1', tenantId: TENANT, productId: 'product-1', kind: 'one_time', amountCents: 1000, currency: 'EUR', createdAt: CREATED,
  });
});

afterAll(async () => { await database?.close(); });

beforeEach(async () => {
  await database.db.delete(changeProposalEvents);
  await database.db.delete(changeProposals);
  await database.db.delete(shopManagementKeyEvents);
  await database.db.delete(shopManagementKeys);
  await storeKey();
});

describe('change proposal creation', () => {
  it('stores a pending proposal with its first event', async () => {
    const created = await repo().create(TENANT, proposal({ id: 'proposal-a' }), keyEvent(), NOW);

    expect(created).toMatchObject({ kind: 'created', proposal: { id: 'proposal-a', status: 'pending', target: { kind: 'product', id: 'product-1' } } });
    expect(await repo().findById(TENANT, 'proposal-a')).toMatchObject({ id: 'proposal-a', effect: { title: { before: 'Before', after: 'After' } } });
    expect(await eventsOf('proposal-a')).toEqual([expect.objectContaining({ sequence: 1, kind: 'proposed', apiKeyId: 'key-propose' })]);
  });

  it.each([
    ['a direct-mode key', { mode: 'direct', scopes: ['shop:catalog:write'] }],
    ['a revoked key', { revokedAt: CREATED }],
    ['an expired key', { expiresAt: NOW }],
  ] as const)('refuses a proposal from %s', async (_label, overrides) => {
    await database.db.delete(shopManagementKeys);
    await storeKey({ ...overrides });
    expect(await repo().create(TENANT, proposal(), keyEvent(), NOW)).toEqual({ kind: 'key_inactive' });
    expect(await database.db.select().from(changeProposals)).toEqual([]);
  });

  it('refuses a proposal whose key belongs to another workspace', async () => {
    await storeKey({ id: 'key-neighbour', tenantId: NEIGHBOUR });
    expect(await repo().create(TENANT, proposal({ proposedByKeyId: 'key-neighbour' }), keyEvent(), NOW)).toEqual({ kind: 'key_inactive' });
  });

  it('refuses a proposal filed under another workspace', async () => {
    await expect(repo().create(NEIGHBOUR, proposal(), keyEvent(), NOW)).rejects.toThrow(/another tenant/u);
  });

  it('refuses an effect over the stored size limit before writing', async () => {
    const effect = { description: { before: '', after: 'x'.repeat(CHANGE_PROPOSAL_LIMITS.effectMaxBytes) } };
    expect(await repo().create(TENANT, proposal({ effect }), keyEvent(), NOW)).toEqual({ kind: 'cap_exceeded', cap: 'effect_size' });
    expect(await database.db.select().from(changeProposals)).toEqual([]);
  });
});

describe('change proposal caps', () => {
  it('caps the pending proposals of one key and ignores expired ones', async () => {
    await bulkInsert(CHANGE_PROPOSAL_LIMITS.pendingPerKey - 1);
    await bulkInsert(5, { createdAt: '2025-11-01T00:00:00.000Z' });
    expect(await repo().create(TENANT, proposal(), keyEvent(), NOW)).toMatchObject({ kind: 'created' });
    expect(await repo().create(TENANT, proposal(), keyEvent(), NOW)).toEqual({ kind: 'cap_exceeded', cap: 'key_pending' });
  });

  it('caps the pending proposals of the workspace across keys', async () => {
    for (let index = 0; index < 5; index += 1) await storeKey({ id: `key-${String(index)}` });
    for (let index = 0; index < 5; index += 1) {
      await bulkInsert(CHANGE_PROPOSAL_LIMITS.pendingPerWorkspace / 5, { proposedByKeyId: `key-${String(index)}` });
    }
    expect(await repo().create(TENANT, proposal(), keyEvent(), NOW)).toEqual({ kind: 'cap_exceeded', cap: 'workspace_pending' });
  });

  it('caps the proposals one key creates in a day whatever their status', async () => {
    await bulkInsert(CHANGE_PROPOSAL_LIMITS.createdPerKeyPerWindow, {
      createdAt: '2026-01-01T12:00:00.000Z', status: 'withdrawn', decidedAt: '2026-01-01T12:00:00.000Z',
    });
    expect(await repo().create(TENANT, proposal({ createdAt: NOW }), keyEvent(), NOW)).toEqual({ kind: 'cap_exceeded', cap: 'key_daily' });
    expect(await repo().create(TENANT, proposal({ createdAt: '2026-01-03T00:00:00.000Z' }), keyEvent(), '2026-01-03T00:00:00.000Z'))
      .toMatchObject({ kind: 'created' });
  });

  it('admits exactly one of two concurrent proposals at the last free slot', async () => {
    await bulkInsert(CHANGE_PROPOSAL_LIMITS.pendingPerKey - 1);
    const results = await Promise.all([
      repo().create(TENANT, proposal(), keyEvent(), NOW),
      repo().create(TENANT, proposal(), keyEvent(), NOW),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual(['cap_exceeded', 'created']);
    expect((await database.db.select().from(changeProposals)).length).toBe(CHANGE_PROPOSAL_LIMITS.pendingPerKey);
  });
});

describe('change proposal reads', () => {
  beforeEach(async () => {
    await storeKey({ id: 'key-other' });
    await storeKey({ id: 'key-neighbour', tenantId: NEIGHBOUR });
    await repo().create(TENANT, proposal({ id: 'p-own-1', createdAt: '2026-01-01T00:00:01.000Z' }), keyEvent(), NOW);
    await repo().create(TENANT, proposal({ id: 'p-own-2', createdAt: '2026-01-01T00:00:02.000Z' }), keyEvent(), NOW);
    await repo().create(TENANT, proposal({ id: 'p-own-old', createdAt: '2025-11-01T00:00:00.000Z' }), keyEvent(), '2025-11-01T00:00:00.000Z');
    await repo().create(TENANT, proposal({ id: 'p-other', proposedByKeyId: 'key-other' }), keyEvent(), NOW);
    await repo().create(NEIGHBOUR, proposal({ id: 'p-neighbour', tenantId: NEIGHBOUR, proposedByKeyId: 'key-neighbour' }), keyEvent(), NOW);
  });

  it('reads a proposal only inside its workspace and, for a key, only its own', async () => {
    expect(await repo().findById(NEIGHBOUR, 'p-own-1')).toBeNull();
    expect(await repo().findByKey(TENANT, 'key-propose', 'p-own-1')).toMatchObject({ id: 'p-own-1' });
    expect(await repo().findByKey(TENANT, 'key-propose', 'p-other')).toBeNull();
    expect(await repo().findByKey(NEIGHBOUR, 'key-propose', 'p-own-1')).toBeNull();
  });

  it('lists newest first, pages by cursor and derives expiry from the clock', async () => {
    const first = await repo().listByKey(TENANT, 'key-propose', { limit: 1, now: NOW, status: 'pending' });
    expect(first.proposals.map(({ id }) => id)).toEqual(['p-own-2']);
    const second = await repo().listByKey(TENANT, 'key-propose', { limit: 1, now: NOW, status: 'pending', cursor: first.nextCursor ?? '' });
    expect(second).toEqual({ proposals: [expect.objectContaining({ id: 'p-own-1' })], nextCursor: null });
    expect((await repo().listByKey(TENANT, 'key-propose', { limit: 10, now: NOW, status: 'expired' })).proposals.map(({ id }) => id))
      .toEqual(['p-own-old']);
    expect((await repo().list(TENANT, { limit: 10, now: NOW })).proposals.map(({ id }) => id).sort())
      .toEqual(['p-other', 'p-own-1', 'p-own-2', 'p-own-old']);
  });

  it('answers an empty page for a cursor from another workspace or key', async () => {
    expect(await repo().listByKey(TENANT, 'key-propose', { limit: 10, now: NOW, cursor: 'p-other' }))
      .toEqual({ proposals: [], nextCursor: null });
    expect(await repo().list(TENANT, { limit: 10, now: NOW, cursor: 'p-neighbour' })).toEqual({ proposals: [], nextCursor: null });
  });
});

describe('change proposal transitions', () => {
  const rejection = (at = NOW) => ({
    status: 'rejected' as const, decidedByUserId: OWNER, decidedAt: at, decisionNote: 'Not now', appliedResourceId: null,
    failureCode: null, failureMessage: null,
    event: { id: nextId('event'), actorUserId: OWNER, apiKeyId: null, note: 'Not now', at },
  });

  it('moves a pending proposal once, with the next event in sequence', async () => {
    await repo().create(TENANT, proposal({ id: 'p-1' }), keyEvent(), NOW);
    expect(await repo().transition(TENANT, 'p-1', rejection())).toMatchObject({ status: 'rejected', decisionNote: 'Not now' });
    expect(await repo().transition(TENANT, 'p-1', rejection())).toBeNull();
    expect((await eventsOf('p-1')).map(({ sequence, kind }) => ({ sequence, kind })))
      .toEqual([{ sequence: 1, kind: 'proposed' }, { sequence: 2, kind: 'rejected' }]);
  });

  it('moves nothing across workspaces, for another key or past expiry', async () => {
    await repo().create(TENANT, proposal({ id: 'p-1' }), keyEvent(), NOW);
    expect(await repo().transition(NEIGHBOUR, 'p-1', rejection())).toBeNull();
    expect(await repo().transition(TENANT, 'p-1', rejection(), { keyId: 'key-other' })).toBeNull();
    expect(await repo().transition(TENANT, 'p-1', rejection(), { unexpiredAt: '2026-03-01T00:00:00.000Z' })).toBeNull();
    expect(await repo().findById(TENANT, 'p-1')).toMatchObject({ status: 'pending' });
    expect(await eventsOf('p-1')).toHaveLength(1);
  });

  it('records an expiry once and only past the expiry instant', async () => {
    await repo().create(TENANT, proposal({ id: 'p-1' }), keyEvent(), NOW);
    const expiry = (at: string) => ({ id: nextId('event'), actorUserId: OWNER, apiKeyId: null, note: null, at });
    expect(await repo().recordExpiry(TENANT, 'p-1', expiry(NOW))).toBe(false);
    expect(await repo().recordExpiry(TENANT, 'p-1', expiry('2026-02-01T00:00:00.000Z'))).toBe(true);
    expect(await repo().recordExpiry(TENANT, 'p-1', expiry('2026-02-02T00:00:00.000Z'))).toBe(false);
    expect((await eventsOf('p-1')).map(({ kind }) => kind)).toEqual(['proposed', 'expired']);
  });
});

describe('key revocation and purge', () => {
  const withdrawalEvent = () => {
    const at = NOW;
    return () => ({ id: nextId('withdrawal'), actorUserId: OWNER, at });
  };

  beforeEach(async () => {
    await storeKey({ id: 'key-other' });
    await repo().create(TENANT, proposal({ id: 'p-pending' }), keyEvent(), NOW);
    await repo().create(TENANT, proposal({ id: 'p-rejected' }), keyEvent(), NOW);
    await repo().transition(TENANT, 'p-rejected', {
      status: 'rejected', decidedByUserId: OWNER, decidedAt: NOW, decisionNote: null, appliedResourceId: null,
      failureCode: null, failureMessage: null, event: { id: nextId('event'), actorUserId: OWNER, apiKeyId: null, note: null, at: NOW },
    });
    await repo().create(TENANT, proposal({ id: 'p-other', proposedByKeyId: 'key-other' }), keyEvent(), NOW);
  });

  it('withdraws the revoked key\'s pending proposals in the revocation', async () => {
    const key = shopKey();
    const revoked = await createShopManagementKeyRepository(database.db)
      .revoke(TENANT, 'key-propose', NOW, keyLifecycleEvent(key, 'revoked'), withdrawalEvent());

    expect(revoked).toMatchObject({ id: 'key-propose', revokedAt: NOW, mode: 'propose' });
    expect(await repo().findById(TENANT, 'p-pending')).toMatchObject({ status: 'withdrawn', decidedByUserId: OWNER, decidedAt: NOW });
    expect(await repo().findById(TENANT, 'p-rejected')).toMatchObject({ status: 'rejected' });
    expect(await repo().findById(TENANT, 'p-other')).toMatchObject({ status: 'pending' });
    expect((await eventsOf('p-pending')).at(-1)).toMatchObject({
      sequence: 2, kind: 'withdrawn', actorUserId: OWNER, apiKeyId: 'key-propose', note: 'key_revoked',
    });
  });

  it('withdraws nothing when the revocation finds no active key', async () => {
    await database.db.update(shopManagementKeys).set({ revokedAt: CREATED }).where(eq(shopManagementKeys.id, 'key-propose'));
    expect(await createShopManagementKeyRepository(database.db)
      .revoke(TENANT, 'key-propose', NOW, keyLifecycleEvent(shopKey(), 'revoked'), withdrawalEvent())).toBeNull();
    expect(await repo().findById(TENANT, 'p-pending')).toMatchObject({ status: 'pending' });
  });

  it('rolls the revocation back when withdrawing fails', async () => {
    const failing = () => { throw new Error('withdrawal failed'); };
    await expect(createShopManagementKeyRepository(database.db)
      .revoke(TENANT, 'key-propose', NOW, keyLifecycleEvent(shopKey(), 'revoked'), failing)).rejects.toThrow('withdrawal failed');
    const [key] = await database.db.select().from(shopManagementKeys).where(eq(shopManagementKeys.id, 'key-propose'));
    expect(key?.revokedAt).toBeNull();
    expect(await repo().findById(TENANT, 'p-pending')).toMatchObject({ status: 'pending' });
  });

  it('withdraws every purged key\'s pending proposals and keeps their history', async () => {
    const purged = await createShopManagementKeyRepository(database.db)
      .purge(TENANT, (apiKeyId) => keyLifecycleEvent(shopKey({ id: apiKeyId }), 'purged'), withdrawalEvent());

    expect(purged).toBe(2);
    expect(await database.db.select().from(shopManagementKeys).where(eq(shopManagementKeys.tenantId, TENANT))).toEqual([]);
    expect(await repo().findById(TENANT, 'p-pending')).toMatchObject({ status: 'withdrawn', proposedByKeyId: 'key-propose' });
    expect(await repo().findById(TENANT, 'p-other')).toMatchObject({ status: 'withdrawn', proposedByKeyId: 'key-other' });
    expect(await repo().findById(TENANT, 'p-rejected')).toMatchObject({ status: 'rejected' });
    expect((await eventsOf('p-other')).at(-1)).toMatchObject({ kind: 'withdrawn', note: 'key_purged', apiKeyId: 'key-other' });
  });
});

describe('change proposal storage checks', () => {
  const insertRaw = (overrides: Record<string, unknown>) => database.db.execute(sql`
    insert into change_proposals (id, tenant_id, operation, input, effect, target_kind, target_id, status, proposed_by_key_id,
      proposed_by_key_name, proposed_by_issuer_user_id, created_at, expires_at, decided_at, failure_code)
    values (${nextId('raw')}, ${TENANT}, ${overrides['operation'] ?? 'product.update'}, '{}'::jsonb, '{}'::jsonb,
      ${overrides['targetKind'] ?? 'product'}, 'product-1', ${overrides['status'] ?? 'pending'}, 'key-propose', 'Agent', ${OWNER},
      ${CREATED}, ${overrides['expiresAt'] ?? changeProposalExpiresAt(CREATED)}, ${overrides['decidedAt'] ?? null},
      ${overrides['failureCode'] ?? null})`);

  it.each([
    ['an unknown operation', { operation: 'settings.update' }, /change_proposals_operation_check/u],
    ['an unknown status', { status: 'expired', decidedAt: NOW }, /change_proposals_status_check/u],
    ['a decided proposal without a decision time', { status: 'rejected' }, /change_proposals_decision_shape_check/u],
    ['a failure without a code', { status: 'failed', decidedAt: NOW }, /change_proposals_failure_shape_check/u],
    ['an expiry before creation', { expiresAt: '2025-01-01T00:00:00.000Z' }, /change_proposals_expiry_check/u],
    ['an unknown target kind', { targetKind: 'order' }, /change_proposals_target_kind_check/u],
  ])('rejects %s at the database', async (_label, overrides, constraint) => {
    await expect(insertRaw(overrides)).rejects.toMatchObject({ cause: { message: expect.stringMatching(constraint) } });
  });

  it('keeps one event per sequence number', async () => {
    await repo().create(TENANT, proposal({ id: 'p-1' }), keyEvent(), NOW);
    await expect(database.db.insert(changeProposalEvents).values({
      id: nextId('event'), tenantId: TENANT, proposalId: 'p-1', sequence: 1, kind: 'rejected', actorUserId: OWNER, at: NOW,
    })).rejects.toMatchObject({ cause: { message: expect.stringMatching(/change_proposal_events_tenant_proposal_sequence_uidx/u) } });
  });

  it('refuses a propose-mode key with a live-only scope at the database', async () => {
    await expect(database.db.insert(shopManagementKeys).values({
      ...shopKey({ id: 'key-bad', scopes: ['shop:catalog:write', 'shop:integrations:write'] }),
    })).rejects.toMatchObject({ cause: { message: expect.stringMatching(/shop_management_keys_propose_scopes_check/u) } });
  });

  it('deletes a workspace with its proposals and events', async () => {
    await storeKey({ id: 'key-neighbour', tenantId: NEIGHBOUR });
    await repo().create(NEIGHBOUR, proposal({ id: 'p-gone', tenantId: NEIGHBOUR, proposedByKeyId: 'key-neighbour' }), keyEvent(), NOW);
    await database.db.delete(tenants).where(eq(tenants.id, NEIGHBOUR));
    expect(await database.db.select().from(changeProposals).where(eq(changeProposals.tenantId, NEIGHBOUR))).toEqual([]);
    expect(await database.db.select().from(changeProposalEvents).where(and(eq(changeProposalEvents.tenantId, NEIGHBOUR)))).toEqual([]);
    await database.db.insert(tenants).values({ id: NEIGHBOUR, slug: 'studio', name: 'Studio', createdAt: CREATED });
  });
});

describe('change proposal target locks', () => {
  it('reports whether the target row exists in the workspace', async () => {
    const locks = createChangeProposalTargetLocks(database.db);
    expect(await locks.lock(TENANT, { kind: 'product', id: 'product-1' })).toBe(true);
    expect(await locks.lock(NEIGHBOUR, { kind: 'product', id: 'product-1' })).toBe(false);
    expect(await locks.lock(TENANT, { kind: 'product', id: null })).toBe(true);
    expect(await locks.lock(TENANT, { kind: 'price', id: 'price-1' })).toBe(true);
    expect(await locks.lock(NEIGHBOUR, { kind: 'price', id: 'price-1' })).toBe(false);
    expect(await locks.lock(TENANT, { kind: 'price', id: null })).toBe(false);
    expect(await locks.lock(TENANT, { kind: 'settings', id: null })).toBe(true);
  });

  it('holds the product row until the surrounding transaction ends', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => { locked = resolve; });
    const holder = database.db.transaction(async (tx) => {
      expect(await createChangeProposalTargetLocks(tx).lock(TENANT, { kind: 'product', id: 'product-1' })).toBe(true);
      locked();
      await held;
    });
    await lockTaken;
    const probe = await database.db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '200ms'`);
      return tx.select({ id: products.id }).from(products).where(eq(products.id, 'product-1')).for('update').then(
        () => 'acquired',
        () => 'blocked',
      );
    }).catch(() => 'blocked');
    release();
    await holder;
    expect(probe).toBe('blocked');
  });
});
