import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  capabilitiesForApiKey,
  CHANGE_PROPOSAL_LIMITS,
  changeProposalExpiresAt,
  changeProposalKeyReceiptPageSchema,
  changeProposalKeyReceiptSchema,
  changeProposalOperationSchema,
  changeProposalOwnerDetailSchema,
  changeProposalOwnerPageSchema,
  ok,
  type AppError,
  type ChangeProposal,
  type ChangeProposalOperation,
  type Identity,
  type Product,
  type ProductDownloadAsset,
  type ProductPrice,
  type Result,
  type ShopManagementKey,
  type ShopManagementScope,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { ChangeProposalTransactionScope, StorageProvider } from '../ports.js';
import {
  createChangeProposalStoreFake,
  createChangeProposalTransactionFake,
  emptyCatalogState,
  type FakeCatalogState,
  type FakeChangeProposalStore,
  type FakeChangeProposalTransaction,
} from '../testing/change-proposal-fakes.js';
import { shopManagementKeyCapabilities } from './shop-machine-auth.js';
import {
  getChangeProposal,
  getOwnChangeProposal,
  listChangeProposals,
  listOwnChangeProposals,
  rejectChangeProposal,
  submitChangeProposal,
  withdrawOwnChangeProposal,
  type ChangeProposalDecisionDeps,
  type ChangeProposalKeyDeps,
  type ChangeProposalOwnerReadDeps,
  type ChangeProposalSubmitDeps,
} from './change-proposals.js';
import { deleteProductDraft } from './product-drafts.js';
import { createProduct, publishProduct } from './products.js';
import { adjustProductStock, enableProductStock } from './stock.js';

const TENANT = 'tenant-acme';
const NEIGHBOUR = 'tenant-studio';
const OWNER = 'user-owner';
const NOW = '2026-03-01T10:00:00.000Z';
const KEY_ID = 'key-propose';
const OTHER_KEY_ID = 'key-propose-other';

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  userId: OWNER, email: 'owner@example.test', name: 'Owner', emailVerified: true, tenantAccess: 'staff',
  tenantId: TENANT, tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  ...overrides,
});

const shopKey = (overrides: Partial<ShopManagementKey> = {}): ShopManagementKey => ({
  id: KEY_ID, tenantId: TENANT, name: 'Catalogue agent', keyHash: 'hash', scopes: ['shop:catalog:read', 'shop:catalog:write'], mode: 'propose',
  issuedByUserId: OWNER, createdAt: '2026-02-25T00:00:00.000Z', expiresAt: '2026-03-20T00:00:00.000Z', revokedAt: null,
  ...overrides,
});

const CATALOG_PROPOSER: ShopManagementScope[] = ['shop:catalog:read', 'shop:catalog:write'];

const keyCtx = (
  scopes: ShopManagementScope[] = CATALOG_PROPOSER,
  mode: ShopManagementKey['mode'] = 'propose',
  apiKeyId = KEY_ID,
  tenantId = TENANT,
): Ctx => ({
  identity: identity({ tenantId }),
  capabilities: shopManagementKeyCapabilities({ scopes, mode }),
  machineActor: { kind: 'shop_management_key', apiKeyId, mode },
});

const ownerSession: Ctx = { identity: identity() };

const privilegeConfusion: ReadonlyArray<readonly [string, Ctx]> = [
  ['an admin session', { identity: identity({ staffRole: 'admin', userId: 'user-admin' }) }],
  ['an owner viewing as a member', {
    identity: identity({ staffRole: null, memberId: 'member-1', tenantAccess: 'member', userId: 'user-member' }),
    impersonation: {
      id: 'imp-1', actorUserId: OWNER, actorEmail: 'owner@example.test', actorName: 'Owner', actorStaffRole: 'owner',
      subjectMemberId: 'member-1', subjectName: 'Member', expiresAt: '2026-03-01T11:00:00.000Z',
    },
  }],
  ['an owner session carrying an impersonation', {
    identity: identity(),
    impersonation: {
      id: 'imp-2', actorUserId: OWNER, actorEmail: 'owner@example.test', actorName: 'Owner', actorStaffRole: 'owner',
      subjectMemberId: 'member-1', subjectName: 'Member', expiresAt: '2026-03-01T11:00:00.000Z',
    },
  }],
  ['a direct-mode key with every scope', keyCtx(
    ['shop:catalog:read', 'shop:catalog:write', 'shop:orders:read', 'shop:fulfilment:write', 'shop:settings:read', 'shop:settings:write', 'shop:integrations:read', 'shop:integrations:write'],
    'direct',
  )],
  ['a propose-mode key', keyCtx(['shop:catalog:read', 'shop:catalog:write', 'shop:settings:read', 'shop:settings:write'])],
  ['a legacy tenant API key', {
    identity: identity({ userId: 'api-key', email: 'api-key@together.invalid', staffRole: null, tenantAccess: 'none' }),
    capabilities: capabilitiesForApiKey({ scopes: null }),
  }],
  ['an owner with an unverified e-mail', { identity: identity({ emailVerified: false }) }],
  ['an owner session with a capability subset', { identity: identity(), capabilities: ['proposal:read', 'proposal:decide'] }],
];

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'product-mug', tenantId: TENANT, type: 'physical', slug: 'mug', title: 'Mug', description: '', coverUrl: null,
  priceCents: 0, currency: 'EUR', published: false, visibility: 'listed', salesChannel: 'any', deliveryMethod: 'pickup',
  accessItems: [], legacyId: null, createdAt: '2026-01-01T00:00:00.000Z', vatRate: null, vatExemptionBasis: null,
  ...overrides,
});

const price = (overrides: Partial<ProductPrice> = {}): ProductPrice => ({
  id: 'price-mug', tenantId: TENANT, productId: 'product-mug', kind: 'one_time', interval: null, amountCents: 1500,
  currency: 'EUR', active: true, createdAt: '2026-01-01T00:00:00.000Z', ...overrides,
});

const downloadAsset = (overrides: Partial<ProductDownloadAsset> = {}): ProductDownloadAsset => ({
  id: 'asset-1', tenantId: TENANT, lineageId: 'lineage-1', versionNumber: 1, versionNote: null, supersededAt: null,
  replacesAssetId: null, productId: 'product-draft', fileName: 'guide.pdf', contentType: 'application/pdf', sizeBytes: 10,
  storageKey: 'downloads/guide.pdf', status: 'ready', createdAt: '2026-01-01T00:00:00.000Z', ...overrides,
});

const storedProposal = (overrides: Partial<ChangeProposal> = {}): ChangeProposal => {
  const createdAt = overrides.createdAt ?? '2026-02-28T10:00:00.000Z';
  return {
    id: 'proposal-seeded', tenantId: TENANT, groupId: null, groupPosition: null, operation: 'product.update',
    input: { id: 'product-mug', title: 'Big mug' }, effect: { title: { before: 'Mug', after: 'Big mug' } },
    target: { kind: 'product', id: 'product-mug' }, status: 'pending', proposedByKeyId: KEY_ID,
    proposedByKeyName: 'Catalogue agent', proposedByIssuerUserId: OWNER, createdAt, expiresAt: changeProposalExpiresAt(createdAt),
    decidedByUserId: null, decidedAt: null, decisionNote: null, appliedResourceId: null, failureCode: null, failureMessage: null,
    ...overrides,
  };
};

const storageSpy = () => {
  const calls: string[] = [];
  const record = (name: string) => () => { calls.push(name); throw new Error(`storage.${name} must not run in a dry run`); };
  const storage: StorageProvider = {
    objectUrl: (_configuration, key) => new URL(`https://storage.example.test/${key}`),
    delete: record('delete'), list: record('list'), getObject: record('getObject'), putObject: record('putObject'),
    probe: record('probe'), probeCors: record('probeCors'), presignPut: record('presignPut'), presignGet: record('presignGet'),
    head: record('head'), healthcheck: record('healthcheck'), test: record('test'),
  };
  return { storage, calls };
};

const storageSecrets = {
  resolve: async () => ok(JSON.stringify({ provider: 'aws_s3', endpoint: 'https://storage.example.test', bucket: 'downloads', region: 'auto', accessKeyId: 'a', secretAccessKey: 's' })),
};

interface Harness {
  state: FakeCatalogState;
  store: FakeChangeProposalStore;
  transaction: FakeChangeProposalTransaction;
  storageCalls: string[];
  submitDeps: ChangeProposalSubmitDeps;
  keyDeps: ChangeProposalKeyDeps;
  ownerDeps: ChangeProposalOwnerReadDeps;
  decisionDeps: ChangeProposalDecisionDeps;
  clock: { now: string };
}

const harness = (keys: ShopManagementKey[] = [shopKey()]): Harness => {
  const state = emptyCatalogState();
  state.products.push(
    product(),
    product({ id: 'product-draft', slug: 'draft', title: 'Draft guide', type: 'digital_download' }),
    product({ id: 'product-live', slug: 'live', title: 'Live mug', published: true }),
    product({ id: 'product-neighbour', tenantId: NEIGHBOUR, slug: 'neighbour', title: 'Neighbour mug' }),
  );
  state.everPublished.push('product-live');
  state.prices.push(
    price(),
    price({ id: 'price-live', productId: 'product-live' }),
    price({ id: 'price-neighbour', tenantId: NEIGHBOUR, productId: 'product-neighbour' }),
  );
  state.stock.push({ tenantId: TENANT, productId: 'product-live', onHand: 10, reserved: 0, lowStockThreshold: 2, lowStockNotifiedAt: null, updatedAt: NOW });
  state.downloadAssets.push(downloadAsset());
  const store = createChangeProposalStoreFake(keys);
  const transaction = createChangeProposalTransactionFake(state, store, storageSecrets);
  const { storage, calls } = storageSpy();
  let sequence = 0;
  const clock = { now: NOW };
  const ids = { nextId: () => `generated-${String(++sequence)}` };
  const clockPort = { nowIso: () => clock.now };
  const shopManagementKeys = { listByTenant: async (tenantId: string) => keys.filter((key) => key.tenantId === tenantId) };
  return {
    state,
    store,
    transaction,
    storageCalls: calls,
    clock,
    submitDeps: {
      changeProposalTransaction: transaction,
      changeProposals: store.repository,
      shopManagementKeys,
      storage,
      logger: { error: vi.fn<(message: string) => void>() },
      ids,
      clock: clockPort,
    },
    keyDeps: { changeProposals: store.repository, ids, clock: clockPort },
    ownerDeps: { changeProposals: store.repository, changeProposalEvents: store.events, shopManagementKeys, clock: clockPort },
    decisionDeps: { changeProposals: store.repository, shopManagementKeys, ids, clock: clockPort },
  };
};

const liveState = (state: FakeCatalogState) => structuredClone(state);

const OPERATION_INPUTS: Record<ChangeProposalOperation, unknown> = {
  'product.create': { title: 'Teapot', slug: 'teapot', type: 'physical', priceCents: 0 },
  'product.update': { id: 'product-mug', title: 'Big mug' },
  'product.publish': { id: 'product-mug' },
  'product.unpublish': { id: 'product-live' },
  'product.delete-draft': { productId: 'product-draft' },
  'price.create': { productId: 'product-mug', kind: 'one_time', amountCents: 2500, currency: 'EUR' },
  'price.deactivate': { id: 'price-live' },
  'stock.enable': { productId: 'product-mug', onHand: 4 },
  'stock.adjust': { productId: 'product-live', delta: 5, reason: 'Delivery' },
  'stock.set-threshold': { productId: 'product-live', lowStockThreshold: 3 },
};

describe('submitChangeProposal dry run', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it.each(changeProposalOperationSchema.options)('%s stores a pending proposal and changes no live state', async (operation) => {
    const before = liveState(h.state);

    const result = await submitChangeProposal(keyCtx(), { operation, input: OPERATION_INPUTS[operation] }, h.submitDeps);

    if (!result.ok) throw new Error(`${operation}: ${result.error.message}`);
    expect(changeProposalKeyReceiptSchema.parse(result.value)).toEqual(result.value);
    expect(result.value).toMatchObject({ operation, status: 'pending', groupId: null, decisionNote: null, failureCode: null });
    expect(h.state).toEqual(before);
    expect(h.transaction.calls).toEqual(['dryRun']);
    expect(h.storageCalls).toEqual([]);
    expect(h.store.proposals).toHaveLength(1);
    expect(h.store.eventRows).toEqual([expect.objectContaining({ kind: 'proposed', sequence: 1, apiKeyId: KEY_ID, actorUserId: null })]);
    const [stored] = h.store.proposals;
    expect(stored?.effect).not.toEqual({});
    expect(JSON.stringify(stored?.effect)).not.toMatch(/generated-/u);
  });

  it('locks the target row before reading it', async () => {
    await submitChangeProposal(keyCtx(), { operation: 'product.update', input: OPERATION_INPUTS['product.update'] }, h.submitDeps);
    expect(h.transaction.locks).toEqual([{ kind: 'product', id: 'product-mug' }]);
  });

  it('stores the parsed input with defaults filled and the field-level effect, derived fields included', async () => {
    const result = await submitChangeProposal(keyCtx(), { operation: 'product.create', input: OPERATION_INPUTS['product.create'] }, h.submitDeps);
    expect(result.ok).toBe(true);
    const [stored] = h.store.proposals;
    expect(stored?.input).toMatchObject({ title: 'Teapot', slug: 'teapot', type: 'physical', visibility: 'listed', currency: 'PLN', description: '', accessItems: [] });
    expect(stored?.target).toEqual({ kind: 'product', id: null });
    expect(stored?.effect).toMatchObject({
      exists: { before: false, after: true },
      title: { before: null, after: 'Teapot' },
      published: { before: null, after: false },
      currency: { before: null, after: 'PLN' },
    });
    expect(stored?.effect).not.toHaveProperty('id');
    expect(stored?.effect).not.toHaveProperty('createdAt');
  });

  it('records only the fields a product update really changes', async () => {
    await submitChangeProposal(keyCtx(), { operation: 'product.update', input: OPERATION_INPUTS['product.update'] }, h.submitDeps);
    expect(h.store.proposals[0]?.effect).toEqual({ title: { before: 'Mug', after: 'Big mug' } });
  });

  it('records a new price as a change of the active prices without generated ids', async () => {
    await submitChangeProposal(keyCtx(), { operation: 'price.create', input: OPERATION_INPUTS['price.create'] }, h.submitDeps);
    expect(h.store.proposals[0]?.effect).toEqual({
      activePrices: {
        before: [{ kind: 'one_time', interval: null, amountCents: 1500, currency: 'EUR' }],
        after: [
          { kind: 'one_time', interval: null, amountCents: 1500, currency: 'EUR' },
          { kind: 'one_time', interval: null, amountCents: 2500, currency: 'EUR' },
        ],
      },
    });
  });

  it('records a stock adjustment as a delta, never as an absolute balance', async () => {
    await submitChangeProposal(keyCtx(), { operation: 'stock.adjust', input: OPERATION_INPUTS['stock.adjust'] }, h.submitDeps);
    expect(h.store.proposals[0]?.effect).toEqual({ onHand: { delta: 5 } });
  });

  it('records a draft deletion and drops its storage deletes', async () => {
    await submitChangeProposal(keyCtx(), { operation: 'product.delete-draft', input: OPERATION_INPUTS['product.delete-draft'] }, h.submitDeps);
    expect(h.store.proposals[0]?.effect).toMatchObject({ exists: { before: true, after: false }, title: { before: 'Draft guide', after: null } });
    expect(h.transaction.deferredDropped).toBe(1);
    expect(h.storageCalls).toEqual([]);
    expect(h.state.downloadAssets).toHaveLength(1);
  });

  it('returns the live domain error unchanged and stores nothing', async () => {
    const direct = harness();
    const asOwner: Ctx = { identity: identity() };
    const clock = { nowIso: () => NOW };
    const live = <T>(run: (scope: ChangeProposalTransactionScope) => Promise<Result<T, AppError>>) => direct.transaction.dryRun(TENANT, run);
    const cases: ReadonlyArray<readonly [ChangeProposalOperation, Record<string, unknown>, () => Promise<Result<unknown, AppError>>]> = [
      ['product.publish', { id: 'product-draft' }, () => live(({ repositories }) => publishProduct(asOwner, { id: 'product-draft' }, repositories))],
      ['stock.adjust', { productId: 'product-mug', delta: 1, reason: 'Count' }, () => live(({ repositories }) =>
        adjustProductStock(asOwner, { productId: 'product-mug', delta: 1, reason: 'Count' }, { ...repositories, clock }))],
      ['stock.enable', { productId: 'product-live', onHand: 1 }, () => live(({ repositories }) =>
        enableProductStock(asOwner, { productId: 'product-live', onHand: 1 }, { ...repositories, clock }))],
      ['product.create', { title: 'Mug', slug: 'mug', priceCents: 0 }, () => live(({ repositories }) =>
        createProduct(asOwner, { title: 'Mug', slug: 'mug', priceCents: 0 }, { ...repositories, ids: { nextId: () => 'direct-id' }, clock }))],
      ['product.delete-draft', { productId: 'product-live' }, () => live(({ repositories }) =>
        deleteProductDraft(asOwner, { productId: 'product-live' }, { ...direct.submitDeps, secretResolver: storageSecrets, productDrafts: repositories.productDrafts }))],
    ];
    for (const [operation, input, viaLiveRoute] of cases) {
      const result = await submitChangeProposal(keyCtx(), { operation, input }, h.submitDeps);
      expect(result.ok, operation).toBe(false);
      expect(result, operation).toEqual(await viaLiveRoute());
    }
    expect(h.store.proposals).toEqual([]);
    expect(h.store.eventRows).toEqual([]);
  });

  it('answers not found for another workspace\'s ids and stores nothing', async () => {
    const before = liveState(h.state);
    for (const [operation, input] of [
      ['product.update', { id: 'product-neighbour', title: 'Taken over' }],
      ['product.publish', { id: 'product-neighbour' }],
      ['price.create', { productId: 'product-neighbour', kind: 'one_time', amountCents: 1, currency: 'EUR' }],
      ['price.deactivate', { id: 'price-neighbour' }],
      ['stock.enable', { productId: 'product-neighbour', onHand: 1 }],
      ['product.delete-draft', { productId: 'product-neighbour' }],
    ] as const) {
      const result = await submitChangeProposal(keyCtx(), { operation, input }, h.submitDeps);
      expect(result, operation).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
    expect(h.state).toEqual(before);
    expect(h.store.proposals).toEqual([]);
  });

  it('refuses an invalid input before any dry run', async () => {
    const result = await submitChangeProposal(keyCtx(), { operation: 'stock.adjust', input: { productId: 'product-live', delta: 0, reason: 'x' } }, h.submitDeps);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation', message: 'Invalid stock adjustment payload' } });
    expect(h.transaction.calls).toEqual([]);
  });

  it('keeps live values out of the receipt', async () => {
    const result = await submitChangeProposal(keyCtx(), { operation: 'product.update', input: { id: 'product-mug', description: 'Fresh' } }, h.submitDeps);
    if (!result.ok) throw new Error(result.error.message);
    expect(Object.keys(result.value).sort()).toEqual(['createdAt', 'decisionNote', 'expiresAt', 'failureCode', 'groupId', 'id', 'input', 'operation', 'status', 'target']);
    expect(JSON.stringify(result.value)).not.toContain('Mug');
    expect(result.value.input).toEqual({ id: 'product-mug', description: 'Fresh' });
  });
});

describe('submitChangeProposal authorization', () => {
  it.each(privilegeConfusion.filter(([label]) => label !== 'a propose-mode key'))('refuses %s', async (_label, ctx) => {
    const h = harness();
    const result = await submitChangeProposal(ctx, { operation: 'product.update', input: OPERATION_INPUTS['product.update'] }, h.submitDeps);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(['forbidden', 'impersonation_read_only']).toContain(result.error.code);
    expect(h.transaction.calls).toEqual([]);
  });

  it('refuses an owner session even though the owner holds the submission capability', async () => {
    const h = harness();
    const result = await submitChangeProposal(ownerSession, { operation: 'product.update', input: OPERATION_INPUTS['product.update'] }, h.submitDeps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('refuses a propose-mode key without the family\'s write scope', async () => {
    const h = harness([shopKey({ scopes: ['shop:catalog:read', 'shop:settings:write'] })]);
    const result = await submitChangeProposal(keyCtx(['shop:catalog:read', 'shop:settings:write']), { operation: 'product.update', input: OPERATION_INPUTS['product.update'] }, h.submitDeps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden', message: 'proposal:submit:catalog is not permitted' } });
  });

  it.each([
    ['catalogue', 'product.update', ['shop:catalog:write', 'shop:settings:read'], 'product:read is not permitted'],
    ['catalogue', 'stock.adjust', ['shop:catalog:write'], 'product:read is not permitted'],
  ] as const)('refuses a %s proposal from a key row without the family\'s read scope before any dry run', async (_family, operation, scopes, message) => {
    const h = harness([shopKey({ scopes: [...scopes] })]);
    const result = await submitChangeProposal(keyCtx([...scopes]), { operation, input: OPERATION_INPUTS[operation] }, h.submitDeps);
    expect(result).toEqual({ ok: false, error: { code: 'forbidden', message } });
    expect(h.transaction.calls).toEqual([]);
    expect(h.store.proposals).toEqual([]);
  });

  it('refuses a key that is revoked, expired, purged or in direct mode at insert time', async () => {
    for (const keys of [[shopKey({ revokedAt: NOW })], [shopKey({ expiresAt: NOW })], [shopKey({ mode: 'direct' })]]) {
      const h = harness(keys);
      const result = await submitChangeProposal(keyCtx(), { operation: 'product.update', input: OPERATION_INPUTS['product.update'] }, h.submitDeps);
      expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(h.store.proposals).toEqual([]);
    }
    const purged = harness([]);
    const result = await submitChangeProposal(keyCtx(), { operation: 'product.update', input: OPERATION_INPUTS['product.update'] }, purged.submitDeps);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(purged.transaction.calls).toEqual([]);
  });
});

describe('submitChangeProposal caps', () => {
  const submit = (h: Harness) =>
    submitChangeProposal(keyCtx(), { operation: 'product.update', input: OPERATION_INPUTS['product.update'] }, h.submitDeps);

  it('refuses the 201st pending proposal of a key but not of another key', async () => {
    const h = harness([shopKey(), shopKey({ id: OTHER_KEY_ID })]);
    for (let index = 0; index < CHANGE_PROPOSAL_LIMITS.pendingPerKey; index += 1) {
      h.store.seed(storedProposal({ id: `seeded-${String(index)}`, createdAt: '2026-02-01T00:00:00.000Z' }));
    }
    expect(await submit(h)).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'key_pending' } } });
    expect(h.transaction.calls).toEqual([]);
    const other = await submitChangeProposal(keyCtx(CATALOG_PROPOSER, 'propose', OTHER_KEY_ID), { operation: 'product.update', input: OPERATION_INPUTS['product.update'] }, h.submitDeps);
    expect(other.ok).toBe(true);
  });

  it('does not count expired or decided proposals toward the pending caps', async () => {
    const h = harness();
    for (let index = 0; index < CHANGE_PROPOSAL_LIMITS.pendingPerKey; index += 1) {
      h.store.seed(storedProposal({ id: `old-${String(index)}`, createdAt: '2026-01-01T00:00:00.000Z' }));
    }
    expect((await submit(h)).ok).toBe(true);
  });

  it('refuses a proposal beyond the workspace pending cap', async () => {
    const h = harness();
    for (let index = 0; index < CHANGE_PROPOSAL_LIMITS.pendingPerWorkspace; index += 1) {
      h.store.seed(storedProposal({ id: `workspace-${String(index)}`, proposedByKeyId: `key-${String(index % 10)}`, createdAt: '2026-02-01T00:00:00.000Z' }));
    }
    expect(await submit(h)).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'workspace_pending' } } });
    expect(h.transaction.calls).toEqual([]);
  });

  it('refuses the 501st proposal a key created in 24 hours whatever their status', async () => {
    const h = harness();
    for (let index = 0; index < CHANGE_PROPOSAL_LIMITS.createdPerKeyPerWindow; index += 1) {
      h.store.seed(storedProposal({ id: `daily-${String(index)}`, status: 'withdrawn', createdAt: '2026-03-01T01:00:00.000Z' }));
    }
    expect(await submit(h)).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'key_daily' } } });
    expect(h.transaction.calls).toEqual([]);
  });

  it('re-checks the count caps atomically at insert when the slot fills during the dry run', async () => {
    const h = harness();
    for (let index = 0; index < CHANGE_PROPOSAL_LIMITS.pendingPerKey - 1; index += 1) {
      h.store.seed(storedProposal({ id: `racing-${String(index)}`, createdAt: '2026-02-01T00:00:00.000Z' }));
    }
    const dryRun = h.transaction.dryRun.bind(h.transaction);
    h.submitDeps.changeProposalTransaction = {
      ...h.transaction,
      dryRun: async (tenantId, operation) => {
        h.store.seed(storedProposal({ id: 'racing-last', createdAt: '2026-02-01T00:00:00.000Z' }));
        return dryRun(tenantId, operation);
      },
    };
    expect(await submit(h)).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'key_pending' } } });
    expect(h.transaction.calls).toEqual(['dryRun']);
  });

  it('answers unavailable with a retry-after when the insert cannot take the workspace lock', async () => {
    const h = harness();
    h.submitDeps.changeProposals = { ...h.store.repository, create: async () => ({ kind: 'busy' }) };
    expect(await submit(h)).toMatchObject({ ok: false, error: { code: 'unavailable', details: { retryAfterSeconds: 5 } } });
  });

  it('accepts a 50,000-character description over an existing 50,000-character description', async () => {
    const h = harness();
    h.state.products.push(product({ id: 'product-long', slug: 'long', description: 'y'.repeat(50_000) }));
    const result = await submitChangeProposal(keyCtx(), { operation: 'product.update', input: { id: 'product-long', description: 'x'.repeat(50_000) } }, h.submitDeps);
    expect(result).toMatchObject({ ok: true, value: { status: 'pending' } });
    expect(h.store.proposals[0]?.effect).toEqual({ description: { before: 'y'.repeat(50_000), after: 'x'.repeat(50_000) } });
  });

  it('refuses an effect larger than the stored-effect cap with a conflict the key can read', async () => {
    const h = harness();
    h.state.products.push(product({ id: 'product-oversized', slug: 'oversized', description: 'y'.repeat(CHANGE_PROPOSAL_LIMITS.effectMaxBytes) }));
    const result = await submitChangeProposal(keyCtx(), { operation: 'product.update', input: { id: 'product-oversized', description: 'Short' } }, h.submitDeps);
    expect(result).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'effect_size' } } });
    expect(h.store.proposals).toEqual([]);
  });
});

describe('key-side proposal management', () => {
  const seedOwnAndForeign = (h: Harness) => {
    h.store.seed(storedProposal({ id: 'own-1', createdAt: '2026-02-28T09:00:00.000Z' }));
    h.store.seed(storedProposal({ id: 'own-2', createdAt: '2026-02-28T10:00:00.000Z', status: 'rejected', decisionNote: 'No' }));
    h.store.seed(storedProposal({ id: 'own-3', createdAt: '2026-02-28T11:00:00.000Z' }));
    h.store.seed(storedProposal({ id: 'other-key', proposedByKeyId: OTHER_KEY_ID }));
    h.store.seed(storedProposal({ id: 'other-workspace', tenantId: NEIGHBOUR }));
  };

  it('lists only the key\'s own proposals, newest first, with a cursor and a status filter', async () => {
    const h = harness();
    seedOwnAndForeign(h);
    const first = await listOwnChangeProposals(keyCtx(), { limit: 2 }, h.keyDeps);
    if (!first.ok) throw new Error(first.error.message);
    expect(changeProposalKeyReceiptPageSchema.parse(first.value)).toEqual(first.value);
    expect(first.value.proposals.map(({ id }) => id)).toEqual(['own-3', 'own-2']);
    expect(first.value.nextCursor).toBe('own-2');
    const second = await listOwnChangeProposals(keyCtx(), { limit: 2, cursor: 'own-2' }, h.keyDeps);
    expect(second).toMatchObject({ ok: true, value: { proposals: [{ id: 'own-1' }], nextCursor: null } });
    const pending = await listOwnChangeProposals(keyCtx(), { status: 'pending' }, h.keyDeps);
    expect(pending.ok && pending.value.proposals.map(({ id }) => id)).toEqual(['own-3', 'own-1']);
    const foreignCursor = await listOwnChangeProposals(keyCtx(), { cursor: 'other-key' }, h.keyDeps);
    expect(foreignCursor).toMatchObject({ ok: true, value: { proposals: [], nextCursor: null } });
  });

  it('lets a read-only propose-mode key list its (empty) proposals', async () => {
    const h = harness();
    expect(await listOwnChangeProposals(keyCtx(['shop:orders:read']), {}, h.keyDeps)).toEqual({ ok: true, value: { proposals: [], nextCursor: null } });
  });

  it('shows a receipt without the effect and hides other keys\' and workspaces\' proposals', async () => {
    const h = harness();
    seedOwnAndForeign(h);
    const own = await getOwnChangeProposal(keyCtx(), { id: 'own-1' }, h.keyDeps);
    if (!own.ok) throw new Error(own.error.message);
    expect(own.value).not.toHaveProperty('effect');
    expect(JSON.stringify(own.value)).not.toContain('"Mug"');
    expect(await getOwnChangeProposal(keyCtx(), { id: 'other-key' }, h.keyDeps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await getOwnChangeProposal(keyCtx(), { id: 'other-workspace' }, h.keyDeps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('withdraws a pending proposal once and answers conflict afterwards', async () => {
    const h = harness();
    seedOwnAndForeign(h);
    const withdrawn = await withdrawOwnChangeProposal(keyCtx(), { id: 'own-1' }, h.keyDeps);
    expect(withdrawn).toMatchObject({ ok: true, value: { id: 'own-1', status: 'withdrawn' } });
    expect(withdrawn.ok && withdrawn.value).not.toHaveProperty('effect');
    expect(h.store.eventRows).toEqual([expect.objectContaining({ proposalId: 'own-1', kind: 'withdrawn', apiKeyId: KEY_ID, actorUserId: null })]);
    expect(await withdrawOwnChangeProposal(keyCtx(), { id: 'own-1' }, h.keyDeps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'withdrawn' } } });
    expect(await withdrawOwnChangeProposal(keyCtx(), { id: 'own-2' }, h.keyDeps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('never withdraws another key\'s or workspace\'s proposal', async () => {
    const h = harness();
    seedOwnAndForeign(h);
    expect(await withdrawOwnChangeProposal(keyCtx(), { id: 'other-key' }, h.keyDeps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await withdrawOwnChangeProposal(keyCtx(), { id: 'other-workspace' }, h.keyDeps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await withdrawOwnChangeProposal(keyCtx(CATALOG_PROPOSER, 'propose', KEY_ID, NEIGHBOUR), { id: 'own-1' }, h.keyDeps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.store.proposals.filter(({ status }) => status !== 'pending').map(({ id }) => id)).toEqual(['own-2']);
  });

  it('records the expiry of an expired proposal once and answers conflict', async () => {
    const h = harness();
    h.store.seed(storedProposal({ id: 'stale-1', createdAt: '2026-01-01T00:00:00.000Z' }));
    expect(await withdrawOwnChangeProposal(keyCtx(), { id: 'stale-1' }, h.keyDeps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'expired' } } });
    await withdrawOwnChangeProposal(keyCtx(), { id: 'stale-1' }, h.keyDeps);
    expect(h.store.eventRows).toEqual([expect.objectContaining({ proposalId: 'stale-1', kind: 'expired', apiKeyId: KEY_ID })]);
    expect(h.store.proposals[0]?.status).toBe('pending');
    const shown = await getOwnChangeProposal(keyCtx(), { id: 'stale-1' }, h.keyDeps);
    expect(shown).toMatchObject({ ok: true, value: { status: 'expired' } });
  });

  it.each([
    ['an owner session', ownerSession],
    ['a direct-mode key', keyCtx(['shop:catalog:read', 'shop:catalog:write'], 'direct')],
    ['an admin session', { identity: identity({ staffRole: 'admin' }) }],
    ['a legacy tenant API key', { identity: identity({ userId: 'api-key', staffRole: null, tenantAccess: 'none' }), capabilities: capabilitiesForApiKey({ scopes: null }) }],
  ] as const)('refuses %s on every key-side use-case', async (_label, ctx) => {
    const h = harness();
    seedOwnAndForeign(h);
    for (const result of [
      await listOwnChangeProposals(ctx, {}, h.keyDeps),
      await getOwnChangeProposal(ctx, { id: 'own-1' }, h.keyDeps),
      await withdrawOwnChangeProposal(ctx, { id: 'own-1' }, h.keyDeps),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    }
    expect(h.store.eventRows).toEqual([]);
  });
});

describe('owner-side proposal review', () => {
  const seedForOwner = (h: Harness) => {
    h.store.seed(storedProposal({ id: 'p-active', createdAt: '2026-02-28T09:00:00.000Z' }));
    h.store.seed(storedProposal({ id: 'p-revoked', proposedByKeyId: 'key-revoked', proposedByKeyName: 'Old agent', createdAt: '2026-02-28T10:00:00.000Z' }));
    h.store.seed(storedProposal({ id: 'p-expired-key', proposedByKeyId: 'key-expired', createdAt: '2026-02-28T11:00:00.000Z', status: 'withdrawn' }));
    h.store.seed(storedProposal({ id: 'p-purged', proposedByKeyId: 'key-purged', createdAt: '2026-02-28T12:00:00.000Z' }));
    h.store.seed(storedProposal({ id: 'p-stale', createdAt: '2026-01-01T00:00:00.000Z' }));
    h.store.seed(storedProposal({ id: 'p-neighbour', tenantId: NEIGHBOUR }));
  };
  const ownerKeys = () => [
    shopKey(),
    shopKey({ id: 'key-revoked', revokedAt: '2026-02-28T12:00:00.000Z' }),
    shopKey({ id: 'key-expired', expiresAt: '2026-02-28T12:00:00.000Z' }),
  ];

  it('lists the workspace\'s proposals with the key state, a status filter and cursor paging', async () => {
    const h = harness(ownerKeys());
    seedForOwner(h);
    const all = await listChangeProposals(ownerSession, {}, h.ownerDeps);
    if (!all.ok) throw new Error(all.error.message);
    expect(changeProposalOwnerPageSchema.parse(all.value)).toEqual(all.value);
    expect(all.value.proposals.map(({ id, proposedBy }) => [id, proposedBy.keyState])).toEqual([
      ['p-purged', 'purged'], ['p-expired-key', 'expired'], ['p-revoked', 'revoked'], ['p-active', 'active'], ['p-stale', 'active'],
    ]);
    expect(all.value.proposals[0]?.effect).toEqual({ title: { before: 'Mug', after: 'Big mug' } });
    const pending = await listChangeProposals(ownerSession, { status: 'pending', limit: 2 }, h.ownerDeps);
    expect(pending).toMatchObject({ ok: true, value: { proposals: [{ id: 'p-purged' }, { id: 'p-revoked' }], nextCursor: 'p-revoked' } });
    const next = await listChangeProposals(ownerSession, { status: 'pending', limit: 2, cursor: 'p-revoked' }, h.ownerDeps);
    expect(next).toMatchObject({ ok: true, value: { proposals: [{ id: 'p-active' }], nextCursor: null } });
    const expired = await listChangeProposals(ownerSession, { status: 'expired' }, h.ownerDeps);
    expect(expired).toMatchObject({ ok: true, value: { proposals: [{ id: 'p-stale', status: 'expired' }] } });
    expect(await listChangeProposals(ownerSession, { limit: 0 }, h.ownerDeps)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('shows the full owner view with the events', async () => {
    const h = harness(ownerKeys());
    const submitted = await submitChangeProposal(keyCtx(), { operation: 'product.update', input: OPERATION_INPUTS['product.update'] }, h.submitDeps);
    if (!submitted.ok) throw new Error(submitted.error.message);
    const shown = await getChangeProposal(ownerSession, { id: submitted.value.id }, h.ownerDeps);
    if (!shown.ok) throw new Error(shown.error.message);
    expect(changeProposalOwnerDetailSchema.parse(shown.value)).toEqual(shown.value);
    expect(shown.value).toMatchObject({
      effect: { title: { before: 'Mug', after: 'Big mug' } },
      proposedBy: { keyId: KEY_ID, keyName: 'Catalogue agent', issuerUserId: OWNER, keyState: 'active' },
      events: [{ sequence: 1, kind: 'proposed', apiKeyId: KEY_ID }],
    });
    expect(await getChangeProposal(ownerSession, { id: 'missing' }, h.ownerDeps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('never reads another workspace\'s proposal', async () => {
    const h = harness(ownerKeys());
    seedForOwner(h);
    expect(await getChangeProposal(ownerSession, { id: 'p-neighbour' }, h.ownerDeps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await rejectChangeProposal(ownerSession, { id: 'p-neighbour' }, h.decisionDeps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    const list = await listChangeProposals(ownerSession, {}, h.ownerDeps);
    expect(list.ok && list.value.proposals.map(({ id }) => id)).not.toContain('p-neighbour');
  });

  it('rejects a pending proposal with a note, once', async () => {
    const h = harness(ownerKeys());
    seedForOwner(h);
    const rejected = await rejectChangeProposal(ownerSession, { id: 'p-active', note: '  Not this season  ' }, h.decisionDeps);
    expect(rejected).toMatchObject({ ok: true, value: { id: 'p-active', status: 'rejected', decidedByUserId: OWNER, decisionNote: 'Not this season', decidedAt: NOW } });
    expect(h.store.eventRows).toEqual([expect.objectContaining({ proposalId: 'p-active', kind: 'rejected', actorUserId: OWNER, note: 'Not this season' })]);
    expect(await rejectChangeProposal(ownerSession, { id: 'p-active' }, h.decisionDeps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'rejected' } } });
    const receipt = await getOwnChangeProposal(keyCtx(), { id: 'p-active' }, h.keyDeps);
    expect(receipt).toMatchObject({ ok: true, value: { status: 'rejected', decisionNote: 'Not this season' } });
    expect(receipt.ok && receipt.value).not.toHaveProperty('decidedByUserId');
  });

  it('rejects without a note and refuses an overlong note', async () => {
    const h = harness(ownerKeys());
    seedForOwner(h);
    expect(await rejectChangeProposal(ownerSession, { id: 'p-revoked', note: 'x'.repeat(CHANGE_PROPOSAL_LIMITS.decisionNoteMaxLength + 1) }, h.decisionDeps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await rejectChangeProposal(ownerSession, { id: 'p-revoked', note: '   ' }, h.decisionDeps))
      .toMatchObject({ ok: true, value: { decisionNote: null, proposedBy: { keyState: 'revoked' } } });
  });

  it('answers conflict to a reject after a withdrawal', async () => {
    const h = harness(ownerKeys());
    seedForOwner(h);
    expect((await withdrawOwnChangeProposal(keyCtx(), { id: 'p-active' }, h.keyDeps)).ok).toBe(true);
    expect(await rejectChangeProposal(ownerSession, { id: 'p-active' }, h.decisionDeps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'withdrawn' } } });
  });

  it('records the expiry when a reject meets an expired proposal and answers conflict', async () => {
    const h = harness(ownerKeys());
    seedForOwner(h);
    expect(await rejectChangeProposal(ownerSession, { id: 'p-stale' }, h.decisionDeps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'expired' } } });
    expect(h.store.eventRows).toEqual([expect.objectContaining({ proposalId: 'p-stale', kind: 'expired', actorUserId: OWNER })]);
    expect(h.store.proposals.find(({ id }) => id === 'p-stale')?.status).toBe('pending');
  });

  it('answers conflict when the proposal leaves pending between the read and the transition', async () => {
    const h = harness(ownerKeys());
    seedForOwner(h);
    const raced = { ...h.decisionDeps, changeProposals: { ...h.store.repository, transition: async () => null } };
    expect(await rejectChangeProposal(ownerSession, { id: 'p-active' }, raced))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'pending' } } });
    expect(h.store.eventRows).toEqual([]);
  });

  it.each(privilegeConfusion)('refuses %s on list, show and reject', async (_label, ctx) => {
    const h = harness(ownerKeys());
    seedForOwner(h);
    for (const result of [
      await listChangeProposals(ctx, {}, h.ownerDeps),
      await getChangeProposal(ctx, { id: 'p-active' }, h.ownerDeps),
      await rejectChangeProposal(ctx, { id: 'p-active' }, h.decisionDeps),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(['forbidden', 'impersonation_read_only']).toContain(result.error.code);
    }
    expect(h.store.proposals.find(({ id }) => id === 'p-active')?.status).toBe('pending');
    expect(h.store.eventRows).toEqual([]);
  });
});
