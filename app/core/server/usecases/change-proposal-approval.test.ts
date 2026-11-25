import { describe, expect, it, vi } from 'vitest';

import {
  appError,
  capabilitiesForApiKey,
  changeProposalExpiresAt,
  changeProposalOwnerViewSchema,
  ok,
  type ChangeProposal,
  type ChangeProposalOperation,
  type Identity,
  type Product,
  type ProductDownloadAsset,
  type ProductPrice,
  type SalesLink,
  type ShopManagementKey,
  type ShopManagementScope,
  type TenantSettings,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { ChangeProposalTransaction, StorageProvider } from '../ports.js';
import {
  createChangeProposalStoreFake,
  changeProposalOwnerViewFakes,
  createChangeProposalTransactionFake,
  createQuarantinedImagesFake,
  createUnreadNotificationsFake,
  fakeContentHash,
  emptyCatalogState,
  failingSalesLinkSaves,
  type FakeCatalogState,
  type FakeChangeProposalStore,
  type FakeChangeProposalTransaction,
} from '../testing/change-proposal-fakes.js';
import {
  approveChangeProposal,
  rejectChangeProposal,
  submitChangeProposal,
  withdrawOwnChangeProposal,
  type ChangeProposalApprovalDeps,
  type ChangeProposalSubmitDeps,
} from './change-proposals.js';
import { publishProduct } from './products.js';
import { shopManagementKeyCapabilities } from './shop-machine-auth.js';

const TENANT = 'tenant-acme';
const NEIGHBOUR = 'tenant-studio';
const OWNER = 'user-owner';
const ISSUER = 'user-issuer';
const NOW = '2026-03-01T10:00:00.000Z';
const KEY_ID = 'key-propose';
const SCOPES: ShopManagementScope[] = ['shop:catalog:read', 'shop:catalog:write', 'shop:settings:read', 'shop:settings:write'];

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  userId: OWNER, email: 'owner@example.test', name: 'Owner', emailVerified: true, tenantAccess: 'staff',
  tenantId: TENANT, tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  ...overrides,
});

const ownerSession: Ctx = { identity: identity() };

const keyCtx = (mode: ShopManagementKey['mode'] = 'propose'): Ctx => ({
  identity: identity({ userId: ISSUER, email: 'issuer@example.test' }),
  capabilities: shopManagementKeyCapabilities({ scopes: SCOPES, mode }),
  machineActor: { kind: 'shop_management_key', apiKeyId: KEY_ID, mode },
});

const shopKey = (overrides: Partial<ShopManagementKey> = {}): ShopManagementKey => ({
  id: KEY_ID, tenantId: TENANT, name: 'Catalogue agent', keyHash: 'hash', scopes: SCOPES, mode: 'propose',
  issuedByUserId: ISSUER, createdAt: '2026-02-25T00:00:00.000Z', expiresAt: '2026-03-20T00:00:00.000Z', revokedAt: null,
  ...overrides,
});

const impersonation = {
  id: 'imp-1', actorUserId: OWNER, actorEmail: 'owner@example.test', actorName: 'Owner', actorStaffRole: 'owner' as const,
  subjectMemberId: 'member-1', subjectName: 'Member', expiresAt: '2026-03-01T11:00:00.000Z',
};

const privilegeConfusion: ReadonlyArray<readonly [string, Ctx]> = [
  ['an admin session', { identity: identity({ staffRole: 'admin', userId: 'user-admin' }) }],
  ['an owner viewing as a member', {
    identity: identity({ staffRole: null, memberId: 'member-1', tenantAccess: 'member', userId: 'user-member' }),
    impersonation,
  }],
  ['an owner session carrying an impersonation', { identity: identity(), impersonation }],
  ['an owner with an unverified e-mail', { identity: identity({ emailVerified: false }) }],
  ['a direct-mode key ctx', keyCtx('direct')],
  ['a propose-mode key ctx', keyCtx()],
  ['a legacy tenant API key ctx', {
    identity: identity({ userId: 'api-key', email: 'api-key@together.invalid', staffRole: null, tenantAccess: 'none' }),
    capabilities: capabilitiesForApiKey({ scopes: null }),
  }],
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

const downloadAsset: ProductDownloadAsset = {
  id: 'asset-1', tenantId: TENANT, lineageId: 'lineage-1', versionNumber: 1, versionNote: null, supersededAt: null,
  replacesAssetId: null, productId: 'product-draft', fileName: 'guide.pdf', contentType: 'application/pdf', sizeBytes: 10,
  storageKey: 'downloads/guide.pdf', status: 'ready', createdAt: '2026-01-01T00:00:00.000Z',
};

const salesLink = (overrides: Partial<SalesLink> = {}): SalesLink & { deleted: boolean } => ({
  id: 'link-spring', tenantId: TENANT, slug: 'spring', title: 'Spring', heading: 'Spring sale', description: '',
  productIds: ['product-live'], active: false, listed: false, validFrom: null, validTo: null, cancelReturnUrl: null,
  revision: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deleted: false, ...overrides,
});

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
    list: refuse, getObject: refuse, putObject: refuse, probe: refuse, copyObject: refuse, digestObject: refuse, probeCors: refuse, presignPut: refuse,
    presignGet: refuse, head: refuse, healthcheck: refuse, test: refuse,
  };
};

type HarnessDeps = ChangeProposalApprovalDeps & Omit<ChangeProposalSubmitDeps, 'changeProposals'>;

interface Harness {
  state: FakeCatalogState;
  store: FakeChangeProposalStore;
  transaction: FakeChangeProposalTransaction;
  deps: HarnessDeps;
  deletes: string[];
  clock: { now: string };
  submit(operation: ChangeProposalOperation, input: unknown): Promise<string>;
  approve(id: string, ctx?: Ctx): ReturnType<typeof approveChangeProposal>;
  proposal(id: string): ChangeProposal | undefined;
  events(id: string): string[];
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
  state.prices.push(price(), price({ id: 'price-live', productId: 'product-live' }));
  state.stock.push({ tenantId: TENANT, productId: 'product-live', onHand: 12, reserved: 0, lowStockThreshold: 2, lowStockNotifiedAt: null, updatedAt: NOW });
  state.downloadAssets.push(downloadAsset);
  state.salesLinks.push(salesLink());
  state.settings.push({ tenantId: TENANT, settings: structuredClone(shopSettings) });
  const store = createChangeProposalStoreFake(keys);
  const transaction = createChangeProposalTransactionFake(state, store, storageSecrets);
  const deletes: string[] = [];
  const accounts = [
    { userId: ISSUER, email: 'issuer@example.test', ownerOf: [TENANT] },
    { userId: OWNER, email: 'owner@example.test', ownerOf: [TENANT] },
  ];
  const notificationFakes = createUnreadNotificationsFake(accounts);
  let sequence = 0;
  const clock = { now: NOW };
  const deps: HarnessDeps = {
    changeProposalTransaction: transaction,
    changeProposals: store.repository,
    changeProposalGroups: store.groups,
    shopManagementKeys: { listByTenant: async (tenantId) => keys.filter((key) => key.tenantId === tenantId) },
    ...notificationFakes,
    ...changeProposalOwnerViewFakes(state, accounts),
    storage: recordingStorage(deletes),
    quarantinedImages: createQuarantinedImagesFake(state, store).repository,
    secretResolver: storageSecrets,
    contentHash: fakeContentHash,
    logger: { error: vi.fn<(message: string) => void>() },
    ids: { nextId: () => `generated-${String(++sequence)}` },
    clock: { nowIso: () => clock.now },
  };
  return {
    state,
    store,
    transaction,
    deps,
    deletes,
    clock,
    submit: async (operation, input) => {
      const submitted = await submitChangeProposal(keyCtx(), { operation, input }, { ...deps, changeProposals: store.repository });
      if (!submitted.ok) throw new Error(`${operation}: ${submitted.error.message}`);
      return submitted.value.id;
    },
    approve: (id, ctx = ownerSession) => approveChangeProposal(ctx, { id }, deps),
    proposal: (id) => store.proposals.find((candidate) => candidate.id === id),
    events: (id) => store.eventRows.filter((event) => event.proposalId === id).map(({ sequence: position, kind }) => `${String(position)}:${kind}`),
  };
};

const liveProduct = (h: Harness, id: string) => h.state.products.find((candidate) => candidate.id === id);

const storedProposal = (fields: Pick<ChangeProposal, 'id' | 'operation' | 'input' | 'effect' | 'target'>): ChangeProposal => {
  const createdAt = '2026-02-28T10:00:00.000Z';
  return {
    ...fields, tenantId: TENANT, groupId: null, groupPosition: null, status: 'pending', proposedByKeyId: KEY_ID,
    proposedByKeyName: 'Catalogue agent', proposedByIssuerUserId: ISSUER, createdAt, expiresAt: changeProposalExpiresAt(createdAt),
    decidedByUserId: null, decidedAt: null, decisionNote: null, appliedResourceId: null, failureCode: null, failureMessage: null,
  };
};

const countingSavepoints = (h: Harness): { transaction: ChangeProposalTransaction; count(): number } => {
  let count = 0;
  return {
    transaction: {
      ...h.transaction,
      run: (tenantId, operation) => h.transaction.run(tenantId, (scope) => operation({
        ...scope,
        savepoint: (nested) => {
          count += 1;
          return scope.savepoint(nested);
        },
      })),
    },
    count: () => count,
  };
};

const advancingDuringTargetLock = (h: Harness, to: string): ChangeProposalTransaction => ({
  ...h.transaction,
  run: (tenantId, operation) => h.transaction.run(tenantId, (scope) => operation({
    ...scope,
    repositories: {
      ...scope.repositories,
      targets: {
        ...scope.repositories.targets,
        lock: async (lockTenantId, target, purpose) => {
          const locked = await scope.repositories.targets.lock(lockTenantId, target, purpose);
          h.clock.now = to;
          return locked;
        },
      },
    },
  })),
});

describe('approveChangeProposal applies exactly what the owner saw', () => {
  it('applies a product update as the approving owner, once', async () => {
    const h = harness();
    const id = await h.submit('product.update', { id: 'product-mug', title: 'Big mug' });

    const approved = await h.approve(id);

    if (!approved.ok) throw new Error(approved.error.message);
    expect(changeProposalOwnerViewSchema.parse(approved.value)).toEqual(approved.value);
    expect(approved.value).toMatchObject({
      status: 'applied', decidedByUserId: OWNER, decidedAt: NOW, appliedResourceId: 'product-mug', failureCode: null,
      proposedBy: { keyId: KEY_ID, issuerUserId: ISSUER, keyState: 'active' },
    });
    expect(liveProduct(h, 'product-mug')?.title).toBe('Big mug');
    expect(h.state.entityVersionAuthors).toEqual([OWNER]);
    expect(h.events(id)).toEqual(['1:proposed', '2:applied']);
    expect(h.store.eventRows.at(-1)).toMatchObject({ actorUserId: OWNER, apiKeyId: null });
    expect(h.transaction.calls).toEqual(['dryRun', 'run']);

    expect(await h.approve(id)).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'applied' } } });
    expect(h.state.entityVersionAuthors).toEqual([OWNER]);
    expect(h.events(id)).toEqual(['1:proposed', '2:applied']);
  });

  it('applies when another field of the same product changed after the proposal', async () => {
    const h = harness();
    const id = await h.submit('product.update', { id: 'product-mug', title: 'Big mug' });
    Object.assign(liveProduct(h, 'product-mug') ?? {}, { description: 'Edited by the owner meanwhile' });

    expect(await h.approve(id)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(liveProduct(h, 'product-mug')).toMatchObject({ title: 'Big mug', description: 'Edited by the owner meanwhile' });
  });

  it('marks a product update stale when the field it changes moved, and leaves live state alone', async () => {
    const h = harness();
    const id = await h.submit('product.update', { id: 'product-mug', title: 'Big mug' });
    Object.assign(liveProduct(h, 'product-mug') ?? {}, { title: 'Owner title' });
    const before = structuredClone(h.state);

    expect(await h.approve(id)).toMatchObject({ ok: true, value: { status: 'stale', decidedByUserId: OWNER, appliedResourceId: null } });
    expect(h.state).toEqual(before);
    expect(h.events(id)).toEqual(['1:proposed', '2:stale']);
  });

  it('applies a stock adjustment as a delta on the moved balance', async () => {
    const h = harness();
    const id = await h.submit('stock.adjust', { productId: 'product-live', delta: 50, reason: 'Delivery' });
    const level = h.state.stock.find((candidate) => candidate.productId === 'product-live');
    if (level === undefined) throw new Error('stock level missing');
    level.onHand = 9;

    expect(await h.approve(id)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: 'product-live' } });
    expect(h.state.stock.find((candidate) => candidate.productId === 'product-live')?.onHand).toBe(59);
  });

  it('marks a stock adjustment stale only when tracking was disabled', async () => {
    const h = harness();
    const id = await h.submit('stock.adjust', { productId: 'product-live', delta: 50, reason: 'Delivery' });
    h.state.stock = [];

    expect(await h.approve(id)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(h.state.stock).toEqual([]);
  });

  it('records the live error when the operation is no longer valid', async () => {
    const h = harness();
    const id = await h.submit('product.publish', { id: 'product-mug' });
    h.state.prices = h.state.prices.map((candidate) => candidate.id === 'price-mug' ? { ...candidate, active: false } : candidate);
    const live = await h.transaction.dryRun(TENANT, ({ repositories }) => publishProduct(ownerSession, { id: 'product-mug' }, repositories));
    if (live.ok) throw new Error('publishing without an active price must fail');

    const approved = await h.approve(id);

    expect(approved).toMatchObject({
      ok: true,
      value: { status: 'failed', failureCode: live.error.code, failureMessage: live.error.message, appliedResourceId: null },
    });
    expect(liveProduct(h, 'product-mug')?.published).toBe(false);
    expect(h.events(id)).toEqual(['1:proposed', '2:apply_failed']);
  });

  it('marks a proposal stale without running the live use-case when its stored input carries a retired field', async () => {
    const h = harness();
    const savepoints = countingSavepoints(h);
    h.store.seed(storedProposal({
      id: 'proposal-old-shape', operation: 'product.update',
      input: { id: 'product-mug', title: 'Big mug', retiredField: true }, effect: { title: { before: 'Mug', after: 'Big mug' } },
      target: { kind: 'product', id: 'product-mug' },
    }));
    const before = structuredClone(h.state);

    expect(await approveChangeProposal(ownerSession, { id: 'proposal-old-shape' }, { ...h.deps, changeProposalTransaction: savepoints.transaction }))
      .toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(savepoints.count()).toBe(0);
    expect(h.state).toEqual(before);
    expect(h.events('proposal-old-shape')).toEqual(['1:stale']);
  });

  it('marks a proposal stale when an unknown key sits deeper in its stored input', async () => {
    const h = harness();
    const savepoints = countingSavepoints(h);
    h.store.seed(storedProposal({
      id: 'proposal-nested', operation: 'settings.update',
      input: { socialLinks: [{ label: 'Blog', url: 'https://blog.example.test', icon: 'rss' }] },
      effect: { socialLinks: { before: [], after: [{ label: 'Blog', url: 'https://blog.example.test' }] } },
      target: { kind: 'settings', id: null },
    }));

    expect(await approveChangeProposal(ownerSession, { id: 'proposal-nested' }, { ...h.deps, changeProposalTransaction: savepoints.transaction }))
      .toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(savepoints.count()).toBe(0);
    expect(h.state.settings[0]?.settings.socialLinks).toEqual([]);
  });

  it.each<[string, string | string[]]>([
    ['checkoutReturnOrigins', ['https://shop.example.test']],
    ['defaultHomeSpaceId', 'space-1'],
  ])('refuses a settings change carrying %s, which a key may not write, at submit and at approval', async (field, value) => {
    const h = harness();
    const input = { name: 'Acme shop', [field]: value };
    const submitted = await submitChangeProposal(keyCtx(), { operation: 'settings.update', input }, { ...h.deps, changeProposals: h.store.repository });
    expect(submitted).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.transaction.calls).toEqual([]);
    expect(h.store.proposals).toEqual([]);

    const savepoints = countingSavepoints(h);
    h.store.seed(storedProposal({
      id: 'proposal-settings-field', operation: 'settings.update', input,
      effect: { name: { before: 'Acme', after: 'Acme shop' } }, target: { kind: 'settings', id: null },
    }));
    const before = structuredClone(h.state);
    expect(await approveChangeProposal(ownerSession, { id: 'proposal-settings-field' }, { ...h.deps, changeProposalTransaction: savepoints.transaction }))
      .toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(savepoints.count()).toBe(0);
    expect(h.state).toEqual(before);
  });

  it('marks a proposal of an operation this release does not know stale, says why, and applies nothing', async () => {
    const h = harness();
    const savepoints = countingSavepoints(h);
    h.store.seed(storedProposal({
      id: 'proposal-later', operation: 'image.attach-cover', input: { productId: 'product-mug', imageId: 'image-1' },
      effect: { coverUrl: { before: null, after: 'https://cdn.example.test/cover.png' } }, target: { kind: 'product', id: 'product-mug' },
    }));
    const before = structuredClone(h.state);

    const approved = await approveChangeProposal(ownerSession, { id: 'proposal-later' }, { ...h.deps, changeProposalTransaction: savepoints.transaction });

    expect(approved).toMatchObject({ ok: true, value: { status: 'stale', operation: 'image.attach-cover', appliedResourceId: null } });
    expect(savepoints.count()).toBe(0);
    expect(h.state).toEqual(before);
    expect(h.transaction.locks).toEqual([]);
    expect(h.store.eventRows.at(-1)).toMatchObject({
      kind: 'stale', note: 'This release does not know the operation "image.attach-cover", so the proposal cannot be applied; nothing was changed',
    });
  });

  it('applies a product creation and records the new product as the applied resource', async () => {
    const h = harness();
    const id = await h.submit('product.create', { title: 'Teapot', slug: 'teapot', type: 'physical', priceCents: 0 });

    const approved = await h.approve(id);

    if (!approved.ok) throw new Error(approved.error.message);
    const created = h.state.products.find((candidate) => candidate.slug === 'teapot');
    expect(created).toBeDefined();
    expect(approved.value).toMatchObject({ status: 'applied', appliedResourceId: created?.id });
  });

  it('applies a gallery-less product creation or draft deletion stored by a release without the gallery', async () => {
    const h = harness();
    const createId = await h.submit('product.create', { title: 'Teapot', slug: 'teapot', type: 'physical', priceCents: 0 });
    const deleteId = await h.submit('product.delete-draft', { productId: 'product-draft' });
    for (const id of [createId, deleteId]) {
      const stored = h.proposal(id);
      if (stored === undefined) throw new Error('proposal missing');
      expect(Object.keys(stored.input)).not.toContain('images');
      expect(Object.keys(stored.effect)).not.toContain('images');
      h.store.seed(storedProposal({ ...stored, id: `${id}-before-gallery` }));
    }

    const created = await h.approve(`${createId}-before-gallery`);
    if (!created.ok) throw new Error(created.error.message);
    expect(created.value).toMatchObject({ status: 'applied' });
    expect(Object.keys(created.value.effect)).not.toContain('images');
    expect(h.state.products.find((candidate) => candidate.slug === 'teapot')?.images).toEqual([]);
    expect(await h.approve(`${deleteId}-before-gallery`)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(liveProduct(h, 'product-draft')).toBeUndefined();
  });

  it('applies a product update that reorders the gallery, and marks it stale when the gallery moved after submission', async () => {
    const front = { url: '/api/public/assets/product-image/front.png', alt: 'Front' };
    const back = { url: '/api/public/assets/product-image/back.png', alt: 'Back' };
    const h = harness();
    Object.assign(liveProduct(h, 'product-mug') ?? {}, { images: [front, back] });
    const reordered = await h.submit('product.update', { id: 'product-mug', images: [back, front] });
    expect(h.proposal(reordered)?.effect).toEqual({ images: { before: [front, back], after: [back, front] } });

    expect(await h.approve(reordered)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(liveProduct(h, 'product-mug')?.images).toEqual([back, front]);

    const added = await submitChangeProposal(keyCtx(), {
      operation: 'product.update',
      input: { id: 'product-mug', images: [back, front, { url: 'https://cdn.example.test/new.jpg', alt: '' }] },
    }, { ...h.deps, changeProposals: h.store.repository });
    expect(added).toMatchObject({ ok: false, error: { code: 'validation', details: { fieldErrors: { images: [expect.stringContaining('cannot be proposed yet')] } } } });

    const cleared = await h.submit('product.update', { id: 'product-mug', images: [] });
    Object.assign(liveProduct(h, 'product-mug') ?? {}, { images: [front] });
    const before = structuredClone(h.state);
    expect(await h.approve(cleared)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(h.state).toEqual(before);
  });

  it('keeps the proposal pending and live state untouched when the infrastructure throws', async () => {
    const h = harness();
    const id = await h.submit('product.update', { id: 'product-mug', title: 'Big mug' });
    const before = structuredClone(h.state);
    const real = h.transaction;
    const failing: ChangeProposalTransaction = {
      ...real,
      run: (tenantId, operation) => real.run(tenantId, (scope) => operation({
        ...scope,
        repositories: {
          ...scope.repositories,
          changeProposals: { ...scope.repositories.changeProposals, transition: () => Promise.reject(new Error('connection lost')) },
        },
      })),
    };

    await expect(approveChangeProposal(ownerSession, { id }, { ...h.deps, changeProposalTransaction: failing })).rejects.toThrow('connection lost');

    expect(h.state).toEqual(before);
    expect(h.proposal(id)?.status).toBe('pending');
    expect(h.events(id)).toEqual(['1:proposed']);
  });
});

describe('product proposals stored by this release and read by the release without the gallery', () => {
  const PREVIOUS_RELEASE_PRODUCT_CREATE_INPUT_KEYS = [
    'vatRate', 'vatExemptionBasis', 'type', 'visibility', 'salesChannel', 'deliveryMethod', 'parcelTemplate', 'compliance',
    'personalization', 'variantGroup', 'variantLabel', 'slug', 'title', 'description', 'coverUrl', 'priceCents', 'currency',
    'accessItems',
  ];
  const PREVIOUS_RELEASE_PRODUCT_UPDATE_INPUT_KEYS = [
    'vatRate', 'vatExemptionBasis', 'visibility', 'salesChannel', 'deliveryMethod', 'parcelTemplate', 'compliance',
    'personalization', 'variantGroup', 'variantLabel', 'id', 'title', 'description', 'coverUrl',
  ];
  const PREVIOUS_RELEASE_PRODUCT_EFFECT_KEYS = [
    'exists', 'type', 'slug', 'title', 'description', 'coverUrl', 'priceCents', 'currency', 'published', 'visibility',
    'salesChannel', 'deliveryMethod', 'parcelTemplate', 'compliance', 'personalization', 'variantGroup', 'variantLabel',
    'vatRate', 'vatExemptionBasis', 'accessItems', 'activePrices', 'prices', 'downloads', 'stock',
  ];
  const gallery = [{ url: '/api/public/assets/product-image/00000000-0000-4000-8000-000000000001.webp', alt: 'Front' }];

  const unknownKeys = (stored: object, known: readonly string[]): string[] =>
    Object.keys(stored).filter((key) => !known.includes(key)).sort();

  const stored = (h: Harness, id: string): ChangeProposal => {
    const proposal = h.proposal(id);
    if (proposal === undefined) throw new Error('proposal missing');
    return proposal;
  };

  it('stores a product creation without gallery images with input and effect keys the previous release knows', async () => {
    const h = harness();
    const coverUrl = '/api/public/assets/product-cover/00000000-0000-4000-8000-000000000009.png';
    Object.assign(liveProduct(h, 'product-mug') ?? {}, { coverUrl });
    const proposal = stored(h, await h.submit('product.create', {
      title: 'Teapot', slug: 'teapot', type: 'physical', priceCents: 0, vatRate: 23, coverUrl,
    }));

    expect(Object.keys(proposal.effect)).toContain('coverUrl');
    expect(unknownKeys(proposal.input, PREVIOUS_RELEASE_PRODUCT_CREATE_INPUT_KEYS)).toEqual([]);
    expect(unknownKeys(proposal.effect, PREVIOUS_RELEASE_PRODUCT_EFFECT_KEYS)).toEqual([]);
  });

  it('stores a product update that omits the gallery with keys the previous release knows, whether or not the product has a gallery', async () => {
    const h = harness();
    Object.assign(liveProduct(h, 'product-draft') ?? {}, { images: gallery });
    for (const productId of ['product-mug', 'product-draft']) {
      const proposal = stored(h, await h.submit('product.update', { id: productId, title: 'Renamed', description: 'New text' }));

      expect(proposal.effect).toEqual({
        title: { before: liveProduct(h, productId)?.title, after: 'Renamed' },
        description: { before: '', after: 'New text' },
      });
      expect(unknownKeys(proposal.input, PREVIOUS_RELEASE_PRODUCT_UPDATE_INPUT_KEYS)).toEqual([]);
    }
  });

  it('stores a draft deletion of a product without gallery images with effect keys the previous release knows', async () => {
    const h = harness();
    const proposal = stored(h, await h.submit('product.delete-draft', { productId: 'product-draft' }));

    expect(Object.keys(proposal.effect)).toContain('downloads');
    expect(unknownKeys(proposal.effect, PREVIOUS_RELEASE_PRODUCT_EFFECT_KEYS)).toEqual([]);
  });

  it('stores the gallery key the previous release refuses only when a proposal sends images or deletes a product that has them', async () => {
    const h = harness();
    const back = { url: '/api/public/assets/product-image/00000000-0000-4000-8000-000000000002.webp', alt: 'Back' };
    Object.assign(liveProduct(h, 'product-draft') ?? {}, { images: gallery });
    Object.assign(liveProduct(h, 'product-mug') ?? {}, { images: [...gallery, back] });
    const created = stored(h, await h.submit('product.create', { title: 'Teapot', slug: 'teapot', priceCents: 0, images: [] }));
    const updated = stored(h, await h.submit('product.update', { id: 'product-mug', images: [back, ...gallery] }));
    const deleted = stored(h, await h.submit('product.delete-draft', { productId: 'product-draft' }));

    expect(unknownKeys(created.input, PREVIOUS_RELEASE_PRODUCT_CREATE_INPUT_KEYS)).toEqual(['images']);
    expect(unknownKeys(updated.input, PREVIOUS_RELEASE_PRODUCT_UPDATE_INPUT_KEYS)).toEqual(['images']);
    expect(unknownKeys(deleted.effect, PREVIOUS_RELEASE_PRODUCT_EFFECT_KEYS)).toEqual(['images']);
  });
});

describe('approveChangeProposal post-commit effects', () => {
  it('deletes the stored files of an applied draft deletion after the commit', async () => {
    const h = harness();
    const id = await h.submit('product.delete-draft', { productId: 'product-draft' });
    expect(h.deletes).toEqual([]);

    expect(await h.approve(id)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: 'product-draft' } });
    expect(h.deletes).toHaveLength(1);
    expect(liveProduct(h, 'product-draft')).toBeUndefined();
  });

  it('deletes nothing for a stale draft deletion', async () => {
    const h = harness();
    const id = await h.submit('product.delete-draft', { productId: 'product-draft' });
    Object.assign(liveProduct(h, 'product-draft') ?? {}, { title: 'Renamed draft' });

    expect(await h.approve(id)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(h.deletes).toEqual([]);
    expect(liveProduct(h, 'product-draft')).toBeDefined();
  });

  it('deletes nothing for a failed draft deletion', async () => {
    const h = harness();
    const id = await h.submit('product.delete-draft', { productId: 'product-draft' });
    h.state.everPublished.push('product-draft');

    expect(await h.approve(id)).toMatchObject({ ok: true, value: { status: 'failed', failureCode: 'validation' } });
    expect(h.deletes).toEqual([]);
    expect(liveProduct(h, 'product-draft')).toBeDefined();
  });
});

describe('approveChangeProposal for sales links and settings', () => {
  const linkUpdate = { id: 'link-spring', expectedRevision: 1, slug: 'spring', title: 'Spring', heading: 'Spring sale, extended', productIds: ['product-live'] };

  it('applies a sales link update and bumps its revision', async () => {
    const h = harness();
    const id = await h.submit('sales-link.update', linkUpdate);

    expect(await h.approve(id)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: 'link-spring' } });
    expect(h.state.salesLinks).toEqual([expect.objectContaining({ heading: 'Spring sale, extended', revision: 2, deleted: false })]);
  });

  it.each([
    ['sales-link.update', linkUpdate],
    ['sales-link.delete', { id: 'link-spring' }],
  ] as const)('marks %s stale when the link revision moved', async (operation, input) => {
    const h = harness();
    const id = await h.submit(operation, input);
    h.state.salesLinks = [salesLink({ title: 'Spring, renamed live', revision: 2 })];

    expect(await h.approve(id)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(h.state.salesLinks).toEqual([salesLink({ title: 'Spring, renamed live', revision: 2 })]);
  });

  it('applies a sales link deletion and a creation', async () => {
    const h = harness();
    const deletion = await h.submit('sales-link.delete', { id: 'link-spring' });
    const creation = await h.submit('sales-link.create', { slug: 'summer', title: 'Summer', heading: 'Summer sale', productIds: ['product-mug'] });

    expect(await h.approve(deletion)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: 'link-spring' } });
    const created = await h.approve(creation);
    expect(created).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(h.state.salesLinks.map(({ slug, deleted, revision }) => ({ slug, deleted, revision }))).toEqual([
      { slug: 'spring', deleted: true, revision: 2 },
      { slug: 'summer', deleted: false, revision: 1 },
    ]);
  });

  it('applies a settings update with the fields its coherence rules rewrite', async () => {
    const h = harness();
    const id = await h.submit('settings.update', { invoiceVatMode: 'exempt', invoiceExemptionBasisKind: 'art_113_1', invoiceExemptionBasis: 'Article 113(1) of the VAT Act' });

    expect(await h.approve(id)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: null } });
    expect(h.state.settings[0]?.settings).toMatchObject({ invoiceVatMode: 'exempt', invoiceVatRatePercent: null, invoiceExemptionBasisKind: 'art_113_1' });
  });

  it('marks a settings update stale when a field it changes moved, also a rewritten one', async () => {
    for (const moved of [{ name: 'Renamed live' }, { invoiceVatRatePercent: 8 as const }]) {
      const h = harness();
      const id = await h.submit('settings.update', { name: 'Acme shop', invoiceVatMode: 'exempt', invoiceExemptionBasisKind: 'art_113_1', invoiceExemptionBasis: 'Article 113(1) of the VAT Act' });
      const settings = h.state.settings[0];
      if (settings === undefined) throw new Error('settings missing');
      settings.settings = { ...settings.settings, ...moved };

      expect(await h.approve(id), JSON.stringify(moved)).toMatchObject({ ok: true, value: { status: 'stale' } });
      expect(settings.settings).toMatchObject({ ...moved, invoiceVatMode: 'rate' });
    }
  });

  it('applies a settings update when another settings field changed', async () => {
    const h = harness();
    const id = await h.submit('settings.update', { name: 'Acme shop' });
    const settings = h.state.settings[0];
    if (settings === undefined) throw new Error('settings missing');
    settings.settings = { ...settings.settings, supportEmail: 'help@acme.example.test' };

    expect(await h.approve(id)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(h.state.settings[0]?.settings).toMatchObject({ name: 'Acme shop', supportEmail: 'help@acme.example.test' });
  });
});

describe('approveChangeProposal records failed only for a refusal of the request', () => {
  const linkUpdate = { id: 'link-spring', expectedRevision: 1, slug: 'spring', title: 'Spring', heading: 'Spring sale, extended', productIds: ['product-live'] };

  it.each([
    appError('unavailable', 'The database is busy'),
    appError('internal', 'Lost the connection'),
    appError('rate_limited', 'Too many requests'),
    appError('integration_unavailable', 'Storage is unreachable'),
    appError('forbidden', 'Not allowed for this session'),
  ])('keeps the proposal pending and answers $code when the live use-case returns it', async (error) => {
    const h = harness();
    const id = await h.submit('sales-link.update', linkUpdate);
    const before = structuredClone(h.state);

    const approved = await approveChangeProposal(ownerSession, { id }, { ...h.deps, changeProposalTransaction: failingSalesLinkSaves(h.transaction, error) });

    expect(approved).toEqual({ ok: false, error });
    expect(h.proposal(id)).toMatchObject({ status: 'pending', decidedAt: null, failureCode: null });
    expect(h.events(id)).toEqual(['1:proposed']);
    expect(h.state).toEqual(before);
    expect(await h.approve(id)).toMatchObject({ ok: true, value: { status: 'applied' } });
  });

  it.each([
    appError('conflict', 'The sales link changed meanwhile'),
    appError('validation', 'The heading is too long'),
    appError('not_found', 'No such sales link'),
  ])('records failed with the $code a live refusal of the request carries', async (error) => {
    const h = harness();
    const id = await h.submit('sales-link.update', linkUpdate);

    const approved = await approveChangeProposal(ownerSession, { id }, { ...h.deps, changeProposalTransaction: failingSalesLinkSaves(h.transaction, error) });

    expect(approved).toMatchObject({ ok: true, value: { status: 'failed', failureCode: error.code, failureMessage: error.message } });
    expect(h.events(id)).toEqual(['1:proposed', '2:apply_failed']);
  });
});

describe('approveChangeProposal decisions and guards', () => {
  it.each(privilegeConfusion)('refuses %s before any transaction', async (_label, ctx) => {
    const h = harness();
    const id = await h.submit('product.update', { id: 'product-mug', title: 'Big mug' });

    const result = await h.approve(id, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(['forbidden', 'impersonation_read_only']).toContain(result.error.code);
    expect(h.transaction.calls).toEqual(['dryRun']);
    expect(h.proposal(id)?.status).toBe('pending');
    expect(liveProduct(h, 'product-mug')?.title).toBe('Mug');
  });

  it('answers not found for a proposal of another workspace', async () => {
    const h = harness([shopKey(), shopKey({ id: 'key-neighbour', tenantId: NEIGHBOUR })]);
    const createdAt = '2026-02-28T10:00:00.000Z';
    h.store.seed({
      id: 'proposal-neighbour', tenantId: NEIGHBOUR, groupId: null, groupPosition: null, operation: 'product.update',
      input: { id: 'product-neighbour', title: 'Taken over' }, effect: { title: { before: 'Neighbour mug', after: 'Taken over' } },
      target: { kind: 'product', id: 'product-neighbour' }, status: 'pending', proposedByKeyId: 'key-neighbour', proposedByKeyName: 'Agent',
      proposedByIssuerUserId: ISSUER, createdAt, expiresAt: changeProposalExpiresAt(createdAt), decidedByUserId: null, decidedAt: null,
      decisionNote: null, appliedResourceId: null, failureCode: null, failureMessage: null,
    });

    expect(await h.approve('proposal-neighbour')).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await h.approve('missing')).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(liveProduct(h, 'product-neighbour')?.title).toBe('Neighbour mug');
    expect(h.transaction.calls).toEqual([]);
  });

  it('answers conflict after a rejection or a withdrawal', async () => {
    const h = harness();
    const rejected = await h.submit('product.update', { id: 'product-mug', title: 'Big mug' });
    const withdrawn = await h.submit('product.update', { id: 'product-mug', description: 'Fresh' });
    await rejectChangeProposal(ownerSession, { id: rejected }, { ...h.deps, changeProposals: h.store.repository });
    await withdrawOwnChangeProposal(keyCtx(), { id: withdrawn }, { ...h.deps, changeProposals: h.store.repository });

    expect(await h.approve(rejected)).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'rejected' } } });
    expect(await h.approve(withdrawn)).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'withdrawn' } } });
    expect(liveProduct(h, 'product-mug')).toMatchObject({ title: 'Mug', description: '' });
  });

  it('answers conflict when the proposal left pending before the transaction locked it', async () => {
    const h = harness();
    const id = await h.submit('product.update', { id: 'product-mug', title: 'Big mug' });
    const real = h.transaction;
    const racing: ChangeProposalTransaction = {
      ...real,
      run: async (tenantId, operation) => {
        await rejectChangeProposal(ownerSession, { id }, { ...h.deps, changeProposals: h.store.repository });
        return real.run(tenantId, operation);
      },
    };

    expect(await approveChangeProposal(ownerSession, { id }, { ...h.deps, changeProposalTransaction: racing }))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'rejected' } } });
    expect(h.events(id)).toEqual(['1:proposed', '2:rejected']);
    expect(liveProduct(h, 'product-mug')?.title).toBe('Mug');
  });

  it('records the expiry of an expired proposal and applies nothing', async () => {
    const h = harness();
    const id = await h.submit('product.update', { id: 'product-mug', title: 'Big mug' });
    h.clock.now = '2026-04-01T10:00:00.000Z';

    expect(await h.approve(id)).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'expired' } } });
    expect(h.events(id)).toEqual(['1:proposed', '2:expired']);
    expect(liveProduct(h, 'product-mug')?.title).toBe('Mug');
  });

  it('records the expiry and applies nothing when the proposal expired while the approval waited for the target lock', async () => {
    const h = harness();
    const id = await h.submit('product.update', { id: 'product-mug', title: 'Big mug' });
    const expiresAt = h.proposal(id)?.expiresAt;
    if (expiresAt === undefined) throw new Error('proposal missing');
    h.clock.now = new Date(Date.parse(expiresAt) - 1_000).toISOString();
    const afterExpiry = new Date(Date.parse(expiresAt) + 1_000).toISOString();

    const approved = await approveChangeProposal(ownerSession, { id }, { ...h.deps, changeProposalTransaction: advancingDuringTargetLock(h, afterExpiry) });

    expect(approved).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalStatus: 'expired' } } });
    expect(h.events(id)).toEqual(['1:proposed', '2:expired']);
    expect(h.store.eventRows.at(-1)).toMatchObject({ kind: 'expired', at: afterExpiry, actorUserId: OWNER });
    expect(h.proposal(id)).toMatchObject({ status: 'pending', decidedAt: null });
    expect(liveProduct(h, 'product-mug')?.title).toBe('Mug');
    expect(h.state.entityVersionAuthors).toEqual([]);
  });

  it('stamps the decision with the time read after the target lock', async () => {
    const h = harness();
    const id = await h.submit('product.update', { id: 'product-mug', title: 'Big mug' });
    const afterWait = '2026-03-01T10:05:00.000Z';

    const approved = await approveChangeProposal(ownerSession, { id }, { ...h.deps, changeProposalTransaction: advancingDuringTargetLock(h, afterWait) });

    expect(approved).toMatchObject({ ok: true, value: { status: 'applied', decidedAt: afterWait } });
    expect(h.store.eventRows.at(-1)).toMatchObject({ kind: 'applied', at: afterWait });
  });

  it('approves the proposal of a key that expired naturally and shows the key state', async () => {
    const keys = [shopKey()];
    const h = harness(keys);
    const id = await h.submit('product.update', { id: 'product-mug', title: 'Big mug' });
    keys[0] = shopKey({ expiresAt: '2026-03-01T09:00:00.000Z' });

    expect(await h.approve(id)).toMatchObject({ ok: true, value: { status: 'applied', proposedBy: { keyState: 'expired' } } });
  });
});
