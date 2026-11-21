import { describe, expect, it, vi } from 'vitest';

import {
  appError,
  CHANGE_PROPOSAL_GROUP_LIMITS,
  CHANGE_PROPOSAL_LIMITS,
  changeProposalExpiresAt,
  changeProposalGroupKeyReceiptSchema,
  changeProposalGroupOwnerViewSchema,
  changeProposalReference,
  ok,
  type AppError,
  type ChangeProposal,
  type ChangeProposalGroupKeyReceipt,
  type ChangeProposalOperation,
  type Identity,
  type Product,
  type ProductDownloadAsset,
  type ProductPrice,
  type Result,
  type ShopManagementKey,
  type ShopManagementScope,
  type TenantSettings,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { ChangeProposalGroupRepository, ChangeProposalTransaction, StorageProvider } from '../ports.js';
import {
  createChangeProposalStoreFake,
  changeProposalOwnerViewFakes,
  createChangeProposalTransactionFake,
  createUnreadNotificationsFake,
  emptyCatalogState,
  failingSalesLinkSaves,
  type FakeChangeProposalStore,
  type FakeChangeProposalTransaction,
} from '../testing/change-proposal-fakes.js';
import {
  approveChangeProposalGroup,
  createChangeProposalGroup,
  getChangeProposalGroup,
  getOwnChangeProposalGroup,
  rejectChangeProposalGroup,
  submitGroupedChangeProposal,
  withdrawOwnChangeProposalGroup,
} from './change-proposal-groups.js';
import {
  approveChangeProposal,
  getChangeProposal,
  listChangeProposals,
  rejectChangeProposal,
  submitChangeProposal,
  withdrawOwnChangeProposal,
} from './change-proposals.js';
import { shopManagementKeyCapabilities } from './shop-machine-auth.js';

const TENANT = 'tenant-acme';
const NEIGHBOUR = 'tenant-studio';
const OWNER = 'user-owner';
const ISSUER = 'user-issuer';
const NOW = '2026-03-01T10:00:00.000Z';
const KEY_ID = 'key-propose';
const OTHER_KEY_ID = 'key-other';
const NEIGHBOUR_KEY_ID = 'key-neighbour';
const SCOPES: ShopManagementScope[] = ['shop:catalog:read', 'shop:catalog:write', 'shop:settings:read', 'shop:settings:write'];

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  userId: OWNER, email: 'owner@example.test', name: 'Owner', emailVerified: true, tenantAccess: 'staff',
  tenantId: TENANT, tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  ...overrides,
});

const ownerSession: Ctx = { identity: identity() };
const neighbourOwner: Ctx = { identity: identity({ tenantId: NEIGHBOUR, tenantSlug: 'studio', userId: 'user-neighbour' }) };

const keyCtx = (apiKeyId = KEY_ID, tenantId = TENANT, mode: ShopManagementKey['mode'] = 'propose'): Ctx => ({
  identity: identity({ userId: ISSUER, email: 'issuer@example.test', tenantId }),
  capabilities: shopManagementKeyCapabilities({ scopes: SCOPES, mode }),
  machineActor: { kind: 'shop_management_key', apiKeyId, mode },
});

const shopKey = (overrides: Partial<ShopManagementKey> = {}): ShopManagementKey => ({
  id: KEY_ID, tenantId: TENANT, name: 'Catalogue agent', keyHash: 'hash', scopes: SCOPES, mode: 'propose',
  issuedByUserId: ISSUER, createdAt: '2026-02-25T00:00:00.000Z', expiresAt: '2026-06-20T00:00:00.000Z', revokedAt: null,
  ...overrides,
});

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

const downloadAsset: ProductDownloadAsset = {
  id: 'asset-1', tenantId: TENANT, lineageId: 'lineage-1', versionNumber: 1, versionNote: null, supersededAt: null,
  replacesAssetId: null, productId: 'product-draft', fileName: 'guide.pdf', contentType: 'application/pdf', sizeBytes: 10,
  storageKey: 'downloads/guide.pdf', status: 'ready', createdAt: '2026-01-01T00:00:00.000Z',
};

const shopSettings: TenantSettings = {
  name: 'Acme', socialLinks: [], signInNotice: { enabled: false, text: '' }, billingPortalUrl: null, bunnyStreamLibraryId: null,
  bunnyStreamCdnHostname: null, logoUrl: null, logoDarkUrl: null, accentColor: null, accentLight: null, faviconUrl: null,
  ogTitle: null, ogDescription: null, ogImageUrl: null, supportEmail: null, supportUrl: null, termsUrl: null,
  privacyUrl: null, defaultHomeSpaceId: null,
  invoiceVatMode: 'rate', invoiceVatRatePercent: 23, shippingRates: [],
};

const storageSecrets = {
  resolve: async () => ok(JSON.stringify({ provider: 'aws_s3', endpoint: 'https://storage.example.test', bucket: 'downloads', region: 'auto', accessKeyId: 'a', secretAccessKey: 's' })),
};

const recordingStorage = (deletes: string[]): StorageProvider => {
  const refuse = () => { throw new Error('Only object deletes are expected'); };
  return {
    objectUrl: (_configuration, key) => new URL(`https://storage.example.test/${key}`),
    delete: async (input) => {
      deletes.push(input.url);
      return ok({ deleted: true });
    },
    list: refuse, getObject: refuse, putObject: refuse, probe: refuse, probeCors: refuse, presignPut: refuse,
    presignGet: refuse, head: refuse, healthcheck: refuse, test: refuse,
  };
};

const unwrap = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};

const harness = (keys: ShopManagementKey[] = [
  shopKey(),
  shopKey({ id: OTHER_KEY_ID, name: 'Second agent', keyHash: 'hash-other' }),
  shopKey({ id: NEIGHBOUR_KEY_ID, tenantId: NEIGHBOUR, keyHash: 'hash-neighbour' }),
]) => {
  const state = emptyCatalogState();
  state.products.push(
    product(),
    product({ id: 'product-draft', slug: 'draft', title: 'Draft guide', type: 'digital_download' }),
    product({ id: 'product-live', slug: 'live', title: 'Live mug', published: true }),
    product({ id: 'product-neighbour', tenantId: NEIGHBOUR, slug: 'neighbour', title: 'Neighbour mug' }),
  );
  state.everPublished.push('product-live');
  state.prices.push(price(), price({ id: 'price-live', productId: 'product-live' }));
  state.stock.push({ tenantId: TENANT, productId: 'product-live', onHand: 12, reserved: 0, lowStockThreshold: 2, lowStockNotifiedAt: null, updatedAt: NOW });
  state.downloadAssets.push(downloadAsset);
  state.settings.push({ tenantId: TENANT, settings: structuredClone(shopSettings) }, { tenantId: NEIGHBOUR, settings: structuredClone(shopSettings) });
  const store: FakeChangeProposalStore = createChangeProposalStoreFake(keys);
  const transaction: FakeChangeProposalTransaction = createChangeProposalTransactionFake(state, store, storageSecrets);
  const deletes: string[] = [];
  const accounts = [
    { userId: ISSUER, email: 'issuer@example.test', ownerOf: [TENANT] },
    { userId: OWNER, email: 'owner@example.test', ownerOf: [TENANT] },
  ];
  const notificationFakes = createUnreadNotificationsFake(accounts);
  let sequence = 0;
  const clock = { now: NOW };
  const deps = {
    changeProposalTransaction: transaction,
    changeProposals: store.repository,
    changeProposalGroups: store.groups,
    changeProposalEvents: store.events,
    shopManagementKeys: { listByTenant: async (tenantId: string) => keys.filter((key) => key.tenantId === tenantId) },
    ...notificationFakes,
    ...changeProposalOwnerViewFakes(state, accounts),
    storage: recordingStorage(deletes),
    logger: { error: vi.fn<(message: string) => void>() },
    ids: { nextId: () => `generated-${String(++sequence)}` },
    clock: { nowIso: () => clock.now },
  };
  const group = async (title = 'Spring launch', ctx = keyCtx()): Promise<string> => unwrap(await createChangeProposalGroup(ctx, { title }, deps)).id;
  const join = (groupId: string, operation: ChangeProposalOperation, input: unknown, ctx = keyCtx()) =>
    submitGroupedChangeProposal(ctx, { groupId, operation, input }, deps);
  const add = async (groupId: string, operation: ChangeProposalOperation, input: unknown): Promise<ChangeProposalGroupKeyReceipt> =>
    unwrap(await join(groupId, operation, input));
  const lastItemId = (receipt: ChangeProposalGroupKeyReceipt): string => {
    const last = receipt.items.at(-1);
    if (last === undefined) throw new Error('The group has no items');
    return last.id;
  };
  const items = (groupId: string): ChangeProposal[] =>
    store.proposals.filter((proposal) => proposal.groupId === groupId).sort((left, right) => (left.groupPosition ?? 0) - (right.groupPosition ?? 0));
  const approve = (groupId: string, itemIds = items(groupId).map((item) => item.id), ctx = ownerSession) =>
    approveChangeProposalGroup(ctx, { id: groupId, itemIds }, deps);
  const events = (id: string): string[] => store.eventRows.filter((event) => event.proposalId === id)
    .map(({ sequence: position, kind }) => `${String(position)}:${kind}`);
  return { state, store, transaction, deps, deletes, clock, group, join, add, lastItemId, items, approve, events, notifications: notificationFakes };
};

type Harness = ReturnType<typeof harness>;

const liveProduct = (h: Harness, id: string) => h.state.products.find((candidate) => candidate.id === id);

const launchChain = async (h: Harness) => {
  const groupId = await h.group();
  const created = h.lastItemId(await h.add(groupId, 'product.create', { title: 'Teapot', slug: 'teapot', type: 'physical', priceCents: 0, currency: 'EUR' }));
  const teapot = changeProposalReference(created);
  const priced = h.lastItemId(await h.add(groupId, 'price.create', { productId: teapot, kind: 'one_time', amountCents: 2500, currency: 'EUR' }));
  const stocked = h.lastItemId(await h.add(groupId, 'stock.enable', { productId: teapot, onHand: 4, lowStockThreshold: 1 }));
  const published = h.lastItemId(await h.add(groupId, 'product.publish', { id: teapot }));
  const linked = h.lastItemId(await h.add(groupId, 'sales-link.create', { slug: 'teapot-offer', title: 'Teapot', heading: 'Teapot offer', productIds: [teapot, 'product-live'] }));
  return { groupId, created, priced, stocked, published, linked, teapot };
};

describe('creating a change proposal group', () => {
  it('opens an empty group for a propose-mode key and answers its key receipt', async () => {
    const h = harness();
    const receipt = unwrap(await createChangeProposalGroup(keyCtx(), { title: '  Spring launch  ' }, h.deps));

    expect(changeProposalGroupKeyReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(receipt).toEqual({ id: 'generated-1', title: 'Spring launch', status: 'open', createdAt: NOW, expiresAt: changeProposalExpiresAt(NOW), items: [] });
    expect(h.store.groupRows).toEqual([{ id: 'generated-1', tenantId: TENANT, title: 'Spring launch', proposedByKeyId: KEY_ID, createdAt: NOW }]);
  });

  it.each<[string, Ctx]>([
    ['an owner session', ownerSession],
    ['a direct-mode key', keyCtx(KEY_ID, TENANT, 'direct')],
  ])('refuses %s', async (_label, ctx) => {
    const h = harness();
    expect(await createChangeProposalGroup(ctx, { title: 'Launch' }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.store.groupRows).toEqual([]);
  });

  it('caps the open groups of one key and stops counting a group once it expired or settled', async () => {
    const h = harness();
    for (let index = 0; index < CHANGE_PROPOSAL_GROUP_LIMITS.openGroupsPerKey; index += 1) await h.group(`Group ${String(index)}`);

    expect(await createChangeProposalGroup(keyCtx(), { title: 'One too many' }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'key_open_groups' } } });
    expect(await createChangeProposalGroup(keyCtx(OTHER_KEY_ID), { title: 'Another key' }, h.deps)).toMatchObject({ ok: true });

    h.clock.now = '2026-04-01T10:00:00.000Z';
    expect(await createChangeProposalGroup(keyCtx(), { title: 'After expiry' }, h.deps)).toMatchObject({ ok: true });
  });

  it('frees the slot of an empty group its key withdraws', async () => {
    const h = harness();
    const groupId = await h.group();

    expect(await withdrawOwnChangeProposalGroup(keyCtx(), { id: groupId }, h.deps)).toMatchObject({ ok: true, value: { status: 'withdrawn', items: [] } });
    expect(h.store.groupRows).toEqual([]);
    expect(await getOwnChangeProposalGroup(keyCtx(), { id: groupId }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('a group built item by item and applied as one unit', () => {
  it('previews every item against the state the group produces, leaves live state alone, then applies all of it', async () => {
    const h = harness();
    const before = structuredClone(h.state);
    const { groupId, created, priced, stocked, published, linked, teapot } = await launchChain(h);

    expect(h.state).toEqual(before);
    expect(h.transaction.calls).toEqual(['dryRun', 'dryRun', 'dryRun', 'dryRun', 'dryRun']);
    expect(h.deletes).toEqual([]);
    const stored = h.items(groupId);
    expect(stored.map((item) => [item.groupPosition, item.operation, item.target])).toEqual([
      [1, 'product.create', { kind: 'product', id: null }],
      [2, 'price.create', { kind: 'product', id: teapot }],
      [3, 'stock.enable', { kind: 'product', id: teapot }],
      [4, 'product.publish', { kind: 'product', id: teapot }],
      [5, 'sales-link.create', { kind: 'sales-link', id: null }],
    ]);
    expect(new Set(stored.map((item) => item.expiresAt))).toEqual(new Set([changeProposalExpiresAt(NOW)]));
    expect(stored[1]?.effect).toEqual({ activePrices: { before: [], after: [{ kind: 'one_time', interval: null, amountCents: 2500, currency: 'EUR' }] } });
    expect(stored[2]?.effect).toEqual({
      tracked: { before: false, after: true }, onHand: { before: null, after: 4 }, lowStockThreshold: { before: null, after: 1 },
    });
    expect(stored[3]?.effect).toEqual({ published: { before: false, after: true } });
    expect(stored[4]?.input).toMatchObject({ productIds: [teapot, 'product-live'] });
    expect(stored[4]?.effect).toMatchObject({ exists: { before: false, after: true }, productIds: { before: null, after: [teapot, 'product-live'] } });
    expect(JSON.stringify(stored.map((item) => item.effect)).replaceAll(/\$proposal:generated-\d+/gu, '')).not.toMatch(/generated-/u);

    const approved = unwrap(await h.approve(groupId, [created, priced, stocked, published, linked]));

    expect(changeProposalGroupOwnerViewSchema.parse(approved)).toEqual(approved);
    expect(approved.status).toBe('applied');
    expect(approved.items.map((item) => item.status)).toEqual(['applied', 'applied', 'applied', 'applied', 'applied']);
    const teapotRow = h.state.products.find((candidate) => candidate.slug === 'teapot');
    if (teapotRow === undefined) throw new Error('The approved product is missing');
    expect(teapotRow).toMatchObject({ published: true, title: 'Teapot' });
    expect(h.state.prices.filter((candidate) => candidate.productId === teapotRow.id)).toEqual([expect.objectContaining({ amountCents: 2500, active: true })]);
    expect(h.state.stock.find((level) => level.productId === teapotRow.id)).toMatchObject({ onHand: 4, lowStockThreshold: 1 });
    const link = h.state.salesLinks.find((candidate) => candidate.slug === 'teapot-offer');
    expect(link?.productIds).toEqual([teapotRow.id, 'product-live']);
    expect(approved.items.map((item) => item.appliedResourceId)).toEqual([
      teapotRow.id, h.state.prices.find((candidate) => candidate.productId === teapotRow.id)?.id, teapotRow.id, teapotRow.id, link?.id,
    ]);
    for (const item of stored) {
      expect(h.events(item.id)).toEqual(['1:proposed', '2:applied']);
      expect(h.store.proposals.find((candidate) => candidate.id === item.id)).toMatchObject({ status: 'applied', decidedByUserId: OWNER, decidedAt: NOW });
    }
    expect(h.transaction.calls.at(-1)).toBe('run');

    expect(await h.approve(groupId)).toMatchObject({
      ok: false,
      error: { code: 'conflict', details: { changeProposalGroupStatus: 'applied', changeProposalStatuses: stored.map((item) => ({ id: item.id, status: 'applied' })) } },
    });
  });

  it('keeps the key receipts free of effects and before values', async () => {
    const h = harness();
    const { groupId } = await launchChain(h);

    const receipt = unwrap(await getOwnChangeProposalGroup(keyCtx(), { id: groupId }, h.deps));

    expect(changeProposalGroupKeyReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(receipt.items).toHaveLength(5);
    expect(JSON.stringify(receipt)).not.toContain('effect');
    expect(JSON.stringify(receipt)).not.toContain('"before"');
  });

  it('refuses a later item whose dry run fails on the state the group produces, and stores nothing', async () => {
    const h = harness();
    const groupId = await h.group();
    const created = h.lastItemId(await h.add(groupId, 'product.create', { title: 'Teapot', slug: 'teapot', type: 'physical', priceCents: 0 }));

    expect(await h.join(groupId, 'product.publish', { id: changeProposalReference(created) }))
      .toMatchObject({ ok: false, error: { code: 'validation', message: 'Physical products require an active one-time price' } });
    expect(h.items(groupId)).toHaveLength(1);
    expect(h.store.eventRows).toHaveLength(1);
  });

  it('answers 409 and stores nothing when an earlier item no longer applies to the live state', async () => {
    const h = harness();
    const groupId = await h.group();
    const renamed = h.lastItemId(await h.add(groupId, 'product.update', { id: 'product-mug', title: 'Big mug' }));
    Object.assign(liveProduct(h, 'product-mug') ?? {}, { title: 'Owner title' });

    expect(await h.join(groupId, 'product.publish', { id: 'product-mug' }))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupItem: renamed } } });
    expect(h.items(groupId)).toHaveLength(1);
  });

  it('runs earlier draft deletions in the dry run without any storage call', async () => {
    const h = harness();
    const groupId = await h.group();
    await h.add(groupId, 'product.delete-draft', { productId: 'product-draft' });
    await h.add(groupId, 'product.update', { id: 'product-mug', title: 'Big mug' });

    expect(h.deletes).toEqual([]);
    expect(h.transaction.deferredDropped).toBe(2);
    expect(liveProduct(h, 'product-draft')).toBeDefined();

    expect(unwrap(await h.approve(groupId)).status).toBe('applied');
    expect(h.deletes).toEqual(['https://storage.example.test/downloads/guide.pdf']);
  });
});

describe('group approval is all or nothing', () => {
  const partiallyStaleGroup = async (h: Harness, third: [ChangeProposalOperation, unknown]) => {
    const groupId = await h.group();
    const created = h.lastItemId(await h.add(groupId, 'product.create', { title: 'Teapot', slug: 'teapot', type: 'physical', priceCents: 0 }));
    await h.add(groupId, 'price.create', { productId: changeProposalReference(created), kind: 'one_time', amountCents: 2500, currency: 'EUR' });
    const offending = h.lastItemId(await h.add(groupId, third[0], third[1]));
    await h.add(groupId, 'product.publish', { id: changeProposalReference(created) });
    return { groupId, offending };
  };

  it('records the moved third item stale, every other item stale with a note naming it, and changes nothing live', async () => {
    const h = harness();
    const { groupId, offending } = await partiallyStaleGroup(h, ['product.update', { id: 'product-mug', title: 'Big mug' }]);
    Object.assign(liveProduct(h, 'product-mug') ?? {}, { title: 'Owner title' });
    const live = structuredClone(h.state);

    const approved = unwrap(await h.approve(groupId));

    expect(h.state).toEqual(live);
    expect(approved.status).toBe('stale');
    expect(approved.items.map((item) => [item.status, item.appliedResourceId])).toEqual([['stale', null], ['stale', null], ['stale', null], ['stale', null]]);
    const note = `Not applied: item 3 (${offending}) of this group could not be applied, so nothing in the group was changed`;
    expect(approved.items.map((item) => item.events.at(-1)?.note)).toEqual([note, note, null, note]);
    for (const item of h.items(groupId)) expect(h.events(item.id)).toEqual(['1:proposed', '2:stale']);
  });

  it('records the failing third item with its failure and changes nothing live', async () => {
    const h = harness();
    const { groupId, offending } = await partiallyStaleGroup(h, ['stock.adjust', { productId: 'product-live', delta: -10, reason: 'Count' }]);
    const level = h.state.stock.find((candidate) => candidate.productId === 'product-live');
    if (level === undefined) throw new Error('stock missing');
    level.onHand = 5;
    const live = structuredClone(h.state);

    const approved = unwrap(await h.approve(groupId));

    expect(h.state).toEqual(live);
    expect(approved.status).toBe('failed');
    expect(approved.items.find((item) => item.id === offending)).toMatchObject({
      status: 'failed', failureCode: 'validation', failureMessage: 'Stock on hand cannot go below zero', appliedResourceId: null,
    });
    expect(approved.items.filter((item) => item.id !== offending).map((item) => item.status)).toEqual(['stale', 'stale', 'stale']);
    expect(h.events(offending)).toEqual(['1:proposed', '2:apply_failed']);
  });

  it('marks the group stale when a stored reference was moved to another item, although the effect names were kept', async () => {
    const h = harness();
    const groupId = await h.group();
    const first = h.lastItemId(await h.add(groupId, 'product.create', { title: 'Teapot', slug: 'teapot', type: 'physical', priceCents: 0 }));
    const second = h.lastItemId(await h.add(groupId, 'product.create', { title: 'Kettle', slug: 'kettle', type: 'physical', priceCents: 0 }));
    const link = h.lastItemId(await h.add(groupId, 'sales-link.create', { slug: 'offer', title: 'Offer', heading: 'Offer', productIds: [changeProposalReference(first)] }));
    const stored = h.store.proposals.find((candidate) => candidate.id === link);
    if (stored === undefined) throw new Error('link item missing');
    stored.input = { ...stored.input, productIds: [changeProposalReference(second)] };

    expect(unwrap(await h.approve(groupId)).items.find((item) => item.id === link)).toMatchObject({ status: 'stale' });
    expect(h.state.products.some((candidate) => candidate.slug === 'teapot' || candidate.slug === 'kettle')).toBe(false);
  });

  it('applies nothing when the items differ from the list the owner was shown', async () => {
    const h = harness();
    const groupId = await h.group();
    const first = h.lastItemId(await h.add(groupId, 'product.update', { id: 'product-mug', title: 'Big mug' }));
    const shown = [first];
    const later = h.lastItemId(await h.add(groupId, 'stock.adjust', { productId: 'product-live', delta: 3, reason: 'Delivery' }));

    for (const itemIds of [shown, [later, first], [first, later, first], [first, 'unknown']]) {
      expect(await h.approve(groupId, itemIds)).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupItemIds: [first, later] } } });
    }
    expect(liveProduct(h, 'product-mug')?.title).toBe('Mug');
    expect(h.items(groupId).map((item) => item.status)).toEqual(['pending', 'pending']);
    expect(h.transaction.calls.filter((call) => call === 'run')).toEqual([]);
  });

  it('leaves the group pending and the live state unchanged when recording the outcome fails', async () => {
    const h = harness();
    const { groupId } = await launchChain(h);
    const live = structuredClone(h.state);
    const failing: ChangeProposalTransaction = {
      ...h.transaction,
      run: (tenantId, operation) => h.transaction.run(tenantId, (scope) => operation({
        ...scope,
        repositories: {
          ...scope.repositories,
          changeProposalGroups: { ...scope.repositories.changeProposalGroups, transition: () => Promise.reject(new Error('connection lost')) },
        },
      })),
    };

    await expect(approveChangeProposalGroup(ownerSession, { id: groupId, itemIds: h.items(groupId).map((item) => item.id) }, { ...h.deps, changeProposalTransaction: failing }))
      .rejects.toThrow('connection lost');

    expect(h.state).toEqual(live);
    expect(h.items(groupId).map((item) => item.status)).toEqual(['pending', 'pending', 'pending', 'pending', 'pending']);
  });

  it.each([
    appError('unavailable', 'The database is busy'),
    appError('internal', 'Lost the connection'),
    appError('forbidden', 'Not allowed for this session'),
  ])('rolls the whole group back and keeps every item pending when its sales link item returns $code', async (error) => {
    const h = harness();
    const { groupId, linked } = await launchChain(h);
    const live = structuredClone(h.state);
    const eventsBefore = h.store.eventRows.length;

    const approved = await approveChangeProposalGroup(
      ownerSession,
      { id: groupId, itemIds: h.items(groupId).map((item) => item.id) },
      { ...h.deps, changeProposalTransaction: failingSalesLinkSaves(h.transaction, error) },
    );

    expect(approved).toEqual({ ok: false, error });
    expect(h.state).toEqual(live);
    expect(h.items(groupId).map((item) => [item.status, item.failureCode])).toEqual(Array.from({ length: 5 }, () => ['pending', null]));
    expect(h.store.eventRows).toHaveLength(eventsBefore);
    expect(h.events(linked)).toEqual(['1:proposed']);
    expect(unwrap(await h.approve(groupId)).status).toBe('applied');
  });

  it('records a refusal of the sales link item as the group failure', async () => {
    const h = harness();
    const { groupId, linked } = await launchChain(h);

    const approved = unwrap(await approveChangeProposalGroup(
      ownerSession,
      { id: groupId, itemIds: h.items(groupId).map((item) => item.id) },
      { ...h.deps, changeProposalTransaction: failingSalesLinkSaves(h.transaction, appError('conflict', 'The slug is taken')) },
    ));

    expect(approved.status).toBe('failed');
    expect(approved.items.find((item) => item.id === linked)).toMatchObject({ status: 'failed', failureCode: 'conflict', failureMessage: 'The slug is taken' });
  });

  it('answers the transient error of an earlier item at submit instead of the earlier-item conflict', async () => {
    const h = harness();
    const { groupId } = await launchChain(h);
    const proposalsBefore = h.store.proposals.length;
    const failingDeps = { ...h.deps, changeProposalTransaction: failingSalesLinkSaves(h.transaction, appError('unavailable', 'The database is busy')) };

    expect(await submitGroupedChangeProposal(keyCtx(), { groupId, operation: 'stock.adjust', input: { productId: 'product-live', delta: 1, reason: 'Count' } }, failingDeps))
      .toEqual({ ok: false, error: appError('unavailable', 'The database is busy') });
    expect(h.store.proposals).toHaveLength(proposalsBefore);
  });

  it('answers busy and keeps the group pending when the transaction is busy', async () => {
    const h = harness();
    const { groupId } = await launchChain(h);
    const busy: ChangeProposalTransaction = {
      ...h.transaction,
      run: async () => ({ ok: false, error: { code: 'unavailable', message: 'busy', details: { retryAfterSeconds: 5 } } }),
    };

    expect(await approveChangeProposalGroup(ownerSession, { id: groupId, itemIds: h.items(groupId).map((item) => item.id) }, { ...h.deps, changeProposalTransaction: busy }))
      .toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(h.items(groupId).every((item) => item.status === 'pending')).toBe(true);
  });
});

describe('proposal references inside a group', () => {
  it.each<[string, (h: Harness, groupId: string, earlier: { product: string; price: string; otherGroupItem: string }) => [ChangeProposalOperation, unknown], RegExp]>([
    ['a forward reference', () => ['price.create', { productId: changeProposalReference('generated-999'), kind: 'one_time', amountCents: 1, currency: 'EUR' }], /names no earlier proposal/u],
    ['a wrong-kind reference', (_h, _groupId, earlier) => ['price.create', { productId: changeProposalReference(earlier.price), kind: 'one_time', amountCents: 1, currency: 'EUR' }], /does not create a product/u],
    ['a reference to another group\'s item', (_h, _groupId, earlier) => ['product.publish', { id: changeProposalReference(earlier.otherGroupItem) }], /names no earlier proposal/u],
    ['a reference outside an id position', (_h, _groupId, earlier) => ['product.update', { id: 'product-mug', title: changeProposalReference(earlier.product) }], /cannot hold a proposal reference/u],
    ['a reference nested outside an id position', (_h, _groupId, earlier) => ['sales-link.create', { slug: 'x', title: 'X', heading: 'X', productIds: ['product-live'], description: changeProposalReference(earlier.product) }], /cannot hold a proposal reference/u],
    ['a malformed reference', () => ['product.publish', { id: '$proposal:' }], /not a valid proposal reference/u],
    ['a reference-like string', () => ['product.update', { id: 'product-mug', title: '$proposals are fun' }], /cannot hold a proposal reference/u],
  ])('refuses %s with 400 and stores nothing', async (_label, build, message) => {
    const h = harness();
    const groupId = await h.group();
    const otherGroup = await h.group('Other');
    const otherGroupItem = h.lastItemId(await h.add(otherGroup, 'product.create', { title: 'Kettle', slug: 'kettle', type: 'physical', priceCents: 0 }));
    const productItem = h.lastItemId(await h.add(groupId, 'product.create', { title: 'Teapot', slug: 'teapot', type: 'physical', priceCents: 0 }));
    const priceItem = h.lastItemId(await h.add(groupId, 'price.create', { productId: changeProposalReference(productItem), kind: 'one_time', amountCents: 2500, currency: 'EUR' }));
    const stored = h.store.proposals.length;
    const [operation, input] = build(h, groupId, { product: productItem, price: priceItem, otherGroupItem });

    const result = await h.join(groupId, operation, input);

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.message).toMatch(message);
    expect(h.store.proposals).toHaveLength(stored);
  });

  it('never resolves a reference against a live id', async () => {
    const h = harness();
    const groupId = await h.group();

    expect(await h.join(groupId, 'product.publish', { id: changeProposalReference('product-mug') }))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('leaves single proposals as they were: a reference is just an unknown id there', async () => {
    const h = harness();

    expect(await submitChangeProposal(keyCtx(), { operation: 'product.publish', input: { id: changeProposalReference('generated-1') } }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    const single = unwrap(await submitChangeProposal(keyCtx(), { operation: 'product.update', input: { id: 'product-mug', title: 'Big mug' } }, h.deps));
    expect(single.groupId).toBeNull();
    expect(await approveChangeProposal(ownerSession, { id: single.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied', groupId: null, groupTitle: null } });
  });
});

describe('who reaches a group', () => {
  it.each<[string, Ctx]>([
    ['another key of the workspace', keyCtx(OTHER_KEY_ID)],
    ['a key of another workspace', keyCtx(NEIGHBOUR_KEY_ID, NEIGHBOUR)],
  ])('answers %s 404 on join, show and withdraw, as for an unknown id', async (_label, ctx) => {
    const h = harness();
    const groupId = await h.group();
    await h.add(groupId, 'product.update', { id: 'product-mug', title: 'Big mug' });

    const unknown = await h.join('group-unknown', 'product.update', { id: 'product-mug', title: 'Other' }, ctx);
    const joined = await h.join(groupId, 'product.update', { id: 'product-mug', title: 'Other' }, ctx);
    expect(joined).toMatchObject({ ok: false, error: { code: 'not_found' } });
    if (joined.ok || unknown.ok) throw new Error('expected refusals');
    expect(joined.error.message).toBe(unknown.error.message.replace('group-unknown', groupId));
    expect(await getOwnChangeProposalGroup(ctx, { id: groupId }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await withdrawOwnChangeProposalGroup(ctx, { id: groupId }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.items(groupId).map((item) => item.status)).toEqual(['pending']);
  });

  it('answers the owner of another workspace 404 on show, approve and reject', async () => {
    const h = harness();
    const groupId = await h.group();
    const item = h.lastItemId(await h.add(groupId, 'product.update', { id: 'product-mug', title: 'Big mug' }));

    expect(await getChangeProposalGroup(neighbourOwner, { id: groupId }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await approveChangeProposalGroup(neighbourOwner, { id: groupId, itemIds: [item] }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await rejectChangeProposalGroup(neighbourOwner, { id: groupId }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it.each<[string, Ctx]>([
    ['a propose-mode key', keyCtx()],
    ['an admin session', { identity: identity({ staffRole: 'admin', userId: 'user-admin' }) }],
    ['an owner with an unverified e-mail', { identity: identity({ emailVerified: false }) }],
  ])('refuses %s every owner decision', async (_label, ctx) => {
    const h = harness();
    const groupId = await h.group();
    const item = h.lastItemId(await h.add(groupId, 'product.update', { id: 'product-mug', title: 'Big mug' }));

    expect(await approveChangeProposalGroup(ctx, { id: groupId, itemIds: [item] }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await rejectChangeProposalGroup(ctx, { id: groupId }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await getChangeProposalGroup(ctx, { id: groupId }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.items(groupId).map((candidate) => candidate.status)).toEqual(['pending']);
  });
});

describe('other decisions on a group', () => {
  it('refuses to decide a grouped item on its own', async () => {
    const h = harness();
    const groupId = await h.group();
    const item = h.lastItemId(await h.add(groupId, 'product.update', { id: 'product-mug', title: 'Big mug' }));
    const refused = { ok: false, error: { code: 'conflict', details: { changeProposalGroupId: groupId } } };

    expect(await approveChangeProposal(ownerSession, { id: item }, h.deps)).toMatchObject(refused);
    expect(await rejectChangeProposal(ownerSession, { id: item }, h.deps)).toMatchObject(refused);
    expect(await withdrawOwnChangeProposal(keyCtx(), { id: item }, h.deps)).toMatchObject(refused);
    expect(h.events(item)).toEqual(['1:proposed']);
    expect(liveProduct(h, 'product-mug')?.title).toBe('Mug');
  });

  it('rejects every item of the group with the owner note, once', async () => {
    const h = harness();
    const { groupId } = await launchChain(h);

    const rejected = unwrap(await rejectChangeProposalGroup(ownerSession, { id: groupId, note: 'Not this season' }, h.deps));

    expect(rejected.status).toBe('rejected');
    expect(rejected.items.every((item) => item.status === 'rejected' && item.decisionNote === 'Not this season' && item.decidedByUserId === OWNER)).toBe(true);
    expect(rejected.items.map((item) => item.events.map((event) => event.kind))).toEqual(Array.from({ length: 5 }, () => ['proposed', 'rejected']));
    expect(await rejectChangeProposalGroup(ownerSession, { id: groupId }, h.deps)).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupStatus: 'rejected' } } });
    expect(await h.approve(groupId)).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('lets its key withdraw the whole group, after which nothing can join or be approved', async () => {
    const h = harness();
    const { groupId } = await launchChain(h);

    const withdrawn = unwrap(await withdrawOwnChangeProposalGroup(keyCtx(), { id: groupId }, h.deps));

    expect(withdrawn.status).toBe('withdrawn');
    expect(withdrawn.items.every((item) => item.status === 'withdrawn')).toBe(true);
    expect(await h.join(groupId, 'product.update', { id: 'product-mug', title: 'Late' })).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupStatus: 'withdrawn' } } });
    expect(await h.approve(groupId)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await withdrawOwnChangeProposalGroup(keyCtx(), { id: groupId }, h.deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('expires the whole group with its first item, records the expiry on every item and keeps later items on that expiry', async () => {
    const h = harness();
    const groupId = await h.group();
    const first = h.lastItemId(await h.add(groupId, 'product.update', { id: 'product-mug', title: 'Big mug' }));
    h.clock.now = '2026-03-20T10:00:00.000Z';
    const second = h.lastItemId(await h.add(groupId, 'stock.adjust', { productId: 'product-live', delta: 1, reason: 'Count' }));
    expect(h.items(groupId).map((item) => item.expiresAt)).toEqual([changeProposalExpiresAt(NOW), changeProposalExpiresAt(NOW)]);

    h.clock.now = changeProposalExpiresAt(NOW);
    expect(await h.join(groupId, 'product.update', { id: 'product-live', title: 'Late' })).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupStatus: 'expired' } } });
    expect(await h.approve(groupId, [first, second])).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupStatus: 'expired' } } });
    expect(h.events(first)).toEqual(['1:proposed', '2:expired']);
    expect(h.events(second)).toEqual(['1:proposed', '2:expired']);
    expect(liveProduct(h, 'product-mug')?.title).toBe('Mug');
    expect(unwrap(await getOwnChangeProposalGroup(keyCtx(), { id: groupId }, h.deps)).status).toBe('expired');
  });

  it('expires a group whose expiry passes while the approval waits for its locks', async () => {
    const h = harness();
    const groupId = await h.group();
    const item = h.lastItemId(await h.add(groupId, 'product.update', { id: 'product-mug', title: 'Big mug' }));
    const late: ChangeProposalTransaction = {
      ...h.transaction,
      run: (tenantId, operation) => h.transaction.run(tenantId, (scope) => operation({
        ...scope,
        repositories: {
          ...scope.repositories,
          changeProposalGroups: {
            ...scope.repositories.changeProposalGroups,
            lock: async (lockTenantId, id) => {
              const locked = await scope.repositories.changeProposalGroups.lock(lockTenantId, id);
              h.clock.now = changeProposalExpiresAt(NOW);
              return locked;
            },
          },
        },
      })),
    };

    expect(await approveChangeProposalGroup(ownerSession, { id: groupId, itemIds: [item] }, { ...h.deps, changeProposalTransaction: late }))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupStatus: 'expired' } } });
    expect(h.events(item)).toEqual(['1:proposed', '2:expired']);
    expect(liveProduct(h, 'product-mug')?.title).toBe('Mug');
  });

  it('caps the items of one group', async () => {
    const h = harness();
    const groupId = await h.group();
    for (let position = 1; position <= CHANGE_PROPOSAL_GROUP_LIMITS.itemsPerGroup; position += 1) {
      h.store.seed({
        id: `seeded-${String(position)}`, tenantId: TENANT, groupId, groupPosition: position, operation: 'stock.adjust',
        input: { productId: 'product-live', delta: 1, reason: 'Count' }, effect: { onHand: { delta: 1 } }, target: { kind: 'product', id: 'product-live' },
        status: 'pending', proposedByKeyId: KEY_ID, proposedByKeyName: 'Catalogue agent', proposedByIssuerUserId: ISSUER, createdAt: NOW,
        expiresAt: changeProposalExpiresAt(NOW), decidedByUserId: null, decidedAt: null, decisionNote: null, appliedResourceId: null,
        failureCode: null, failureMessage: null,
      });
    }

    expect(await h.join(groupId, 'product.update', { id: 'product-mug', title: 'Big mug' }))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'group_items' } } });
    expect(h.transaction.calls).toEqual([]);
  });
});

describe('reading groups', () => {
  it('gives the owner the group with its ordered items, effects and events, and lists items with their group', async () => {
    const h = harness();
    const { groupId, created, linked } = await launchChain(h);
    await submitChangeProposal(keyCtx(), { operation: 'product.update', input: { id: 'product-mug', title: 'Big mug' } }, h.deps);

    const view = unwrap(await getChangeProposalGroup(ownerSession, { id: groupId }, h.deps));

    expect(changeProposalGroupOwnerViewSchema.parse(view)).toEqual(view);
    expect(view).toMatchObject({
      id: groupId, title: 'Spring launch', status: 'open', createdAt: NOW, expiresAt: changeProposalExpiresAt(NOW),
      proposedBy: { keyId: KEY_ID, keyName: 'Catalogue agent', issuerUserId: ISSUER, keyState: 'active' },
    });
    expect(view.items.map((item) => [item.groupPosition, item.groupTitle, item.events.map((event) => event.kind)])).toEqual(
      [1, 2, 3, 4, 5].map((position) => [position, 'Spring launch', ['proposed']]),
    );
    expect(view.items[0]?.effect).toMatchObject({ title: { before: null, after: 'Teapot' } });

    const listed = unwrap(await listChangeProposals(ownerSession, {}, h.deps));
    expect(listed.proposals.map((item) => JSON.stringify([item.groupId, item.groupTitle, item.groupPosition])).toSorted()).toEqual([
      [null, null, null], ...[1, 2, 3, 4, 5].map((position) => [groupId, 'Spring launch', position]),
    ].map((row) => JSON.stringify(row)).toSorted());
    const filtered = unwrap(await listChangeProposals(ownerSession, { groupId }, h.deps));
    expect(filtered.proposals.map((item) => item.id).toSorted()).toEqual(h.items(groupId).map((item) => item.id).toSorted());
    expect(unwrap(await getChangeProposal(ownerSession, { id: linked }, h.deps))).toMatchObject({ groupId, groupTitle: 'Spring launch', groupPosition: 5 });
    expect(unwrap(await getChangeProposal(ownerSession, { id: created }, h.deps)).groupPosition).toBe(1);
  });
});

const reversingIds = (h: Harness) => {
  let count = 0;
  let descending = false;
  h.deps.ids.nextId = () => {
    count += 1;
    return descending ? `id-${String(9000 - count)}` : `id-${String(1000 + count)}`;
  };
  return { reverse: () => { descending = true; } };
};

describe('stable effects when the ids created at approval sort the other way', () => {
  it('applies a draft deletion of a product whose two prices the group created', async () => {
    const h = harness();
    const ids = reversingIds(h);
    const groupId = await h.group();
    const created = h.lastItemId(await h.add(groupId, 'product.create', { title: 'Teapot', slug: 'teapot', type: 'physical', priceCents: 0 }));
    const teapot = changeProposalReference(created);
    await h.add(groupId, 'price.create', { productId: teapot, kind: 'one_time', amountCents: 2500, currency: 'EUR' });
    await h.add(groupId, 'price.create', { productId: teapot, kind: 'one_time', amountCents: 3500, currency: 'EUR' });
    await h.add(groupId, 'product.delete-draft', { productId: teapot });
    ids.reverse();

    const approved = unwrap(await h.approve(groupId));

    expect(approved.items.map((item) => item.status)).toEqual(['applied', 'applied', 'applied', 'applied']);
    expect(h.state.products.some((candidate) => candidate.slug === 'teapot')).toBe(false);
  });

  it('applies a draft deletion of a product with one existing price and one the group created', async () => {
    const h = harness();
    h.state.prices.push(price({ id: 'id-5000', productId: 'product-draft', amountCents: 900 }));
    const ids = reversingIds(h);
    const groupId = await h.group();
    await h.add(groupId, 'price.create', { productId: 'product-draft', kind: 'one_time', amountCents: 2500, currency: 'EUR' });
    await h.add(groupId, 'product.delete-draft', { productId: 'product-draft' });
    ids.reverse();

    expect(unwrap(await h.approve(groupId)).status).toBe('applied');
    expect(liveProduct(h, 'product-draft')).toBeUndefined();
  });

  it('keeps the order of a sales link\'s products as given', async () => {
    const h = harness();
    const groupId = await h.group();
    const created = h.lastItemId(await h.add(groupId, 'product.create', { title: 'Teapot', slug: 'teapot', type: 'physical', priceCents: 0 }));
    await h.add(groupId, 'sales-link.create', { slug: 'offer', title: 'Offer', heading: 'Offer', productIds: ['product-live', changeProposalReference(created)] });

    expect(h.items(groupId)[1]?.effect).toMatchObject({ productIds: { before: null, after: ['product-live', changeProposalReference(created)] } });
  });
});

describe('group decisions read the clock after their locks', () => {
  const expiringWhileLocked = (h: Harness): ChangeProposalGroupRepository => ({
    ...h.store.groups,
    decide: (tenantId, id, guard, decide) => h.store.groups.decide(tenantId, id, guard, (locked) => {
      h.clock.now = changeProposalExpiresAt(NOW);
      return decide(locked);
    }),
    addItem: (tenantId, proposal, event, clock) => {
      h.clock.now = changeProposalExpiresAt(NOW);
      return h.store.groups.addItem(tenantId, proposal, event, clock);
    },
  });

  it('records the expiry on every item instead of rejecting a group that expired while the reject waited', async () => {
    const h = harness();
    const { groupId } = await launchChain(h);

    expect(await rejectChangeProposalGroup(ownerSession, { id: groupId, note: 'Late' }, { ...h.deps, changeProposalGroups: expiringWhileLocked(h) }))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupStatus: 'expired' } } });
    for (const item of h.items(groupId)) {
      expect(item.status).toBe('pending');
      expect(h.events(item.id)).toEqual(['1:proposed', '2:expired']);
    }
  });

  it('records the expiry on every item instead of withdrawing a group that expired while the withdrawal waited', async () => {
    const h = harness();
    const { groupId } = await launchChain(h);

    expect(await withdrawOwnChangeProposalGroup(keyCtx(), { id: groupId }, { ...h.deps, changeProposalGroups: expiringWhileLocked(h) }))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupStatus: 'expired' } } });
    for (const item of h.items(groupId)) expect(h.events(item.id)).toEqual(['1:proposed', '2:expired']);
  });

  it('answers the group conflict to a join whose group expired while it waited', async () => {
    const h = harness();
    const groupId = await h.group();
    await h.add(groupId, 'product.update', { id: 'product-mug', title: 'Big mug' });

    expect(await submitGroupedChangeProposal(keyCtx(), { groupId, operation: 'stock.adjust', input: { productId: 'product-live', delta: 1, reason: 'Count' } }, {
      ...h.deps, changeProposalGroups: expiringWhileLocked(h),
    })).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupStatus: 'expired' } } });
    expect(h.items(groupId)).toHaveLength(1);
  });

  it('records the expiry on every item when its key withdraws a group that is already expired', async () => {
    const h = harness();
    const { groupId } = await launchChain(h);
    h.clock.now = changeProposalExpiresAt(NOW);

    expect(await withdrawOwnChangeProposalGroup(keyCtx(), { id: groupId }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupStatus: 'expired' } } });
    for (const item of h.items(groupId)) {
      expect(item.status).toBe('pending');
      expect(h.events(item.id)).toEqual(['1:proposed', '2:expired']);
    }
  });

  it.each([
    ['reject', (h: Harness, groupId: string) => rejectChangeProposalGroup(ownerSession, { id: groupId }, { ...h.deps, changeProposalGroups: { ...h.store.groups, decide: async () => ({ kind: 'busy' }) } })],
    ['withdraw', (h: Harness, groupId: string) => withdrawOwnChangeProposalGroup(keyCtx(), { id: groupId }, { ...h.deps, changeProposalGroups: { ...h.store.groups, decide: async () => ({ kind: 'busy' }) } })],
  ] as const)('answers busy when the %s runs out of lock wait', async (_label, decide) => {
    const h = harness();
    const { groupId } = await launchChain(h);

    expect(await decide(h, groupId)).toMatchObject({ ok: false, error: { code: 'unavailable', details: { retryAfterSeconds: 5 } } });
    expect(h.items(groupId).every((item) => item.status === 'pending')).toBe(true);
  });
});

describe('the group dry run', () => {
  it('runs one dry run per group at a time', async () => {
    const h = harness();
    const groupId = await h.group();
    await h.add(groupId, 'product.update', { id: 'product-mug', title: 'Big mug' });

    expect(h.transaction.dryRunGroups).toEqual([groupId]);
  });

  it.each([
    ['withdrawn', async (h: Harness, groupId: string) => { unwrap(await withdrawOwnChangeProposalGroup(keyCtx(), { id: groupId }, h.deps)); }],
    ['rejected', async (h: Harness, groupId: string) => { unwrap(await rejectChangeProposalGroup(ownerSession, { id: groupId }, h.deps)); }],
    ['applied', async (h: Harness, groupId: string) => { unwrap(await h.approve(groupId)); }],
  ] as const)('answers the group status, not a stale earlier item, when the group was %s while the submit waited', async (status, decide) => {
    const h = harness();
    const groupId = await h.group();
    await h.add(groupId, 'product.update', { id: 'product-mug', title: 'Big mug' });
    const waiting: ChangeProposalTransaction = {
      ...h.transaction,
      dryRun: async (tenantId, operation, options) => {
        await decide(h, groupId);
        return h.transaction.dryRun(tenantId, operation, options);
      },
    };

    const joined = await submitGroupedChangeProposal(keyCtx(), { groupId, operation: 'stock.adjust', input: { productId: 'product-live', delta: 1, reason: 'Count' } }, {
      ...h.deps, changeProposalTransaction: waiting,
    });

    expect(joined).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupStatus: status } } });
    if (joined.ok) throw new Error('expected a conflict');
    expect(joined.error.details).not.toHaveProperty('changeProposalGroupItem');
    expect(h.items(groupId)).toHaveLength(1);
  });

  it('answers the group conflict when another item joined while the submit waited', async () => {
    const h = harness();
    const groupId = await h.group();
    await h.add(groupId, 'product.update', { id: 'product-mug', title: 'Big mug' });
    const waiting: ChangeProposalTransaction = {
      ...h.transaction,
      dryRun: async (tenantId, operation, options) => {
        unwrap(await h.join(groupId, 'stock.adjust', { productId: 'product-live', delta: 2, reason: 'Count' }));
        return h.transaction.dryRun(tenantId, operation, options);
      },
    };

    expect(await submitGroupedChangeProposal(keyCtx(), { groupId, operation: 'stock.adjust', input: { productId: 'product-live', delta: 1, reason: 'Count' } }, {
      ...h.deps, changeProposalTransaction: waiting,
    })).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalGroupStatus: 'open' } } });
    expect(h.items(groupId)).toHaveLength(2);
  });
});

const seedProposals = (h: Harness, count: number, fields: Partial<ChangeProposal>) => {
  for (let index = 0; index < count; index += 1) {
    h.store.seed({
      id: `seeded-${String(index)}`, tenantId: TENANT, groupId: null, groupPosition: null, operation: 'stock.adjust',
      input: { productId: 'product-live', delta: 1, reason: 'Count' }, effect: { onHand: { delta: 1 } }, target: { kind: 'product', id: 'product-live' },
      status: 'pending', proposedByKeyId: KEY_ID, proposedByKeyName: 'Catalogue agent', proposedByIssuerUserId: ISSUER, createdAt: NOW,
      expiresAt: changeProposalExpiresAt(NOW), decidedByUserId: null, decidedAt: null, decisionNote: null, appliedResourceId: null,
      failureCode: null, failureMessage: null, ...fields,
    });
  }
};

describe('the proposal limits on a group join', () => {
  it.each([
    ['key_pending', CHANGE_PROPOSAL_LIMITS.pendingPerKey, {}],
    ['key_daily', CHANGE_PROPOSAL_LIMITS.createdPerKeyPerWindow, { status: 'rejected' }],
    ['workspace_pending', CHANGE_PROPOSAL_LIMITS.pendingPerWorkspace, { proposedByKeyId: OTHER_KEY_ID }],
  ] as const)('refuses a join of a key at the %s limit and stores nothing', async (cap, count, fields) => {
    const h = harness();
    const groupId = await h.group();
    seedProposals(h, count, fields);

    expect(await h.join(groupId, 'product.update', { id: 'product-mug', title: 'Big mug' }))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: cap } } });
    expect(h.items(groupId)).toEqual([]);
    expect(h.transaction.calls).toEqual([]);
  });

  it('refuses at the repository a join that reached a limit after the pre-check', async () => {
    const h = harness();
    const groupId = await h.group();
    const filling: ChangeProposalTransaction = {
      ...h.transaction,
      dryRun: async (tenantId, operation, options) => {
        const result = await h.transaction.dryRun(tenantId, operation, options);
        seedProposals(h, CHANGE_PROPOSAL_LIMITS.pendingPerKey, {});
        return result;
      },
    };

    expect(await submitGroupedChangeProposal(keyCtx(), { groupId, operation: 'product.update', input: { id: 'product-mug', title: 'Big mug' } }, {
      ...h.deps, changeProposalTransaction: filling,
    })).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'key_pending' } } });
    expect(h.items(groupId)).toEqual([]);
  });
});

describe('sales links created earlier in the same group', () => {
  const linkFields = { slug: 'teapot-offer', title: 'Teapot', heading: 'Teapot offer', productIds: ['product-live'] };

  it('updates the link through its reference and applies both items', async () => {
    const h = harness();
    const groupId = await h.group();
    const created = h.lastItemId(await h.add(groupId, 'sales-link.create', linkFields));
    const reference = changeProposalReference(created);
    await h.add(groupId, 'sales-link.update', { ...linkFields, id: reference, title: 'Renamed offer', expectedRevision: 1 });

    const stored = h.items(groupId);
    expect(stored[1]?.target).toEqual({ kind: 'sales-link', id: reference });
    expect(stored[1]?.effect).toMatchObject({ title: { before: 'Teapot', after: 'Renamed offer' } });
    expect(unwrap(await h.approve(groupId)).status).toBe('applied');
    expect(h.state.salesLinks.find((link) => link.slug === 'teapot-offer')).toMatchObject({ title: 'Renamed offer', deleted: false });
  });

  it('deletes the link through its reference and leaves no link behind', async () => {
    const h = harness();
    const groupId = await h.group();
    const created = h.lastItemId(await h.add(groupId, 'sales-link.create', linkFields));
    await h.add(groupId, 'sales-link.delete', { id: changeProposalReference(created) });

    expect(h.items(groupId)[1]?.effect).toMatchObject({ exists: { before: true, after: false } });
    expect(unwrap(await h.approve(groupId)).status).toBe('applied');
    expect(h.state.salesLinks.filter((link) => link.slug === 'teapot-offer' && !link.deleted)).toEqual([]);
  });

  it('deactivates a price through its reference', async () => {
    const h = harness();
    const groupId = await h.group();
    const created = h.lastItemId(await h.add(groupId, 'price.create', { productId: 'product-mug', kind: 'one_time', amountCents: 2500, currency: 'EUR' }));
    await h.add(groupId, 'price.deactivate', { id: changeProposalReference(created) });

    expect(h.items(groupId)[1]?.effect).toEqual({ active: { before: true, after: false } });
    const approved = unwrap(await h.approve(groupId));
    expect(approved.status).toBe('applied');
    expect(h.state.prices.find((candidate) => candidate.id === approved.items[0]?.appliedResourceId)).toMatchObject({ amountCents: 2500, active: false });
  });
});

describe('the owner notification of a group', () => {
  it('raises one notification for the group when its first item joins and signals every owner for every item', async () => {
    const h = harness();
    const { groupId } = await launchChain(h);

    expect(h.notifications.rows.map(({ recipientUserId, kind, sourceKey, payload }) => ({ recipientUserId, kind, sourceKey, changeProposal: payload.changeProposal }))).toEqual([
      { recipientUserId: ISSUER, kind: 'change-proposal', sourceKey: `change-proposal:${KEY_ID}`, changeProposal: { keyName: 'Catalogue agent', groupId, groupTitle: 'Spring launch' } },
      { recipientUserId: OWNER, kind: 'change-proposal', sourceKey: `change-proposal:${KEY_ID}`, changeProposal: { keyName: 'Catalogue agent', groupId, groupTitle: 'Spring launch' } },
    ]);
    const rowIds = new Map(h.notifications.rows.map((row) => [row.recipientUserId, row.id]));
    expect(h.notifications.published).toHaveLength(10);
    expect(h.notifications.published.every((event) => event.kind === 'notification'
      && event.notificationKind === 'change-proposal' && event.notificationId === rowIds.get(event.recipientUserId))).toBe(true);

    expect(h.notifications.rows.every((row) => row.payload.authorDisplay === null && row.payload.snippet === '' && row.payload.contextId === null)).toBe(true);
    for (const row of h.notifications.rows) row.readAt = NOW;
    await h.add(groupId, 'stock.adjust', { productId: 'product-live', delta: 1, reason: 'Count' });
    expect(h.notifications.rows.every((row) => row.readAt === NOW)).toBe(true);
    expect(h.notifications.published).toHaveLength(12);
    expect(h.notifications.published.slice(-2).map((event) => [event.recipientUserId, event.kind === 'notification' ? event.notificationId : null]))
      .toEqual([[ISSUER, rowIds.get(ISSUER)], [OWNER, rowIds.get(OWNER)]]);

    expect((await submitChangeProposal(keyCtx(), { operation: 'product.update', input: { id: 'product-mug', title: 'Big mug' } }, h.deps)).ok).toBe(true);
    expect(h.notifications.rows.map((row) => [row.readAt, row.payload.changeProposal?.groupId])).toEqual([[null, null], [null, null]]);
    expect(h.notifications.published).toHaveLength(14);
  });

  it('keeps one notification per key, so a second key adds its own', async () => {
    const h = harness();
    await h.add(await h.group(), 'product.update', { id: 'product-mug', title: 'Big mug' });
    expect((await submitChangeProposal(keyCtx(OTHER_KEY_ID), { operation: 'stock.adjust', input: { productId: 'product-live', delta: 1, reason: 'Count' } }, h.deps)).ok).toBe(true);
    expect(h.notifications.rows.map((row) => [row.recipientUserId, row.sourceKey, row.payload.changeProposal?.keyName])).toEqual([
      [ISSUER, `change-proposal:${KEY_ID}`, 'Catalogue agent'],
      [OWNER, `change-proposal:${KEY_ID}`, 'Catalogue agent'],
      [ISSUER, `change-proposal:${OTHER_KEY_ID}`, 'Second agent'],
      [OWNER, `change-proposal:${OTHER_KEY_ID}`, 'Second agent'],
    ]);
  });
});
