import { describe, expect, it, vi } from 'vitest';

import {
  err,
  integrationUnavailable,
  sha256HexOfBytes,
  storageDefiniteFailure,
  type ChangeProposalOperation,
  type Identity,
  type ImageAssetUploadInput,
  type Product,
  type ShopManagementKey,
  type ShopManagementScope,
  type TenantSettings,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { StorageProvider } from '../ports.js';
import {
  changeProposalOwnerViewFakes,
  createChangeProposalStoreFake,
  createChangeProposalTransactionFake,
  createQuarantinedImagesFake,
  createUnreadNotificationsFake,
  emptyCatalogState,
  fakeContentHash,
} from '../testing/change-proposal-fakes.js';
import { createObjectStorageFake, fakeStorageSecrets } from '../testing/object-storage-fake.js';
import { CHANGE_PROPOSAL_OPERATIONS } from './change-proposal-operations.js';
import {
  approveChangeProposalGroup,
  createChangeProposalGroup,
  rejectChangeProposalGroup,
  submitGroupedChangeProposal,
  withdrawOwnChangeProposalGroup,
} from './change-proposal-groups.js';
import {
  beginProposedBrandingAssetUpload,
  beginProposedProductCoverUpload,
  completeProposedBrandingAssetUpload,
  completeProposedProductCoverUpload,
  getChangeProposalImage,
  sweepQuarantinedImages,
} from './change-proposal-images.js';
import { approveChangeProposal, rejectChangeProposal, submitChangeProposal, withdrawOwnChangeProposal } from './change-proposals.js';
import {
  beginBrandingAssetUpload,
  beginProductCoverUpload,
  completeBrandingAssetUpload,
  completeProductCoverUpload,
  getPublicImageAssetUrl,
} from './image-assets.js';
import { shopManagementKeyCapabilities } from './shop-machine-auth.js';

const TENANT = 'tenant-acme';
const NEIGHBOUR = 'tenant-studio';
const OWNER = 'user-owner';
const ISSUER = 'user-issuer';
const NOW = '2026-03-01T10:00:00.000Z';
const KEY_ID = 'key-propose';
const OTHER_KEY_ID = 'key-second';
const NEIGHBOUR_KEY_ID = 'key-neighbour';
const SCOPES: ShopManagementScope[] = ['shop:catalog:read', 'shop:catalog:write', 'shop:settings:read', 'shop:settings:write'];
const LIVE_COVER = '/api/public/assets/product-cover/11111111-1111-4111-8111-111111111111.png';
const PNG = (marker: number): Uint8Array => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, marker, marker]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  userId: OWNER, email: 'owner@example.test', name: 'Owner', emailVerified: true, tenantAccess: 'staff',
  tenantId: TENANT, tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  ...overrides,
});

const ownerSession: Ctx = { identity: identity() };

const keyCtx = (apiKeyId = KEY_ID, tenantId = TENANT, mode: ShopManagementKey['mode'] = 'propose', scopes = SCOPES): Ctx => ({
  identity: identity({ userId: ISSUER, email: 'issuer@example.test', tenantId }),
  capabilities: shopManagementKeyCapabilities({ scopes, mode }),
  machineActor: { kind: 'shop_management_key', apiKeyId, mode },
});

const shopKey = (overrides: Partial<ShopManagementKey> = {}): ShopManagementKey => ({
  id: KEY_ID, tenantId: TENANT, name: 'Catalogue agent', keyHash: 'hash', scopes: SCOPES, mode: 'propose',
  issuedByUserId: ISSUER, createdAt: '2026-02-25T00:00:00.000Z', expiresAt: '2026-03-20T00:00:00.000Z', revokedAt: null,
  ...overrides,
});

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'product-mug', tenantId: TENANT, type: 'physical', slug: 'mug', title: 'Mug', description: '', coverUrl: null,
  priceCents: 0, currency: 'EUR', published: false, visibility: 'listed', salesChannel: 'any', deliveryMethod: 'pickup',
  accessItems: [], legacyId: null, createdAt: '2026-01-01T00:00:00.000Z', vatRate: null, vatExemptionBasis: null,
  ...overrides,
});

const shopSettings: TenantSettings = {
  name: 'Acme', socialLinks: [], signInNotice: { enabled: false, text: '' }, billingPortalUrl: null, bunnyStreamLibraryId: null,
  bunnyStreamCdnHostname: null, logoUrl: null, logoDarkUrl: null, accentColor: null, accentLight: null, faviconUrl: null,
  ogTitle: null, ogDescription: null, ogImageUrl: null, supportEmail: null, supportUrl: null, termsUrl: null,
  privacyUrl: null, defaultHomeSpaceId: null, invoiceVatMode: 'rate', invoiceVatRatePercent: 23, shippingRates: [],
};

const pathOf = (bytes: Uint8Array, kind = 'product-cover', extension = 'png') =>
  `/api/public/assets/${kind}/${sha256HexOfBytes(bytes)}.${extension}`;

const harness = (limits?: { assetsPerKey: number; bytesPerKey: number; uploadsPerKey?: number }) => {
  const keys = [
    shopKey(),
    shopKey({ id: OTHER_KEY_ID, name: 'Second agent', keyHash: 'hash-2' }),
    shopKey({ id: NEIGHBOUR_KEY_ID, tenantId: NEIGHBOUR, keyHash: 'hash-3' }),
  ];
  const state = emptyCatalogState();
  state.products.push(
    product(),
    product({ id: 'product-live', slug: 'live', title: 'Live mug', coverUrl: LIVE_COVER }),
    product({ id: 'product-neighbour', tenantId: NEIGHBOUR, slug: 'neighbour' }),
  );
  state.settings.push({ tenantId: TENANT, settings: structuredClone(shopSettings) }, { tenantId: NEIGHBOUR, settings: structuredClone(shopSettings) });
  const store = createChangeProposalStoreFake(keys);
  const quarantine = createQuarantinedImagesFake(state, store, limits);
  const objects = createObjectStorageFake();
  const transaction = createChangeProposalTransactionFake(state, store, fakeStorageSecrets);
  const accounts = [{ userId: OWNER, email: 'owner@example.test', ownerOf: [TENANT] }];
  let sequence = 0;
  const clock = { now: NOW };
  const logger = { error: vi.fn<(message: string) => void>() };
  const deps = {
    changeProposalTransaction: transaction,
    changeProposals: store.repository,
    changeProposalGroups: store.groups,
    changeProposalEvents: store.events,
    shopManagementKeys: { listByTenant: async (tenantId: string) => keys.filter((key) => key.tenantId === tenantId) },
    ...createUnreadNotificationsFake(accounts),
    ...changeProposalOwnerViewFakes(state, accounts),
    quarantinedImages: quarantine.repository,
    storage: objects.storage,
    secretResolver: fakeStorageSecrets,
    contentHash: fakeContentHash,
    logger,
    ids: { nextId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` },
    clock: { nowIso: () => clock.now },
  };
  const upload = async (bytes: Uint8Array, input: Partial<ImageAssetUploadInput> = {}, ctx = keyCtx()) => {
    const request: ImageAssetUploadInput = { kind: 'product-cover', fileName: 'cover.png', contentType: 'image/png', sizeBytes: bytes.byteLength, ...input };
    const branding = request.kind !== 'product-cover';
    const started = branding ? await beginProposedBrandingAssetUpload(ctx, request, deps) : await beginProposedProductCoverUpload(ctx, request, deps);
    if (!started.ok) throw new Error(started.error.message);
    objects.objects.set(started.value.key, { bytes, contentType: request.contentType });
    const completed = branding
      ? await completeProposedBrandingAssetUpload(ctx, { key: started.value.key }, deps)
      : await completeProposedProductCoverUpload(ctx, { key: started.value.key }, deps);
    if (!completed.ok) throw new Error(completed.error.message);
    return completed.value.url;
  };
  const propose = (operation: ChangeProposalOperation, input: unknown, ctx = keyCtx()) => submitChangeProposal(ctx, { operation, input }, deps);
  const proposed = async (operation: ChangeProposalOperation, input: unknown, ctx = keyCtx()): Promise<string> => {
    const result = await propose(operation, input, ctx);
    if (!result.ok) throw new Error(`${operation}: ${result.error.message}`);
    return result.value.id;
  };
  const proposal = (id: string) => store.proposals.find((candidate) => candidate.id === id);
  const publicKeys = () => objects.keysUnder('image-assets/');
  const quarantinedKeys = () => objects.keysUnder('image-asset-quarantine/');
  return { state, store, quarantine, objects, transaction, deps, clock, logger, upload, propose, proposed, proposal, publicKeys, quarantinedKeys };
};

type Harness = ReturnType<typeof harness>;

const liveCover = (h: Harness, id: string) => h.state.products.find((candidate) => candidate.id === id)?.coverUrl;

describe('uploading an image for a proposal', () => {
  it('presigns a write to the private candidate prefix for a propose-mode key, by the write scope of the family', async () => {
    const h = harness();
    const started = await beginProposedProductCoverUpload(keyCtx(), { kind: 'product-cover', fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 }, h.deps);
    expect(started).toMatchObject({ ok: true, value: { key: expect.stringMatching(/^image-asset-candidates\/tenant-acme\/product-cover\/[0-9a-f-]{36}\.png$/u) } });
    expect(h.objects.calls.map(({ method }) => method)).toEqual(['presignPut']);

    const settingsOnly = keyCtx(KEY_ID, TENANT, 'propose', ['shop:settings:read', 'shop:settings:write']);
    expect(await beginProposedProductCoverUpload(settingsOnly, { kind: 'product-cover', fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await beginProposedBrandingAssetUpload(settingsOnly, { kind: 'logo', fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 }, h.deps))
      .toMatchObject({ ok: true });
    expect(await beginProposedProductCoverUpload(keyCtx(), { kind: 'logo', fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it.each([
    ['an owner session', ownerSession],
    ['a direct-mode key', keyCtx(KEY_ID, TENANT, 'direct')],
    ['a propose-mode key without a write scope', keyCtx(KEY_ID, TENANT, 'propose', ['shop:catalog:read', 'shop:settings:read'])],
  ])('refuses the proposal upload to %s', async (_label, ctx) => {
    const h = harness();
    expect(await beginProposedProductCoverUpload(ctx, { kind: 'product-cover', fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await completeProposedBrandingAssetUpload(ctx, { key: `image-asset-candidates/${TENANT}/logo/00000000-0000-4000-8000-000000000001.png` }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('signs the declared size into the presigned write and records the upload before answering it', async () => {
    const h = harness();
    const started = await beginProposedProductCoverUpload(keyCtx(), { kind: 'product-cover', fileName: 'a.png', contentType: 'image/png', sizeBytes: 1234 }, h.deps);
    if (!started.ok) throw new Error(started.error.message);
    expect(h.objects.signedLengths.get(started.value.key)).toBe(1234);
    expect(h.store.imageUploads).toEqual([{ tenantId: TENANT, apiKeyId: KEY_ID, objectKey: started.value.key, createdAt: NOW }]);

    for (const ctx of [ownerSession, keyCtx(KEY_ID, TENANT, 'direct')]) {
      const live = await beginProductCoverUpload(ctx, { kind: 'product-cover', fileName: 'a.png', contentType: 'image/png', sizeBytes: 1234 }, h.deps);
      if (!live.ok) throw new Error(live.error.message);
      expect(h.objects.signedLengths.has(live.value.key)).toBe(false);
    }
    expect(h.store.imageUploads).toHaveLength(1);
  });

  it('refuses a key more uploads within the upload lifetime than the limit, with the cap named, and allows them again later', async () => {
    const h = harness({ assetsPerKey: 100, bytesPerKey: 50 * 1024 * 1024, uploadsPerKey: 2 });
    const begin = (ctx = keyCtx()) =>
      beginProposedProductCoverUpload(ctx, { kind: 'product-cover', fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 }, h.deps);
    expect((await begin()).ok).toBe(true);
    expect((await begin()).ok).toBe(true);
    expect(await begin()).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'key_image_uploads' } } });
    expect(h.objects.calls.filter(({ method }) => method === 'presignPut')).toHaveLength(2);
    expect((await begin(keyCtx(OTHER_KEY_ID))).ok).toBe(true);
    h.clock.now = '2026-03-01T10:15:00.001Z';
    expect((await begin()).ok).toBe(true);
  });

  it('deletes the candidate and stores no row when the quarantined copy cannot be written', async () => {
    const h = harness();
    const started = await beginProposedProductCoverUpload(keyCtx(), { kind: 'product-cover', fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 }, h.deps);
    if (!started.ok) throw new Error(started.error.message);
    h.objects.objects.set(started.value.key, { bytes: PNG(1), contentType: 'image/png' });
    h.objects.failPuts = (key) => key.startsWith('image-asset-quarantine/');
    expect(await completeProposedProductCoverUpload(keyCtx(), { key: started.value.key }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect([...h.objects.objects.keys()]).toEqual([]);
    expect(h.store.imageRows).toEqual([]);
  });

  it('completes a candidate only for the key that started it, and never through the live completion', async () => {
    const h = harness();
    const started = await beginProposedProductCoverUpload(keyCtx(), { kind: 'product-cover', fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 }, h.deps);
    if (!started.ok) throw new Error(started.error.message);
    h.objects.objects.set(started.value.key, { bytes: PNG(1), contentType: 'image/png' });
    const input = { key: started.value.key };
    const gone = { ok: false, error: { code: 'not_found' } };
    expect(await completeProposedProductCoverUpload(keyCtx(OTHER_KEY_ID), input, h.deps)).toMatchObject(gone);
    expect(await completeProductCoverUpload(keyCtx(KEY_ID, TENANT, 'direct'), input, h.deps)).toMatchObject(gone);
    expect(await completeProductCoverUpload(ownerSession, input, h.deps)).toMatchObject(gone);
    expect(h.store.imageRows).toEqual([]);
    expect(h.publicKeys()).toEqual([]);
    expect(h.objects.keysUnder('image-asset-candidates/')).toEqual([started.value.key]);

    expect(await completeProposedProductCoverUpload(keyCtx(), input, h.deps)).toMatchObject({ ok: true, value: { quarantined: true } });
    expect(h.store.imageRows.map((row) => row.apiKeyId)).toEqual([KEY_ID]);
  });

  it('copies verified bytes to a private content-addressed key, deletes the candidate and answers the future public path', async () => {
    const h = harness();
    const bytes = PNG(1);
    const url = await h.upload(bytes);
    const digest = sha256HexOfBytes(bytes);
    expect(url).toBe(`/api/public/assets/product-cover/${digest}.png`);
    expect(h.quarantinedKeys()).toEqual([`image-asset-quarantine/${TENANT}/${KEY_ID}/product-cover/${digest}.png`]);
    expect(h.objects.keysUnder('image-asset-candidates/')).toEqual([]);
    expect(h.publicKeys()).toEqual([]);
    expect(h.store.imageRows).toEqual([{ tenantId: TENANT, apiKeyId: KEY_ID, kind: 'product-cover', digest, extension: 'png', sizeBytes: bytes.byteLength, createdAt: NOW }]);

    expect(await h.upload(bytes)).toBe(url);
    expect(h.store.imageRows).toHaveLength(1);
    expect(await h.upload(bytes, {}, keyCtx(OTHER_KEY_ID))).toBe(url);
    expect(h.store.imageRows.map((row) => row.apiKeyId)).toEqual([KEY_ID, OTHER_KEY_ID]);
    expect(h.publicKeys()).toEqual([]);
  });

  it('answers the live validation error for bytes that are not the declared format and deletes the candidate', async () => {
    const h = harness();
    const started = await beginProposedProductCoverUpload(keyCtx(), { kind: 'product-cover', fileName: 'a.png', contentType: 'image/png', sizeBytes: 3 }, h.deps);
    if (!started.ok) throw new Error(started.error.message);
    h.objects.objects.set(started.value.key, { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' });
    expect(await completeProposedProductCoverUpload(keyCtx(), { key: started.value.key }, h.deps))
      .toEqual({ ok: false, error: { code: 'validation', message: 'Uploaded image does not match its declared format or size' } });
    expect([...h.objects.objects.keys()]).toEqual([]);
    expect(h.store.imageRows).toEqual([]);
  });

  it('refuses beyond the count and the byte limit of the key with the cap named, deleting the candidate', async () => {
    const h = harness({ assetsPerKey: 2, bytesPerKey: 25 });
    await h.upload(PNG(1));
    await h.upload(PNG(2));
    const started = await beginProposedProductCoverUpload(keyCtx(), { kind: 'product-cover', fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 }, h.deps);
    if (!started.ok) throw new Error(started.error.message);
    h.objects.objects.set(started.value.key, { bytes: PNG(3), contentType: 'image/png' });
    expect(await completeProposedProductCoverUpload(keyCtx(), { key: started.value.key }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: 'key_quarantined_images' } } });
    expect(h.objects.keysUnder('image-asset-candidates/')).toEqual([]);

    const bytesHarness = harness({ assetsPerKey: 100, bytesPerKey: 15 });
    await bytesHarness.upload(PNG(1));
    await expect(bytesHarness.upload(PNG(2))).rejects.toThrow('bytes of uploaded images awaiting approval');
    expect(bytesHarness.store.imageRows).toHaveLength(1);
  });
});

describe('the image addresses a propose-mode key may propose', () => {
  it('accepts its own quarantined image of the field kind, an address a live field shows, null and an unchanged value', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const logo = await h.upload(PNG(2), { kind: 'logo', fileName: 'logo.png' });
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    expect(h.proposal(id)?.effect).toEqual({ coverUrl: { before: null, after: cover } });
    expect((await h.propose('product.update', { id: 'product-mug', coverUrl: LIVE_COVER })).ok).toBe(true);
    expect((await h.propose('product.update', { id: 'product-live', coverUrl: null })).ok).toBe(true);
    expect((await h.propose('product.update', { id: 'product-live', coverUrl: LIVE_COVER, title: 'Same cover' })).ok).toBe(true);
    expect((await h.propose('settings.update', { logoUrl: logo })).ok).toBe(true);
    expect((await h.propose('product.create', { title: 'Poster', slug: 'poster', type: 'physical', priceCents: 3900, coverUrl: cover })).ok).toBe(true);
    expect(h.publicKeys()).toEqual([]);
  });

  it.each([
    ['a foreign URL', () => 'https://cdn.example.test/cover.png'],
    ['an uploaded-style address no live field shows', () => '/api/public/assets/product-cover/22222222-2222-4222-8222-222222222222.png'],
    ['another path of the application', () => '/api/public/assets/product-cover/../../secrets'],
  ])('refuses %s with the live validation wording', async (_label, address) => {
    const h = harness();
    expect(await h.propose('product.update', { id: 'product-mug', coverUrl: address() })).toMatchObject({
      ok: false,
      error: { code: 'validation', message: 'Invalid product update payload', details: { fieldErrors: { coverUrl: [expect.any(String)] } } },
    });
    expect(h.store.proposals).toEqual([]);
  });

  it('refuses another key\'s and another workspace\'s quarantined image and an image of the wrong kind', async () => {
    const h = harness();
    const othersCover = await h.upload(PNG(1), {}, keyCtx(OTHER_KEY_ID));
    const neighbourCover = await h.upload(PNG(2), {}, keyCtx(NEIGHBOUR_KEY_ID, NEIGHBOUR));
    const logo = await h.upload(PNG(3), { kind: 'logo', fileName: 'logo.png' });
    const ownCover = await h.upload(PNG(4));
    for (const coverUrl of [othersCover, neighbourCover, logo]) {
      expect(await h.propose('product.update', { id: 'product-mug', coverUrl })).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
    for (const coverUrl of [othersCover, 'https://cdn.example.test/new-cover.png']) {
      expect(await h.propose('product.create', { title: 'Poster', slug: 'poster', type: 'physical', priceCents: 3900, coverUrl })).toMatchObject({
        ok: false, error: { code: 'validation', message: 'Invalid product payload', details: { fieldErrors: { coverUrl: [expect.any(String)] } } },
      });
    }
    expect(await h.propose('settings.update', { faviconUrl: ownCover })).toMatchObject({
      ok: false, error: { code: 'validation', message: 'Invalid shop settings', details: { fieldErrors: { faviconUrl: [expect.any(String)] } } },
    });
    expect(h.store.proposals).toEqual([]);
  });

  it('refuses a new checkout logo or icon address, single and grouped, and allows clearing it, keeping it and the other appearance fields', async () => {
    const h = harness();
    const live = { displayName: 'Acme checkout', logoUrl: 'https://cdn.example.test/checkout-logo.png', iconUrl: null };
    const settings = h.state.settings.find((entry) => entry.tenantId === TENANT)?.settings;
    if (settings === undefined) throw new Error('missing settings');
    settings.checkoutAppearance = live;
    const refused = (field: 'logoUrl' | 'iconUrl') => ({
      ok: false,
      error: { code: 'validation', message: 'Invalid shop settings', details: { formErrors: [], fieldErrors: { checkoutAppearance: [`${field} cannot be proposed yet: this image must be empty or unchanged`] } } },
    });
    const group = await createChangeProposalGroup(keyCtx(), { title: 'Checkout look' }, h.deps);
    if (!group.ok) throw new Error(group.error.message);
    const grouped = (input: unknown) => submitGroupedChangeProposal(keyCtx(), { groupId: group.value.id, operation: 'settings.update', input }, h.deps);

    for (const [field, appearance] of [
      ['logoUrl', { ...live, logoUrl: 'https://cdn.example.test/new-logo.png' }],
      ['iconUrl', { ...live, iconUrl: 'https://cdn.example.test/new-icon.png' }],
    ] as const) {
      expect(await h.propose('settings.update', { checkoutAppearance: appearance })).toEqual(refused(field));
      expect(await grouped({ checkoutAppearance: appearance })).toEqual(refused(field));
    }
    expect(h.store.proposals).toEqual([]);

    expect((await h.propose('settings.update', { checkoutAppearance: { ...live, displayName: 'Renamed checkout' } })).ok).toBe(true);
    expect((await h.propose('settings.update', { checkoutAppearance: { ...live, logoUrl: null } })).ok).toBe(true);
    expect((await grouped({ checkoutAppearance: { ...live, buttonColor: '#112233' } })).ok).toBe(true);

    const update = CHANGE_PROPOSAL_OPERATIONS['settings.update'].prepare({ checkoutAppearance: { ...live, iconUrl: 'https://cdn.example.test/new-icon.png' } });
    if (!update.ok) throw new Error(update.error.message);
    for (const ctx of [ownerSession, keyCtx(KEY_ID, TENANT, 'direct')]) {
      expect(await h.transaction.run(TENANT, (scope) => update.value.run(ctx, scope, h.deps, { keyId: KEY_ID }))).toEqual({ ok: true, value: null });
    }
    expect(h.state.settings.find((entry) => entry.tenantId === TENANT)?.settings.checkoutAppearance).toMatchObject({ iconUrl: 'https://cdn.example.test/new-icon.png' });
  });

  it('refuses an image released between the check and the insert', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const find = h.deps.quarantinedImages.find;
    const racing = {
      ...h.deps,
      quarantinedImages: { ...h.deps.quarantinedImages, find: async (...args: Parameters<typeof find>) => {
        const found = await find(...args);
        h.store.imageRows.length = 0;
        return found;
      } },
    };
    expect(await submitChangeProposal(keyCtx(), { operation: 'product.update', input: { id: 'product-mug', coverUrl: cover } }, racing))
      .toMatchObject({ ok: false, error: { code: 'validation', details: { formErrors: [expect.stringContaining('no longer available')] } } });
    expect(h.store.proposals).toEqual([]);
  });

  it('leaves a foreign cover address to an owner session and a direct-mode key exactly as today', async () => {
    const h = harness();
    const foreign = 'https://cdn.example.test/cover.png';
    const update = CHANGE_PROPOSAL_OPERATIONS['product.update'].prepare({ id: 'product-mug', coverUrl: foreign });
    if (!update.ok) throw new Error(update.error.message);
    for (const ctx of [ownerSession, keyCtx(KEY_ID, TENANT, 'direct')]) {
      const ran = await h.transaction.run(TENANT, (scope) => update.value.run(ctx, scope, h.deps, { keyId: KEY_ID }));
      expect(ran).toEqual({ ok: true, value: 'product-mug' });
    }
    expect(liveCover(h, 'product-mug')).toBe(foreign);
  });
});

describe('approving a proposal with an image', () => {
  it('publishes the verified bytes under the digest, then attaches the path, and removes the quarantined copy after commit', async () => {
    const h = harness();
    const bytes = PNG(7);
    const cover = await h.upload(bytes);
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    const published = `image-assets/${TENANT}/product-cover/${sha256HexOfBytes(bytes)}.png`;
    expect(h.publicKeys()).toEqual([published]);
    const stored = h.objects.objects.get(published);
    expect(stored?.bytes).toEqual(bytes);
    expect(stored?.contentType).toBe('image/png');
    expect(cover).toBe(`/api/public/assets/product-cover/${sha256HexOfBytes(stored?.bytes ?? new Uint8Array())}.png`);
    expect(liveCover(h, 'product-mug')).toBe(cover);
    expect(h.quarantinedKeys()).toEqual([]);
    expect(h.store.imageRows).toEqual([]);
    const order = h.objects.calls.filter(({ method }) => method !== 'presignPut').map(({ method, key }) => `${method}:${key.split('/')[0] ?? ''}`);
    expect(order.slice(-3)).toEqual(['getObject:image-asset-quarantine', 'putObject:image-assets', 'delete:image-asset-quarantine']);
  });

  it('publishes nothing for a stale approval and releases the image', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const mug = h.state.products.find((candidate) => candidate.id === 'product-mug');
    if (mug === undefined) throw new Error('missing product');
    mug.coverUrl = 'https://cdn.example.test/changed.png';

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(h.publicKeys()).toEqual([]);
    expect(h.quarantinedKeys()).toEqual([]);
    expect(h.store.imageRows).toEqual([]);
  });

  it('publishes nothing for a failed approval and releases the image', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const id = await h.proposed('product.create', { title: 'Poster', slug: 'poster', type: 'physical', priceCents: 3900, coverUrl: cover });
    h.state.products.push(product({ id: 'product-taken', slug: 'poster' }));

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'failed' } });
    expect(h.publicKeys()).toEqual([]);
    expect(h.store.imageRows).toEqual([]);
  });

  it('withdraws the published copy when the approval aborts after publishing, and keeps the proposal and its image', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const transition = h.store.repository.transition;
    h.store.repository.transition = async () => ({ kind: 'busy' });

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(h.objects.calls.some(({ method, key }) => method === 'putObject' && key.startsWith('image-assets/'))).toBe(true);
    expect(h.publicKeys()).toEqual([]);
    expect(h.proposal(id)?.status).toBe('pending');
    expect(liveCover(h, 'product-mug')).toBeNull();
    expect(h.store.imageRows).toHaveLength(1);

    h.store.repository.transition = transition;
    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(h.publicKeys()).toHaveLength(1);
  });

  it('withdraws a partly written copy when publishing fails, leaving the proposal pending', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    h.objects.failPuts = (key) => key.startsWith('image-assets/');

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(h.publicKeys()).toEqual([]);
    expect(h.proposal(id)?.status).toBe('pending');
    expect(liveCover(h, 'product-mug')).toBeNull();
  });

  it('deletes the copy of a write without a definite answer on withdrawal but keeps its record, so the sweep deletes a copy that lands later', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const put = h.objects.storage.putObject;
    let land: () => Promise<unknown> = async () => undefined;
    h.objects.storage.putObject = async (input) => {
      if (!input.url.includes('/image-assets/')) return put(input);
      land = () => put(input);
      return err(integrationUnavailable('Could not store the published image: the storage request deadline passed'));
    };

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(h.objects.calls.filter(({ method, key }) => method === 'delete' && key.startsWith('image-assets/'))).toHaveLength(1);
    expect(h.store.imagePublications).toHaveLength(1);
    await land();
    expect(h.publicKeys()).toHaveLength(1);

    h.clock.now = '2026-03-01T10:09:00.000Z';
    await sweepQuarantinedImages(h.deps);
    expect(h.publicKeys()).toHaveLength(1);
    expect(h.store.imagePublications).toHaveLength(1);
    h.clock.now = '2026-03-01T10:11:00.000Z';
    await sweepQuarantinedImages(h.deps);
    expect(h.publicKeys()).toEqual([]);
    expect(h.store.imagePublications).toEqual([]);
    expect(h.proposal(id)?.status).toBe('pending');
    expect(liveCover(h, 'product-mug')).toBeNull();
  });

  it('reuses no address whose withdrawal delete had no definite answer until the sweep deleted it again after the bound', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const transition = h.store.repository.transition;
    h.store.repository.transition = async () => ({ kind: 'busy' });
    const remove = h.objects.storage.delete;
    let land: () => Promise<unknown> = async () => undefined;
    h.objects.storage.delete = async (input) => {
      if (!input.url.includes('/image-assets/')) return remove(input);
      land = () => remove(input);
      return err(integrationUnavailable('Could not delete the published image: the storage request deadline passed'));
    };
    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(h.publicKeys()).toHaveLength(1);
    h.store.repository.transition = transition;
    h.objects.storage.delete = remove;

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    await land();
    expect(liveCover(h, 'product-mug')).toBeNull();
    h.clock.now = '2026-03-01T10:09:00.000Z';
    await sweepQuarantinedImages(h.deps);
    expect(h.store.imagePublications).toHaveLength(1);
    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    h.clock.now = '2026-03-01T10:11:00.000Z';
    await sweepQuarantinedImages(h.deps);
    expect(h.store.imagePublications).toEqual([]);

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(liveCover(h, 'product-mug')).toBe(cover);
    expect(h.publicKeys()).toHaveLength(1);
  });

  it('revives no released quarantined row whose delete had no definite answer until the sweep deleted it again after the bound', async () => {
    const h = harness();
    const bytes = PNG(1);
    const cover = await h.upload(bytes);
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const remove = h.objects.storage.delete;
    let land: () => Promise<unknown> = async () => undefined;
    h.objects.storage.delete = async (input) => {
      if (!input.url.includes('/image-asset-quarantine/')) return remove(input);
      land = () => remove(input);
      return err(integrationUnavailable('Could not delete the quarantined image: the storage request deadline passed'));
    };
    expect(await rejectChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true });
    h.objects.storage.delete = remove;
    await expect(h.upload(bytes)).rejects.toThrow('busy');
    await land();
    expect(h.quarantinedKeys()).toEqual([]);

    h.clock.now = '2026-03-01T10:05:00.000Z';
    await sweepQuarantinedImages(h.deps);
    expect(h.store.releasedImageRows).toHaveLength(1);
    h.clock.now = '2026-03-01T10:11:00.000Z';
    await sweepQuarantinedImages(h.deps);
    expect(h.store.releasedImageRows).toEqual([]);
    expect(await h.upload(bytes)).toBe(cover);
    expect(h.quarantinedKeys()).toHaveLength(1);
  });

  it('counts the age bound of a record it keeps after a write without a definite answer from that write, not from the attempt start', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const put = h.objects.storage.putObject;
    let land: () => Promise<unknown> = async () => undefined;
    h.objects.storage.putObject = async (input) => {
      if (!input.url.includes('/image-assets/')) return put(input);
      h.clock.now = '2026-03-01T10:04:00.000Z';
      land = () => put(input);
      return err(integrationUnavailable('Could not store the published image: the storage request deadline passed'));
    };
    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });

    h.clock.now = '2026-03-01T10:11:00.000Z';
    await sweepQuarantinedImages(h.deps);
    expect(h.store.imagePublications).toHaveLength(1);
    await land();
    h.clock.now = '2026-03-01T10:15:00.000Z';
    await sweepQuarantinedImages(h.deps);
    expect(h.publicKeys()).toEqual([]);
    expect(h.store.imagePublications).toEqual([]);
  });

  it('writes nothing once the approval runs longer than the write window after it recorded its intent, and answers busy', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const get = h.objects.storage.getObject;
    h.objects.storage.getObject = async (input, options) => {
      if (input.url.includes('/image-asset-quarantine/')) h.clock.now = '2026-03-01T10:05:00.001Z';
      return get(input, options);
    };
    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(h.objects.calls.filter(({ method, key }) => method === 'putObject' && key.startsWith('image-assets/'))).toEqual([]);
    expect(h.store.imagePublications).toEqual([]);
    expect(h.proposal(id)?.status).toBe('pending');
  });

  it('removes the record with the withdrawal when the storage refused the write', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const put = h.objects.storage.putObject;
    h.objects.storage.putObject = async (input) => input.url.includes('/image-assets/')
      ? err(storageDefiniteFailure('S3 refused the published image with status 403'))
      : put(input);

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(h.store.imagePublications).toEqual([]);
    expect(h.publicKeys()).toEqual([]);
  });

  it('keeps a published copy that a live field already shows when a later approval of the same bytes aborts', async () => {
    const h = harness();
    const bytes = PNG(1);
    const cover = await h.upload(bytes);
    const first = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const second = await h.proposed('product.update', { id: 'product-live', coverUrl: cover });
    expect(await approveChangeProposal(ownerSession, { id: first }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(h.store.imageRows).toHaveLength(1);
    h.store.repository.transition = async () => ({ kind: 'busy' });

    expect(await approveChangeProposal(ownerSession, { id: second }, h.deps)).toMatchObject({ ok: false });
    expect(h.publicKeys()).toEqual([`image-assets/${TENANT}/product-cover/${sha256HexOfBytes(bytes)}.png`]);
  });

  it('never deletes a public copy an earlier applied approval published, even once no live field shows it', async () => {
    const h = harness();
    const bytes = PNG(1);
    const cover = await h.upload(bytes);
    const first = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const second = await h.proposed('product.update', { id: 'product-live', coverUrl: cover });
    expect(await approveChangeProposal(ownerSession, { id: first }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(h.store.imagePublications).toEqual([]);
    const mug = h.state.products.find((candidate) => candidate.id === 'product-mug');
    if (mug === undefined) throw new Error('missing product');
    mug.coverUrl = null;
    h.store.repository.transition = async () => ({ kind: 'busy' });

    expect(await approveChangeProposal(ownerSession, { id: second }, h.deps)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(h.publicKeys()).toEqual([`image-assets/${TENANT}/product-cover/${sha256HexOfBytes(bytes)}.png`]);
    expect(h.objects.calls.filter(({ method, key }) => method === 'putObject' && key.startsWith('image-assets/'))).toHaveLength(1);
    expect(h.store.imagePublications).toEqual([]);
  });

  it('records the intent before writing and removes the record with the written copy when the approval aborts', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const put = h.objects.storage.putObject;
    const recordedAtWrite: number[] = [];
    h.objects.storage.putObject = async (input) => {
      if (input.url.includes('/image-assets/')) recordedAtWrite.push(h.store.imagePublications.length);
      return put(input);
    };
    h.store.repository.transition = async () => ({ kind: 'busy' });

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: false });
    expect(recordedAtWrite).toEqual([1]);
    expect(h.publicKeys()).toEqual([]);
    expect(h.store.imagePublications).toEqual([]);
  });

  it('makes the approval stale with the image note when the quarantined object is gone, and only a failed read leaves it pending', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const [quarantined] = h.quarantinedKeys();
    if (quarantined === undefined) throw new Error('missing quarantined image');
    h.objects.failReads = (key) => key === quarantined;
    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(h.proposal(id)?.status).toBe('pending');

    h.objects.failReads = () => false;
    h.objects.objects.delete(quarantined);
    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(h.store.eventRows.at(-1)).toMatchObject({ kind: 'stale', note: expect.stringContaining(`${cover} is no longer available`) });
    expect(h.publicKeys()).toEqual([]);
  });

  it('makes the approval stale with a clear note when the image was released, and publishes nothing', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    h.store.imageRows.length = 0;

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(h.store.eventRows.at(-1)).toMatchObject({ kind: 'stale', note: expect.stringContaining(`${cover} is no longer available`) });
    expect(h.publicKeys()).toEqual([]);
    expect(liveCover(h, 'product-mug')).toBeNull();
  });

  it('never publishes bytes that no longer hash to the digest the owner approved', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const [quarantined] = h.quarantinedKeys();
    if (quarantined === undefined) throw new Error('missing quarantined image');
    h.objects.objects.set(quarantined, { bytes: PNG(9), contentType: 'image/png' });

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(h.publicKeys()).toEqual([]);
  });

  it('records the expiry of an expired proposal, publishes nothing and releases its image', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    h.clock.now = h.proposal(id)?.expiresAt ?? NOW;

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: false, error: { details: { changeProposalStatus: 'expired' } } });
    expect(h.publicKeys()).toEqual([]);
    expect(h.store.imageRows).toEqual([]);
  });

  it('publishes again for a second approval of the same image, which stays quarantined until no pending proposal uses it', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const first = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const second = await h.proposed('product.update', { id: 'product-live', coverUrl: cover });

    expect(await approveChangeProposal(ownerSession, { id: first }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(h.store.imageRows).toHaveLength(1);
    expect(await approveChangeProposal(ownerSession, { id: second }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(liveCover(h, 'product-live')).toBe(cover);
    expect(h.publicKeys()).toHaveLength(1);
    expect(h.store.imageRows).toEqual([]);
    expect(h.quarantinedKeys()).toEqual([]);
  });

  it('accepts an address whose image is already public after its quarantined copy is gone', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const first = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    expect(await approveChangeProposal(ownerSession, { id: first }, h.deps)).toMatchObject({ ok: true });
    const again = await h.proposed('product.update', { id: 'product-live', coverUrl: cover });
    expect(await approveChangeProposal(ownerSession, { id: again }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(liveCover(h, 'product-live')).toBe(cover);
  });

  it('publishes only the images the effect changes, never an unchanged address the input repeats', async () => {
    const h = harness();
    const bytes = PNG(5);
    const live = h.state.products.find((candidate) => candidate.id === 'product-live');
    if (live === undefined) throw new Error('missing product');
    live.coverUrl = pathOf(bytes);
    expect(await h.upload(bytes)).toBe(pathOf(bytes));
    const id = await h.proposed('product.update', { id: 'product-live', coverUrl: pathOf(bytes), title: 'Renamed mug' });
    expect(h.proposal(id)?.effect).toEqual({ title: { before: 'Live mug', after: 'Renamed mug' } });

    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(h.publicKeys()).toEqual([]);
    expect(h.objects.calls.filter(({ method, key }) => method === 'putObject' && key.startsWith('image-assets/'))).toEqual([]);
    expect(h.store.imagePublications).toEqual([]);
  });

  it('publishes branding images of a settings change', async () => {
    const h = harness();
    const logo = await h.upload(PNG(1), { kind: 'logo', fileName: 'logo.png' });
    const share = await h.upload(PNG(2), { kind: 'share-image', fileName: 'share.png' });
    const id = await h.proposed('settings.update', { logoUrl: logo, ogImageUrl: share });
    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(h.publicKeys()).toEqual([
      `image-assets/${TENANT}/logo/${sha256HexOfBytes(PNG(1))}.png`,
      `image-assets/${TENANT}/share-image/${sha256HexOfBytes(PNG(2))}.png`,
    ]);
    expect(h.state.settings[0]?.settings).toMatchObject({ logoUrl: logo, ogImageUrl: share });
  });
});

describe('a group with images', () => {
  const groupOf = async (h: Harness): Promise<string> => {
    const created = await createChangeProposalGroup(keyCtx(), { title: 'Launch' }, h.deps);
    if (!created.ok) throw new Error(created.error.message);
    return created.value.id;
  };
  const join = async (h: Harness, groupId: string, operation: ChangeProposalOperation, input: unknown) => {
    const joined = await submitGroupedChangeProposal(keyCtx(), { groupId, operation, input }, h.deps);
    if (!joined.ok) throw new Error(joined.error.message);
    return joined.value;
  };

  it('publishes nothing in the group dry runs and publishes every image when the group is applied', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const second = await h.upload(PNG(2));
    const groupId = await groupOf(h);
    await join(h, groupId, 'product.create', { title: 'Poster', slug: 'poster', type: 'physical', priceCents: 3900, coverUrl: cover });
    const receipt = await join(h, groupId, 'product.update', { id: 'product-mug', coverUrl: second });
    expect(h.publicKeys()).toEqual([]);

    expect(await approveChangeProposalGroup(ownerSession, { id: groupId, itemIds: receipt.items.map((item) => item.id) }, h.deps))
      .toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(h.publicKeys()).toEqual([pathOf(PNG(1)), pathOf(PNG(2))].map((path) => `image-assets/${TENANT}/${path.split('/assets/')[1] ?? ''}`).sort());
    expect(h.state.products.find((candidate) => candidate.slug === 'poster')?.coverUrl).toBe(cover);
    expect(liveCover(h, 'product-mug')).toBe(second);
    expect(h.store.imageRows).toEqual([]);
  });

  it('publishes nothing when an item of the group is stale, and releases the images', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const groupId = await groupOf(h);
    await join(h, groupId, 'product.update', { id: 'product-live', coverUrl: cover });
    const receipt = await join(h, groupId, 'product.update', { id: 'product-mug', title: 'Renamed' });
    const mug = h.state.products.find((candidate) => candidate.id === 'product-mug');
    if (mug === undefined) throw new Error('missing product');
    mug.title = 'Changed meanwhile';

    expect(await approveChangeProposalGroup(ownerSession, { id: groupId, itemIds: receipt.items.map((item) => item.id) }, h.deps))
      .toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(h.publicKeys()).toEqual([]);
    expect(h.store.imageRows).toEqual([]);
  });

  it('makes the whole group stale when an image of an item was released', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const groupId = await groupOf(h);
    await join(h, groupId, 'product.update', { id: 'product-mug', title: 'Renamed' });
    const receipt = await join(h, groupId, 'product.update', { id: 'product-live', coverUrl: cover });
    h.store.imageRows.length = 0;

    expect(await approveChangeProposalGroup(ownerSession, { id: groupId, itemIds: receipt.items.map((item) => item.id) }, h.deps))
      .toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(h.store.proposals.map((item) => item.status)).toEqual(['stale', 'stale']);
    expect(h.publicKeys()).toEqual([]);
    expect(h.state.products.find((candidate) => candidate.id === 'product-mug')?.title).toBe('Mug');
  });

  it('releases the images of a rejected and of a withdrawn group', async () => {
    const h = harness();
    const first = await groupOf(h);
    await join(h, first, 'product.update', { id: 'product-mug', coverUrl: await h.upload(PNG(1)) });
    const second = await groupOf(h);
    await join(h, second, 'product.update', { id: 'product-live', coverUrl: await h.upload(PNG(2)) });

    expect(await rejectChangeProposalGroup(ownerSession, { id: first }, h.deps)).toMatchObject({ ok: true });
    expect(h.store.imageRows.map((row) => row.digest)).toEqual([sha256HexOfBytes(PNG(2))]);
    expect(await withdrawOwnChangeProposalGroup(keyCtx(), { id: second }, h.deps)).toMatchObject({ ok: true });
    expect(h.store.imageRows).toEqual([]);
    expect(h.quarantinedKeys()).toEqual([]);
    expect(h.publicKeys()).toEqual([]);
  });
});

describe('releasing quarantined images', () => {
  it('releases on reject and on withdraw only when no other pending proposal uses the image', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const first = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const second = await h.proposed('product.update', { id: 'product-live', coverUrl: cover });

    expect(await rejectChangeProposal(ownerSession, { id: first }, h.deps)).toMatchObject({ ok: true });
    expect(h.store.imageRows).toHaveLength(1);
    expect(h.quarantinedKeys()).toHaveLength(1);
    expect(await withdrawOwnChangeProposal(keyCtx(), { id: second }, h.deps)).toMatchObject({ ok: true });
    expect(h.store.imageRows).toEqual([]);
    expect(h.quarantinedKeys()).toEqual([]);
    expect(h.publicKeys()).toEqual([]);
  });

  it('hides a released image whose object delete failed and lets the sweep remove it later', async () => {
    const h = harness();
    const cover = await h.upload(PNG(1));
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    h.objects.failDeletes = (key) => key.startsWith('image-asset-quarantine/');
    expect(await rejectChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true });
    expect(h.store.imageRows).toEqual([]);
    expect(h.store.releasedImageRows).toHaveLength(1);
    expect(h.quarantinedKeys()).toHaveLength(1);
    expect((await h.propose('product.update', { id: 'product-mug', coverUrl: cover })).ok).toBe(false);

    h.objects.failDeletes = () => false;
    h.clock.now = '2026-03-01T10:11:00.000Z';
    await sweepQuarantinedImages(h.deps);
    expect(h.store.releasedImageRows).toEqual([]);
    expect(h.quarantinedKeys()).toEqual([]);
  });

  it('gives each lock wait and each delete of the sweep, endpoint lookup included, only what is left of its stage\'s share of the budget', async () => {
    const h = harness();
    for (const marker of [1, 2, 3, 4]) await h.upload(PNG(marker));
    h.clock.now = '2026-03-08T10:00:01.000Z';
    const spend = (ms: number) => { h.clock.now = new Date(Date.parse(h.clock.now) + ms).toISOString(); };
    const waits: Array<number | undefined> = [];
    const deadlines: number[] = [];
    const images = h.deps.quarantinedImages;
    const quarantinedImages: typeof images = {
      ...images,
      release: (tenantId, selection, now, wait) => {
        waits.push(wait);
        spend(Math.min(wait ?? 0, 1_000));
        return images.release(tenantId, selection, now, wait);
      },
      finishRelease: (tenantId, asset, removeObject, now, wait) => {
        waits.push(wait);
        spend(Math.min(wait ?? 0, 1_000));
        return images.finishRelease(tenantId, asset, removeObject, now, wait);
      },
    };
    const storage: StorageProvider = {
      ...h.objects.storage,
      delete: async (input) => {
        const deadline = input.deadlineMs ?? Number.POSITIVE_INFINITY;
        deadlines.push(deadline);
        spend(Math.min(deadline, 3_000));
        return deadline < 3_000 ? err(integrationUnavailable('Could not reach S3.: the storage request deadline passed')) : h.objects.storage.delete(input);
      },
    };
    const started = Date.parse(h.clock.now);
    expect(await sweepQuarantinedImages({ ...h.deps, quarantinedImages, storage })).toMatchObject({ ok: true, value: { removed: 2 } });
    expect(waits).toEqual([4_000, 3_000]);
    expect(deadlines).toEqual([3_000, 5_000, 2_000]);
    expect(Date.parse(h.clock.now) - started).toBeLessThanOrEqual(10_000);
  });

  it('leaves the publication records of one workspace their share of the budget while quarantined deletes of another hang', async () => {
    const h = harness();
    const image = { kind: 'product-cover' as const, digest: sha256HexOfBytes(PNG(3)), extension: 'png' as const };
    const publicKey = `image-assets/${TENANT}/product-cover/${image.digest}.png`;
    h.objects.objects.set(publicKey, { bytes: PNG(3), contentType: 'image/png' });
    h.store.imagePublications.push({ tenantId: TENANT, attemptId: 'attempt-crashed', image, startedAt: NOW });
    for (const marker of [1, 2]) {
      h.store.releasedImageRows.push({
        tenantId: NEIGHBOUR, apiKeyId: NEIGHBOUR_KEY_ID, kind: 'product-cover', digest: sha256HexOfBytes(PNG(marker)), extension: 'png', sizeBytes: 10, createdAt: NOW,
      });
    }
    h.clock.now = '2026-03-01T10:11:00.000Z';
    const storage: StorageProvider = {
      ...h.objects.storage,
      delete: async (input) => {
        if (!input.url.includes('/image-asset-quarantine/')) return h.objects.storage.delete(input);
        h.clock.now = new Date(Date.parse(h.clock.now) + (input.deadlineMs ?? 0)).toISOString();
        return err(integrationUnavailable('Could not reach S3.: the storage request deadline passed'));
      },
    };

    expect(await sweepQuarantinedImages({ ...h.deps, storage })).toMatchObject({ ok: true, value: { removed: 1 } });
    expect(h.objects.keysUnder('image-assets/')).toEqual([]);
    expect(h.store.imagePublications).toEqual([]);
  });

  it('sweeps images never attached past the age bound and every image of a revoked key, keeping attached and young ones', async () => {
    const h = harness();
    const attached = await h.upload(PNG(1));
    await h.proposed('product.update', { id: 'product-mug', coverUrl: attached });
    await h.upload(PNG(2));
    h.clock.now = '2026-03-07T10:00:00.000Z';
    await h.upload(PNG(3));
    await h.upload(PNG(4), {}, keyCtx(OTHER_KEY_ID));
    const revoked = h.store.keys.find((key) => key.id === OTHER_KEY_ID);
    if (revoked === undefined) throw new Error('missing key');
    revoked.revokedAt = h.clock.now;
    h.clock.now = '2026-03-08T10:00:01.000Z';

    expect(await sweepQuarantinedImages(h.deps)).toEqual({ ok: true, value: { tenants: 1, removed: 6 } });
    expect(h.store.imageUploads).toEqual([]);
    expect(h.store.imageRows.map((row) => [row.apiKeyId, row.digest])).toEqual([
      [KEY_ID, sha256HexOfBytes(PNG(1))],
      [KEY_ID, sha256HexOfBytes(PNG(3))],
    ]);
    expect(h.quarantinedKeys()).toHaveLength(2);
  });
});

describe('the owner preview of a proposed image', () => {
  it('serves the quarantined bytes of an image the pending proposal attaches to the owner, inline for a raster image', async () => {
    const h = harness();
    const bytes = PNG(1);
    const cover = await h.upload(bytes);
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    expect(await getChangeProposalImage(ownerSession, { id, digest: sha256HexOfBytes(bytes) }, h.deps)).toEqual({
      ok: true,
      value: { bytes, contentType: 'image/png', disposition: 'inline', fileName: `${sha256HexOfBytes(bytes)}.png` },
    });
  });

  it('serves an SVG only as an attachment', async () => {
    const h = harness();
    const logo = await h.upload(SVG, { kind: 'logo', fileName: 'logo.svg', contentType: 'image/svg+xml' });
    const id = await h.proposed('settings.update', { logoUrl: logo });
    expect(await getChangeProposalImage(ownerSession, { id, digest: sha256HexOfBytes(SVG) }, h.deps))
      .toMatchObject({ ok: true, value: { contentType: 'image/svg+xml', disposition: 'attachment' } });
  });

  it('serves the published copy of an address an earlier approval published and a live field shows, and nothing once no field shows it', async () => {
    const h = harness();
    const bytes = PNG(1);
    const cover = await h.upload(bytes);
    const first = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    expect(await approveChangeProposal(ownerSession, { id: first }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(h.store.imageRows).toEqual([]);
    const again = await h.proposed('product.update', { id: 'product-live', coverUrl: cover });

    expect(await getChangeProposalImage(ownerSession, { id: again, digest: sha256HexOfBytes(bytes) }, h.deps)).toEqual({
      ok: true,
      value: { bytes, contentType: 'image/png', disposition: 'inline', fileName: `${sha256HexOfBytes(bytes)}.png` },
    });
    expect(await getChangeProposalImage({ identity: identity({ emailVerified: false }) }, { id: again, digest: sha256HexOfBytes(bytes) }, h.deps))
      .toMatchObject({ ok: false });

    const [published] = h.publicKeys();
    if (published === undefined) throw new Error('missing published image');
    h.objects.objects.set(published, { bytes: PNG(9), contentType: 'image/png' });
    expect(await getChangeProposalImage(ownerSession, { id: again, digest: sha256HexOfBytes(bytes) }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });

    const mug = h.state.products.find((candidate) => candidate.id === 'product-mug');
    if (mug === undefined) throw new Error('missing product');
    mug.coverUrl = null;
    h.objects.objects.set(published, { bytes, contentType: 'image/png' });
    expect(await getChangeProposalImage(ownerSession, { id: again, digest: sha256HexOfBytes(bytes) }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it.each([
    ['missing', (h: Harness, key: string) => { h.objects.objects.delete(key); }],
    ['no longer hashing to the digest', (h: Harness, key: string) => { h.objects.objects.set(key, { bytes: PNG(9), contentType: 'image/png' }); }],
  ])('makes an approval that reuses a live address stale, as the preview refuses it, when its public copy is %s', async (_label, damage) => {
    const h = harness();
    const bytes = PNG(1);
    const cover = await h.upload(bytes);
    const first = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    expect(await approveChangeProposal(ownerSession, { id: first }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    const again = await h.proposed('product.update', { id: 'product-live', coverUrl: cover });
    const [published] = h.publicKeys();
    if (published === undefined) throw new Error('missing published image');
    damage(h, published);

    expect(await getChangeProposalImage(ownerSession, { id: again, digest: sha256HexOfBytes(bytes) }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await approveChangeProposal(ownerSession, { id: again }, h.deps)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(h.store.eventRows.at(-1)).toMatchObject({ kind: 'stale', note: expect.stringContaining(`${cover} is no longer available`) });
    expect(liveCover(h, 'product-live')).toBe(LIVE_COVER);
    expect(h.store.imagePublications).toEqual([]);
  });

  it('writes the verified bytes again when the public copy of a still quarantined image no longer hashes to the digest', async () => {
    const h = harness();
    const bytes = PNG(1);
    const cover = await h.upload(bytes);
    const first = await h.proposed('product.update', { id: 'product-mug', coverUrl: cover });
    const second = await h.proposed('product.update', { id: 'product-live', coverUrl: cover });
    expect(await approveChangeProposal(ownerSession, { id: first }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    const [published] = h.publicKeys();
    if (published === undefined) throw new Error('missing published image');
    h.objects.objects.set(published, { bytes: PNG(9), contentType: 'image/png' });

    expect(await approveChangeProposal(ownerSession, { id: second }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(h.objects.objects.get(published)?.bytes).toEqual(bytes);
    expect(h.store.imagePublications).toEqual([]);
  });

  it.each([
    ['the proposing key', keyCtx()],
    ['a direct-mode key', keyCtx(KEY_ID, TENANT, 'direct')],
    ['an admin', { identity: identity({ staffRole: 'admin', userId: 'user-admin' }) }],
    ['an owner of another workspace', { identity: identity({ tenantId: NEIGHBOUR }) }],
  ])('refuses %s', async (_label, ctx) => {
    const h = harness();
    const bytes = PNG(1);
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: await h.upload(bytes) });
    expect(await getChangeProposalImage(ctx, { id, digest: sha256HexOfBytes(bytes) }, h.deps)).toMatchObject({ ok: false });
  });

  it('answers 404 when the quarantined object is gone and the storage error when the read fails', async () => {
    const h = harness();
    const bytes = PNG(1);
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: await h.upload(bytes) });
    const [quarantined] = h.quarantinedKeys();
    if (quarantined === undefined) throw new Error('missing quarantined image');
    h.objects.failReads = () => true;
    expect(await getChangeProposalImage(ownerSession, { id, digest: sha256HexOfBytes(bytes) }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    h.objects.failReads = () => false;
    h.objects.objects.delete(quarantined);
    expect(await getChangeProposalImage(ownerSession, { id, digest: sha256HexOfBytes(bytes) }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('serves nothing the proposal does not attach, and nothing once it is decided', async () => {
    const h = harness();
    const id = await h.proposed('product.update', { id: 'product-mug', coverUrl: await h.upload(PNG(1)) });
    const unrelated = await h.upload(PNG(2));
    expect(await getChangeProposalImage(ownerSession, { id, digest: sha256HexOfBytes(PNG(2)) }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(unrelated).toBe(pathOf(PNG(2)));
    expect(await rejectChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true });
    expect(await getChangeProposalImage(ownerSession, { id, digest: sha256HexOfBytes(PNG(1)) }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('the live image upload use-cases', () => {
  const live = [
    ['product cover', beginProductCoverUpload, completeProductCoverUpload, 'product-cover'],
    ['branding image', beginBrandingAssetUpload, completeBrandingAssetUpload, 'logo'],
  ] as const;

  it.each(live)('keep publishing a %s at once for an owner session and a direct-mode key', async (_label, begin, complete, kind) => {
    for (const ctx of [ownerSession, keyCtx(KEY_ID, TENANT, 'direct')]) {
      const h = harness();
      const started = await begin(ctx, { kind, fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 }, h.deps);
      if (!started.ok) throw new Error(started.error.message);
      h.objects.objects.set(started.value.key, { bytes: PNG(1), contentType: 'image/png' });
      const completed = await complete(ctx, { key: started.value.key }, h.deps);
      expect(completed).toEqual({ ok: true, value: { url: started.value.servePath } });
      expect(h.publicKeys()).toEqual([`image-assets/${TENANT}/${kind}/${started.value.key.split('/').at(-1) ?? ''}`]);
      expect(h.store.imageRows).toEqual([]);
    }
  });

  it.each(live)('still refuse a %s to a propose-mode key', async (_label, begin, complete, kind) => {
    const h = harness();
    expect(await begin(keyCtx(), { kind, fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await complete(keyCtx(), { key: `image-asset-candidates/${TENANT}/${kind}/00000000-0000-4000-8000-000000000001.png` }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('stores every public SVG as an attachment, so a storage that ignores the signed disposition still never renders it', async () => {
    const h = harness();
    const logo = await h.upload(SVG, { kind: 'logo', fileName: 'logo.svg', contentType: 'image/svg+xml' });
    const raster = await h.upload(PNG(1), { kind: 'logo-dark', fileName: 'dark.png' });
    const id = await h.proposed('settings.update', { logoUrl: logo, logoDarkUrl: raster });
    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(h.objects.objects.get(`image-assets/${TENANT}/logo/${sha256HexOfBytes(SVG)}.svg`)).toMatchObject({ contentType: 'image/svg+xml', contentDisposition: 'attachment' });
    expect(h.objects.objects.get(`image-assets/${TENANT}/logo-dark/${sha256HexOfBytes(PNG(1))}.png`)?.contentDisposition).toBeUndefined();

    const started = await beginBrandingAssetUpload(ownerSession, { kind: 'favicon', fileName: 'icon.svg', contentType: 'image/svg+xml', sizeBytes: SVG.byteLength }, h.deps);
    if (!started.ok) throw new Error(started.error.message);
    h.objects.objects.set(started.value.key, { bytes: SVG, contentType: 'image/svg+xml' });
    expect(await completeBrandingAssetUpload(ownerSession, { key: started.value.key }, h.deps)).toMatchObject({ ok: true });
    expect(h.objects.objects.get(`image-assets/${TENANT}/favicon/${started.value.key.split('/').at(-1) ?? ''}`))
      .toMatchObject({ contentType: 'image/svg+xml', contentDisposition: 'attachment' });
  });

  it('serves a published content-addressed image from the public route, an SVG only as an attachment', async () => {
    const h = harness();
    const digest = sha256HexOfBytes(PNG(1));
    expect(await getPublicImageAssetUrl(TENANT, { kind: 'product-cover', file: `${digest}.png` }, h.deps))
      .toMatchObject({ ok: true, value: expect.stringContaining(`image-assets/${TENANT}/product-cover/${digest}.png`) });
    expect(await getPublicImageAssetUrl(TENANT, { kind: 'logo', file: `${digest}.svg` }, h.deps))
      .toMatchObject({ ok: true, value: expect.stringContaining('response-content-disposition=attachment') });
    expect(await getPublicImageAssetUrl(TENANT, { kind: 'product-cover', file: `${digest.slice(1)}.png` }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
