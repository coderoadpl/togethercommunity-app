import { and, eq, isNull, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createContentHash } from '#adapters/crypto/content-hash.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import { createS3StorageProvider } from '#adapters/storage/s3.js';
import {
  CHANGE_PROPOSAL_IMAGE_FIELDS,
  changeProposalImageReferences,
  changeProposalsBusy,
  err,
  IMAGE_ASSET_MAX_BYTES,
  integrationUnavailable,
  ok,
  proposalImageKindSchema,
  storageDefiniteFailure,
  type AppError,
  type Identity,
  type ProposalImageExtension,
  type ProposalImageReference,
  type QuarantinedImageAsset,
  type Result,
  type ShopManagementKey,
} from '#core/domain/index.js';
import {
  approveChangeProposal,
  completeProposedProductCoverUpload,
  beginProposedProductCoverUpload,
  getPublicImageAssetUrl,
  releaseQuarantinedImages,
  shopManagementKeyCapabilities,
  submitChangeProposal,
  sweepQuarantinedImages,
  withdrawPublishedImages,
  type ChangeProposalTransaction,
  type ChangeProposalTransactionScope,
  type Ctx,
} from '#core/server/index.js';
import { createObjectStorageFake } from '#core/server/testing/object-storage-fake.js';

import { lockWorkspaceProposals } from './change-proposal-bounds.js';
import { createChangeProposalGroupRepository } from './change-proposal-groups.js';
import { createQuarantinedImageLocks, createQuarantinedImageRepository, quarantinedImagesPresent } from './change-proposal-images.js';
import { createChangeProposalOwnerNotifier, createChangeProposalPeopleReader } from './change-proposal-people.js';
import { createChangeProposalTransaction } from './change-proposal-transaction.js';
import { createChangeProposalRepository, createChangeProposalTargetLabelReader } from './change-proposals.js';
import { createKeyDownloadFileRepository } from './key-download-files.js';
import { createTenantSecretRepository } from './repositories.js';
import {
  changeProposalEvents,
  changeProposalImagePublications,
  changeProposalImages,
  changeProposalImageUploads,
  changeProposals,
  products,
  shopManagementKeys,
  tenants,
} from './schema.js';
import { createShopManagementKeyRepository } from './shop-management-keys.js';
import { createStorageReferenceRepository } from './storage-references.js';
import { createTestDatabase } from './test-database-name.js';

const TENANT = 't-change-proposal-images';
const NEIGHBOUR = 't-change-proposal-images-neighbour';
const NOW = '2026-03-01T10:00:00.000Z';
const OWNER = 'user-owner';
const ISSUER = 'user-issuer';
const KEY_ID = 'key-images';
const OTHER_KEY_ID = 'key-images-second';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let sequence = 0;

const key = (id: string, tenantId = TENANT): ShopManagementKey => ({
  id, tenantId, name: `Agent ${id}`, keyHash: `hash-${id}`,
  scopes: ['shop:catalog:read', 'shop:catalog:write', 'shop:settings:read', 'shop:settings:write'],
  mode: 'propose', issuedByUserId: ISSUER, createdAt: '2026-02-25T00:00:00.000Z', expiresAt: '2026-03-20T00:00:00.000Z', revokedAt: null,
});

const identity = (userId: string): Identity => ({
  userId, email: `${userId}@example.test`, name: userId, emailVerified: true, tenantAccess: 'staff',
  tenantId: TENANT, tenantSlug: 'images', tenantName: 'Images', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
});

const keyCtx: Ctx = {
  identity: identity(ISSUER),
  capabilities: shopManagementKeyCapabilities(key(KEY_ID)),
  machineActor: { kind: 'shop_management_key', apiKeyId: KEY_ID, mode: 'propose' },
};

const ownerSession: Ctx = { identity: identity(OWNER) };

const secretCrypto = createSecretCrypto(Buffer.alloc(32, 9).toString('base64'));

const digestOf = (index: number): string => index.toString(16).padStart(64, '0');

const image = (index: number, overrides: Partial<QuarantinedImageAsset> = {}): QuarantinedImageAsset => ({
  tenantId: TENANT, apiKeyId: KEY_ID, kind: 'product-cover', digest: digestOf(index), extension: 'png', sizeBytes: 10, createdAt: NOW,
  ...overrides,
});

const pathOf = (reference: ProposalImageReference): string =>
  `/api/public/assets/${reference.kind}/${reference.digest}.${reference.extension}`;

const stored = { present: async () => ok(true), store: async () => ok(undefined) };

const pendingProposal = async (
  id: string,
  input: Record<string, unknown>,
  values: { keyId?: string; expired?: boolean; status?: 'pending' | 'rejected' | 'applied'; operation?: string; tenantId?: string } = {},
) => {
  const status = values.status ?? 'pending';
  await database.db.insert(changeProposals).values({
    id, tenantId: values.tenantId ?? TENANT, operation: values.operation ?? 'product.update', input: { id: 'mug', ...input }, effect: {},
    targetKind: 'product', targetId: 'mug',
    status, proposedByKeyId: values.keyId ?? KEY_ID, proposedByKeyName: 'Agent', proposedByIssuerUserId: ISSUER,
    createdAt: values.expired === true ? '2026-01-01T10:00:00.000Z' : NOW,
    expiresAt: values.expired === true ? '2026-01-31T10:00:00.000Z' : '2026-03-31T10:00:00.000Z',
    ...(status === 'pending' ? {} : { decidedAt: NOW, decidedByUserId: OWNER }),
  });
};

const rows = async () => (await database.db.select().from(changeProposalImages).where(isNull(changeProposalImages.releasedAt)))
  .map((row) => `${row.tenantId}/${row.apiKeyId}/${row.digest.replace(/^0+/u, '')}`).sort();

const releasedRows = async () => (await database.db.select().from(changeProposalImages))
  .filter((row) => row.releasedAt !== null).map((row) => row.digest.replace(/^0+/u, '')).sort();

const lockWaiters = async (observer: pg.Client): Promise<number> => (await observer.query<{ count: number }>(
  "select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
)).rows[0]?.count ?? 0;

const untilWaiting = async (observer: pg.Client, what: string): Promise<void> => {
  for (const deadline = Date.now() + 10_000; await lockWaiters(observer) < 1;) {
    if (Date.now() > deadline) throw new Error(`${what} never waited`);
  }
};

beforeAll(async () => {
  database = await createTestDatabase('together_change_proposal_images', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values([
    { id: TENANT, slug: 'images', name: 'Images', createdAt: NOW },
    { id: NEIGHBOUR, slug: 'images-neighbour', name: 'Neighbour', createdAt: NOW },
  ]);
  await createTenantSecretRepository(database.db).upsert(TENANT, {
    id: 'storage-configuration', tenantId: TENANT, key: 's3.configuration', maskedPreview: 'configured', updatedAt: NOW,
    ...secretCrypto.encrypt(JSON.stringify({
      provider: 'aws_s3', endpoint: 'https://storage.example.test', region: 'auto', bucket: 'assets', accessKeyId: 'a', secretAccessKey: 's',
    })),
  });
});

afterAll(async () => { await database?.close(); });

beforeEach(async () => {
  for (const table of [changeProposalImages, changeProposalImageUploads, changeProposalImagePublications, changeProposalEvents, changeProposals, shopManagementKeys, products]) {
    await database.db.delete(table);
  }
  for (const created of [key(KEY_ID), key(OTHER_KEY_ID), key('key-neighbour', NEIGHBOUR)]) {
    await createShopManagementKeyRepository(database.db).create(created.tenantId, created, {
      id: `key-event-${String(++sequence)}`, tenantId: created.tenantId, apiKeyId: created.id, kind: 'created', actorUserId: ISSUER,
      method: null, route: null, resourceId: null, at: created.createdAt,
    });
  }
  await database.db.insert(products).values({
    id: 'mug', tenantId: TENANT, slug: 'mug', title: 'Mug', type: 'physical', description: '', priceCents: 0, currency: 'EUR', createdAt: NOW,
  });
  await database.db.update(tenants).set({ logoUrl: null }).where(eq(tenants.id, TENANT));
});

describe('the quarantined image repository', () => {
  it('records an image once for its key and workspace', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    expect(await repository.insert(TENANT, image(1), stored)).toEqual({ kind: 'stored', asset: image(1) });
    expect(await repository.insert(TENANT, image(1, { createdAt: '2026-03-02T10:00:00.000Z' }), stored)).toEqual({ kind: 'existing', asset: image(1) });
    expect(await repository.find(TENANT, KEY_ID, image(1))).toEqual(image(1));
    expect(await repository.find(TENANT, OTHER_KEY_ID, image(1))).toBeNull();
    expect(await repository.find(NEIGHBOUR, KEY_ID, image(1))).toBeNull();
    await expect(repository.insert(NEIGHBOUR, image(2), stored)).rejects.toThrow('another tenant');
  });

  it('lets only one of two concurrent completions take the last image slot of a key', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await database.db.insert(changeProposalImages).values(Array.from({ length: 99 }, (_unused, index) => image(index + 100)));
    const outcomes = await Promise.all([repository.insert(TENANT, image(1), stored), repository.insert(TENANT, image(2), stored)]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['cap_exceeded', 'stored']);
    expect(outcomes.find((outcome) => outcome.kind === 'cap_exceeded')).toEqual({ kind: 'cap_exceeded', cap: 'key_quarantined_images' });
    expect((await database.db.select().from(changeProposalImages).where(eq(changeProposalImages.apiKeyId, KEY_ID))).length).toBe(100);
    expect(await repository.insert(TENANT, image(3, { apiKeyId: OTHER_KEY_ID }), stored)).toMatchObject({ kind: 'stored' });
  });

  it('lets only one of two concurrent completions take the last bytes of a key', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await database.db.insert(changeProposalImages).values(Array.from({ length: 9 }, (_unused, index) => image(index + 100, { sizeBytes: IMAGE_ASSET_MAX_BYTES })));
    const outcomes = await Promise.all([
      repository.insert(TENANT, image(1, { sizeBytes: 3 * 1024 * 1024 }), stored),
      repository.insert(TENANT, image(2, { sizeBytes: 3 * 1024 * 1024 }), stored),
    ]);
    expect(outcomes.map((outcome) => outcome.kind === 'cap_exceeded' ? outcome.cap : outcome.kind).sort()).toEqual(['key_quarantined_bytes', 'stored']);
  });

  it('releases only the images no pending, unexpired proposal of their own key references', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    for (const index of [1, 2, 3, 4]) await repository.insert(TENANT, image(index), stored);
    await pendingProposal('p-pending', { coverUrl: pathOf(image(1)) });
    await pendingProposal('p-expired', { coverUrl: pathOf(image(2)) }, { expired: true });
    await pendingProposal('p-rejected', { coverUrl: pathOf(image(3)) }, { status: 'rejected' });
    await pendingProposal('p-other-key', { coverUrl: pathOf(image(4)) }, { keyId: OTHER_KEY_ID });

    const released = await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID }, NOW);
    expect(released.kind === 'written' ? released.value.map((row) => row.digest) : released).toEqual([digestOf(2), digestOf(3), digestOf(4)]);
    expect(await rows()).toEqual([`${TENANT}/${KEY_ID}/1`]);
    expect(await releasedRows()).toEqual(['2', '3', '4']);
    expect(await repository.find(TENANT, KEY_ID, image(2))).toBeNull();
    expect(await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID, images: [] }, NOW)).toEqual({ kind: 'written', value: [] });
  });

  it('sweeps images past the age bound and every image of a revoked or deleted key, across workspaces', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await repository.insert(TENANT, image(1, { createdAt: '2026-02-01T10:00:00.000Z' }), stored);
    await repository.insert(TENANT, image(2), stored);
    await repository.insert(TENANT, image(3, { apiKeyId: OTHER_KEY_ID }), stored);
    await repository.insert(TENANT, image(4, { apiKeyId: 'key-deleted' }), stored);
    await repository.insert(NEIGHBOUR, image(5, { tenantId: NEIGHBOUR, apiKeyId: 'key-neighbour' }), stored);
    await repository.insert(TENANT, image(6, { createdAt: '2026-02-01T10:00:00.000Z' }), stored);
    await pendingProposal('p-attached', { coverUrl: pathOf(image(6)) });
    await database.db.update(shopManagementKeys).set({ revokedAt: NOW }).where(eq(shopManagementKeys.id, OTHER_KEY_ID));
    const createdBefore = '2026-02-22T10:00:00.000Z';

    expect(await repository.listTenantIdsToSweep(createdBefore, NOW, 10)).toEqual([TENANT]);
    const released = await repository.release(TENANT, { kind: 'sweep', createdBefore, limit: 1 }, NOW);
    expect(released.kind === 'written' ? released.value.map((row) => row.digest) : released).toEqual([digestOf(1)]);
    const rest = await repository.release(TENANT, { kind: 'sweep', createdBefore, limit: 10 }, NOW);
    expect(rest.kind === 'written' ? rest.value.map((row) => row.digest).sort() : rest).toEqual([digestOf(1), digestOf(3), digestOf(4)]);
    expect(await rows()).toEqual([`${NEIGHBOUR}/key-neighbour/5`, `${TENANT}/${KEY_ID}/2`, `${TENANT}/${KEY_ID}/6`]);
  });

  it('tells whether a live product cover or branding field shows an address', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    expect(await repository.inLiveUse(TENANT, pathOf(image(1)))).toBe(false);
    await database.db.update(products).set({ coverUrl: pathOf(image(1)) }).where(eq(products.id, 'mug'));
    await database.db.update(tenants).set({ logoUrl: pathOf(image(2, { kind: 'logo' })) }).where(eq(tenants.id, TENANT));
    expect(await repository.inLiveUse(TENANT, pathOf(image(1)))).toBe(true);
    expect(await repository.inLiveUse(TENANT, pathOf(image(2, { kind: 'logo' })))).toBe(true);
    expect(await repository.inLiveUse(NEIGHBOUR, pathOf(image(1)))).toBe(false);
  });

  it('refuses to store a proposal whose image is no longer quarantined for its key', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await repository.insert(TENANT, image(1), stored);
    const proposals = createChangeProposalRepository(database.db);
    const proposal = (id: string) => ({
      id, tenantId: TENANT, groupId: null, groupPosition: null, operation: 'product.update', input: { id: 'mug', coverUrl: pathOf(image(1)) },
      effect: { coverUrl: { before: null, after: pathOf(image(1)) } }, target: { kind: 'product' as const, id: 'mug' }, status: 'pending' as const,
      proposedByKeyId: KEY_ID, proposedByKeyName: 'Agent', proposedByIssuerUserId: ISSUER, createdAt: NOW, expiresAt: '2026-03-31T10:00:00.000Z',
      decidedByUserId: null, decidedAt: null, decisionNote: null, appliedResourceId: null, failureCode: null, failureMessage: null,
    });
    const event = (id: string) => ({ id, actorUserId: null, apiKeyId: KEY_ID, note: null, at: NOW });
    expect(await proposals.create(TENANT, proposal('p-gone'), event('e-gone'), NOW, [image(2)])).toEqual({ kind: 'image_missing' });
    expect(await proposals.create(TENANT, { ...proposal('p-other'), proposedByKeyId: OTHER_KEY_ID }, event('e-other'), NOW, [image(1)])).toEqual({ kind: 'image_missing' });
    expect(await proposals.create(TENANT, proposal('p-kept'), event('e-kept'), NOW, [image(1)])).toMatchObject({ kind: 'created' });
  });

  it('makes a release wait for an approval holding the image, then sees the approval and releases it', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await repository.insert(TENANT, image(1), stored);
    await pendingProposal('p-approving', { coverUrl: pathOf(image(1)) });
    const observer = new pg.Client({ connectionString: database.url });
    await observer.connect();
    let releaseApproval: () => void = () => undefined;
    const approvalMayCommit = new Promise<void>((resolve) => { releaseApproval = resolve; });
    let locked: () => void = () => undefined;
    const imageLocked = new Promise<void>((resolve) => { locked = resolve; });
    try {
      const approval = database.db.transaction(async (tx) => {
        expect(await createQuarantinedImageLocks(tx).lockForPublication(TENANT, KEY_ID, image(1))).toEqual(image(1));
        locked();
        await approvalMayCommit;
        await tx.update(changeProposals).set({ status: 'applied', decidedAt: NOW, decidedByUserId: OWNER }).where(eq(changeProposals.id, 'p-approving'));
      });
      await imageLocked;
      const release = repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID, images: [image(1)] }, NOW);
      await untilWaiting(observer, 'The release');
      releaseApproval();
      await approval;
      expect(await release).toEqual({ kind: 'written', value: [image(1)] });
    } finally {
      releaseApproval();
      await observer.end();
    }
  });

  it('keeps an image a proposal stored meanwhile references, because the release queues behind the insert', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await repository.insert(TENANT, image(1), stored);
    const observer = new pg.Client({ connectionString: database.url });
    await observer.connect();
    let releaseInsert: () => void = () => undefined;
    const insertMayCommit = new Promise<void>((resolve) => { releaseInsert = resolve; });
    let checked: () => void = () => undefined;
    const imageChecked = new Promise<void>((resolve) => { checked = resolve; });
    try {
      const insert = database.db.transaction(async (tx) => {
        expect(await lockWorkspaceProposals(tx, TENANT, { lockWaitMs: 10_000 })).toBe(true);
        expect(await quarantinedImagesPresent(tx, TENANT, KEY_ID, [image(1)])).toBe(true);
        checked();
        await insertMayCommit;
        await tx.insert(changeProposals).values({
          id: 'p-new', tenantId: TENANT, operation: 'product.update', input: { id: 'mug', coverUrl: pathOf(image(1)) }, effect: {},
          targetKind: 'product', targetId: 'mug', status: 'pending', proposedByKeyId: KEY_ID, proposedByKeyName: 'Agent',
          proposedByIssuerUserId: ISSUER, createdAt: NOW, expiresAt: '2026-03-31T10:00:00.000Z',
        });
      });
      await imageChecked;
      const release = repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID }, NOW);
      await untilWaiting(observer, 'The release');
      releaseInsert();
      await insert;
      expect(await release).toEqual({ kind: 'written', value: [] });
      expect(await rows()).toEqual([`${TENANT}/${KEY_ID}/1`]);
    } finally {
      releaseInsert();
      await observer.end();
    }
  });

  it('lists quarantined objects the database records in the storage reference inventory', async () => {
    await createQuarantinedImageRepository(database.db).insert(TENANT, image(1), stored);
    const inventory = await createStorageReferenceRepository(database.db).readInventory(TENANT);
    expect(inventory.quarantinedImages).toEqual([{ storageKey: `image-asset-quarantine/${TENANT}/${KEY_ID}/product-cover/${digestOf(1)}.png` }]);
    expect((await createStorageReferenceRepository(database.db).readInventory(NEIGHBOUR)).quarantinedImages).toEqual([]);
  });
});

const endToEnd = (lockWait: { lockWaitMs?: number } = {}) => {
  const objects = createObjectStorageFake();
  const logger = { error: vi.fn<(message: string) => void>() };
  const secretResolver = createTenantSecretResolver(createTenantSecretRepository(database.db), secretCrypto);
  const clock = { now: NOW };
  let ids = 0;
  const deps = {
    changeProposalTransaction: createChangeProposalTransaction(database.db, logger, (connection) =>
      createTenantSecretResolver(createTenantSecretRepository(connection), secretCrypto), lockWait),
    changeProposals: createChangeProposalRepository(database.db),
    changeProposalGroups: createChangeProposalGroupRepository(database.db),
    shopManagementKeys: createShopManagementKeyRepository(database.db),
    changeProposalTargetLabels: createChangeProposalTargetLabelReader(database.db),
    changeProposalPeople: createChangeProposalPeopleReader(database.db),
    changeProposalOwnerNotifier: createChangeProposalOwnerNotifier(database.db),
    realtimeBus: { publish: () => undefined },
    quarantinedImages: createQuarantinedImageRepository(database.db, lockWait),
    keyDownloadFiles: createKeyDownloadFileRepository(database.db, lockWait),
    storage: objects.storage,
    secretResolver,
    contentHash: createContentHash(),
    logger,
    ids: { nextId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` },
    clock: { nowIso: () => clock.now },
  };
  const proposeCover = async (bytes: Uint8Array): Promise<{ id: string; url: string }> => {
    const started = await beginProposedProductCoverUpload(keyCtx, { kind: 'product-cover', fileName: 'c.png', contentType: 'image/png', sizeBytes: bytes.byteLength }, deps);
    if (!started.ok) throw new Error(started.error.message);
    objects.objects.set(started.value.key, { bytes, contentType: 'image/png' });
    const completed = await completeProposedProductCoverUpload(keyCtx, { key: started.value.key }, deps);
    if (!completed.ok) throw new Error(completed.error.message);
    const submitted = await submitChangeProposal(keyCtx, { operation: 'product.update', input: { id: 'mug', coverUrl: completed.value.url } }, deps);
    if (!submitted.ok) throw new Error(submitted.error.message);
    return { id: submitted.value.id, url: completed.value.url };
  };
  return { objects, logger, clock, deps, proposeCover };
};

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 42]);

describe('a proposed product cover end to end on the database', () => {
  it('quarantines the upload, proposes it, publishes the verified bytes on approval and releases the quarantined copy', async () => {
    const { objects, logger, deps } = endToEnd();
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 42]);
    const started = await beginProposedProductCoverUpload(keyCtx, { kind: 'product-cover', fileName: 'c.png', contentType: 'image/png', sizeBytes: bytes.byteLength }, deps);
    if (!started.ok) throw new Error(started.error.message);
    objects.objects.set(started.value.key, { bytes, contentType: 'image/png' });
    const completed = await completeProposedProductCoverUpload(keyCtx, { key: started.value.key }, deps);
    if (!completed.ok) throw new Error(completed.error.message);
    const digest = createContentHash().sha256(bytes);
    expect(completed.value).toEqual({ url: `/api/public/assets/product-cover/${digest}.png`, quarantined: true });
    expect(objects.keysUnder('image-assets/')).toEqual([]);

    const submitted = await submitChangeProposal(keyCtx, { operation: 'product.update', input: { id: 'mug', coverUrl: completed.value.url } }, deps);
    if (!submitted.ok) throw new Error(submitted.error.message);
    expect(objects.keysUnder('image-assets/')).toEqual([]);

    expect(await approveChangeProposal(ownerSession, { id: submitted.value.id }, deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    const [cover] = await database.db.select({ coverUrl: products.coverUrl }).from(products).where(and(eq(products.tenantId, TENANT), eq(products.id, 'mug')));
    expect(cover?.coverUrl).toBe(completed.value.url);
    const published = objects.objects.get(`image-assets/${TENANT}/product-cover/${digest}.png`);
    expect(published?.bytes).toEqual(bytes);
    expect(createContentHash().sha256(published?.bytes ?? new Uint8Array())).toBe(digest);
    expect(objects.keysUnder('image-asset-quarantine/')).toEqual([]);
    expect(await rows()).toEqual([]);
    expect(await database.db.select().from(changeProposalImagePublications)).toEqual([]);
    expect(objects.signedLengths.get(started.value.key)).toBe(bytes.byteLength);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('records the completed image on the upload, so a repeated completion gets the same answer once the candidate is gone', async () => {
    const { objects, deps } = endToEnd();
    const started = await beginProposedProductCoverUpload(keyCtx, { kind: 'product-cover', fileName: 'c.png', contentType: 'image/png', sizeBytes: PNG_BYTES.byteLength }, deps);
    if (!started.ok) throw new Error(started.error.message);
    objects.objects.set(started.value.key, { bytes: PNG_BYTES, contentType: 'image/png' });
    const first = await completeProposedProductCoverUpload(keyCtx, { key: started.value.key }, deps);
    expect(first).toMatchObject({ ok: true, value: { quarantined: true } });
    expect(objects.keysUnder('image-asset-candidates/')).toEqual([]);

    expect(await completeProposedProductCoverUpload(keyCtx, { key: started.value.key }, deps)).toEqual(first);
    const digest = createContentHash().sha256(PNG_BYTES);
    expect(await deps.quarantinedImages.findUpload(TENANT, started.value.key)).toMatchObject({ completed: { digest, extension: 'png' } });
    expect(await deps.quarantinedImages.findUpload(NEIGHBOUR, started.value.key)).toBeNull();
    await deps.quarantinedImages.markUploadCompleted(NEIGHBOUR, started.value.key, { digest: digestOf(9), extension: 'png' });
    expect(await deps.quarantinedImages.findUpload(TENANT, started.value.key)).toMatchObject({ completed: { digest, extension: 'png' } });
  });
});

const publications = async () => (await database.db.select().from(changeProposalImagePublications)).map((row) => row.digest.replace(/^0+/u, ''));

const failingOnce = (
  transaction: ChangeProposalTransaction,
  beforeRollback: () => Promise<void> = async () => undefined,
): ChangeProposalTransaction & { armed: boolean } => {
  const wrapped = {
    armed: true,
    dryRun: transaction.dryRun,
    run: <T>(tenantId: string, operation: (scope: ChangeProposalTransactionScope) => Promise<Result<T, AppError>>) => transaction.run<T>(tenantId, async (scope) => {
      const result = await operation(scope);
      if (!wrapped.armed || !result.ok) return result;
      wrapped.armed = false;
      await beforeRollback();
      return err(changeProposalsBusy());
    }),
  };
  return wrapped;
};

describe('public copies of an approval that did not end applied', () => {
  it('stay recorded when the withdrawal cannot delete them, and the sweep removes them after the bound', async () => {
    const harness = endToEnd();
    const { id, url } = await harness.proposeCover(PNG_BYTES);
    const file = `${createContentHash().sha256(PNG_BYTES)}.png`;
    const publicKey = `image-assets/${TENANT}/product-cover/${file}`;
    const publicRead = () => getPublicImageAssetUrl(TENANT, { kind: 'product-cover', file }, harness.deps);
    let readBeforeRollback: Awaited<ReturnType<typeof publicRead>> | null = null;
    const transaction = failingOnce(harness.deps.changeProposalTransaction, async () => {
      expect(harness.objects.keysUnder('image-assets/')).toEqual([publicKey]);
      readBeforeRollback = await publicRead();
    });
    harness.objects.failDeletes = (objectKey) => objectKey.startsWith('image-assets/');

    expect(await approveChangeProposal(ownerSession, { id }, { ...harness.deps, changeProposalTransaction: transaction }))
      .toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(readBeforeRollback).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(harness.objects.keysUnder('image-assets/')).toEqual([publicKey]);
    expect(await publications()).toHaveLength(1);
    expect(await publicRead()).toMatchObject({ ok: false, error: { code: 'not_found' } });

    harness.objects.failDeletes = () => false;
    harness.clock.now = '2026-03-01T10:14:00.000Z';
    await sweepQuarantinedImages(harness.deps);
    expect(harness.objects.keysUnder('image-assets/')).toEqual([publicKey]);
    expect(await publicRead()).toMatchObject({ ok: false, error: { code: 'not_found' } });
    harness.clock.now = '2026-03-01T10:16:00.000Z';
    expect(await sweepQuarantinedImages(harness.deps)).toMatchObject({ ok: true, value: { tenants: 1 } });
    expect(harness.objects.keysUnder('image-assets/')).toEqual([]);
    expect(await publications()).toEqual([]);

    expect(await approveChangeProposal(ownerSession, { id }, harness.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(harness.objects.keysUnder('image-assets/')).toEqual([publicKey]);
    expect(await publications()).toEqual([]);
    expect(await publicRead()).toMatchObject({ ok: true, value: expect.stringContaining(publicKey) });
    const [cover] = await database.db.select({ coverUrl: products.coverUrl }).from(products).where(eq(products.id, 'mug'));
    expect(cover?.coverUrl).toBe(url);
  });

  it('keeps a recorded address that a live field shows or an applied proposal carries, and drops only the record', async () => {
    const harness = endToEnd();
    const live = image(1);
    const applied = image(2);
    const orphan = image(3);
    for (const reference of [live, applied, orphan]) {
      harness.objects.objects.set(`image-assets/${TENANT}/product-cover/${reference.digest}.png`, { bytes: PNG_BYTES, contentType: 'image/png' });
    }
    await database.db.update(products).set({ coverUrl: pathOf(live) }).where(eq(products.id, 'mug'));
    await pendingProposal('p-applied', { coverUrl: pathOf(applied) }, { status: 'applied' });
    await createQuarantinedImageRepository(database.db).recordPublications(TENANT, 'attempt-crashed', [live, applied, orphan], NOW);

    harness.clock.now = '2026-03-01T10:16:00.000Z';
    expect(await sweepQuarantinedImages(harness.deps)).toMatchObject({ ok: true, value: { removed: 3 } });
    expect(harness.objects.keysUnder('image-assets/')).toEqual([live, applied].map((reference) => `image-assets/${TENANT}/product-cover/${reference.digest}.png`));
    expect(await publications()).toEqual([]);
  });

  it('deletes a recorded address that an applied proposal mentions only in a text field', async () => {
    const harness = endToEnd();
    const mentioned = image(1);
    const publicKey = `image-assets/${TENANT}/product-cover/${mentioned.digest}.png`;
    harness.objects.objects.set(publicKey, { bytes: PNG_BYTES, contentType: 'image/png' });
    await pendingProposal('p-applied-text', { description: `See ${pathOf(mentioned)} soon` }, { status: 'applied' });
    await pendingProposal('p-applied-settings', { logoUrl: pathOf(mentioned) }, { status: 'applied', operation: 'settings.update' });
    await createQuarantinedImageRepository(database.db).recordPublications(TENANT, 'attempt-crashed', [mentioned], NOW);

    harness.clock.now = '2026-03-01T10:16:00.000Z';
    expect(await sweepQuarantinedImages(harness.deps)).toMatchObject({ ok: true, value: { removed: 1 } });
    expect(harness.objects.keysUnder('image-assets/')).toEqual([]);
    expect(await publications()).toEqual([]);
  });

  it('never removes a record while an approval holds the workspace lock, and removes it once the lock is free', async () => {
    const harness = endToEnd({ lockWaitMs: 200 });
    harness.objects.objects.set(`image-assets/${TENANT}/product-cover/${digestOf(1)}.png`, { bytes: PNG_BYTES, contentType: 'image/png' });
    await createQuarantinedImageRepository(database.db).recordPublications(TENANT, 'attempt-running', [image(1)], NOW);
    harness.clock.now = '2026-03-01T10:16:00.000Z';
    const approval = new pg.Client({ connectionString: database.url });
    await approval.connect();
    try {
      await approval.query('begin');
      await approval.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`change-proposal-transaction:${TENANT}`]);
      expect(await sweepQuarantinedImages(harness.deps)).toMatchObject({ ok: true, value: { removed: 0 } });
      expect(harness.objects.keysUnder('image-assets/')).toHaveLength(1);
      expect(await publications()).toEqual(['1']);
      await approval.query('commit');
      expect(await sweepQuarantinedImages(harness.deps)).toMatchObject({ ok: true, value: { removed: 1 } });
      expect(harness.objects.keysUnder('image-assets/')).toEqual([]);
    } finally {
      await approval.end();
    }
  });

  it('lets a sweep that listed a record before another sweep marked its delete send nothing and leave the mark', async () => {
    const harness = endToEnd();
    const publicKey = `image-assets/${TENANT}/product-cover/${digestOf(1)}.png`;
    harness.objects.objects.set(publicKey, { bytes: PNG_BYTES, contentType: 'image/png' });
    await createQuarantinedImageRepository(database.db).recordPublications(TENANT, 'attempt-crashed', [image(1)], NOW);
    harness.clock.now = '2026-03-01T10:16:00.000Z';
    const deletes: string[] = [];
    const deleteObject = harness.objects.storage.delete;
    const deps = {
      ...harness.deps,
      storage: {
        ...harness.objects.storage,
        delete: async (input: Parameters<typeof deleteObject>[0]) => {
          deletes.push(input.url);
          return deletes.length === 1 ? err(integrationUnavailable('Could not reach S3.: the storage request deadline passed')) : deleteObject(input);
        },
      },
    };
    const holder = new pg.Client({ connectionString: database.url });
    const observer = new pg.Client({ connectionString: database.url });
    await holder.connect();
    await observer.connect();
    try {
      await holder.query('begin');
      await holder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`change-proposal-transaction:${TENANT}`]);
      const sweeps = [sweepQuarantinedImages(deps), sweepQuarantinedImages(deps)];
      for (const deadline = Date.now() + 10_000; await lockWaiters(observer) < 2;) {
        if (Date.now() > deadline) throw new Error('The two sweeps never both waited');
      }
      await holder.query('commit');
      await Promise.all(sweeps);
    } finally {
      await holder.end();
      await observer.end();
    }
    expect(deletes).toHaveLength(1);
    expect(harness.objects.keysUnder('image-assets/')).toEqual([publicKey]);
    expect(await database.db.select({ unresolvedAt: changeProposalImagePublications.deleteUnresolvedAt }).from(changeProposalImagePublications))
      .toEqual([{ unresolvedAt: expect.any(String) }]);
  });

  it('lets a sweep whose delete outlived the record bound change nothing once a later sweep took the record over', async () => {
    const harness = endToEnd();
    const publicKey = `image-assets/${TENANT}/product-cover/${digestOf(1)}.png`;
    harness.objects.objects.set(publicKey, { bytes: PNG_BYTES, contentType: 'image/png' });
    await createQuarantinedImageRepository(database.db).recordPublications(TENANT, 'attempt-crashed', [image(1)], NOW);
    const deleteObject = harness.objects.storage.delete;
    const gates: Array<{ open: () => void; started: Promise<void> }> = [];
    const opened: Array<Promise<void>> = [];
    const starters: Array<() => void> = [];
    for (let index = 0; index < 2; index += 1) {
      let open: () => void = () => undefined;
      opened.push(new Promise<void>((resolve) => { open = resolve; }));
      let start: () => void = () => undefined;
      gates.push({ open, started: new Promise<void>((resolve) => { start = resolve; }) });
      starters.push(start);
    }
    let sent = 0;
    const storage = {
      ...harness.objects.storage,
      delete: async (input: Parameters<typeof deleteObject>[0]) => {
        const index = sent;
        sent += 1;
        starters[index]?.();
        await opened[index];
        return deleteObject(input);
      },
    };
    const at = (now: string) => ({ ...harness.deps, storage, clock: { nowIso: () => now } });
    const marks = async () => database.db.select({ unresolvedAt: changeProposalImagePublications.deleteUnresolvedAt, attemptedAt: changeProposalImagePublications.sweepAttemptedAt })
      .from(changeProposalImagePublications);
    try {
      const earlier = sweepQuarantinedImages(at('2026-03-01T10:16:00.000Z'));
      await gates[0]?.started;
      const later = sweepQuarantinedImages(at('2026-03-01T10:32:00.000Z'));
      await gates[1]?.started;
      gates[0]?.open();
      expect(await earlier).toMatchObject({ ok: true, value: { removed: 0 } });
      expect(await marks()).toEqual([{ unresolvedAt: '2026-03-01T10:32:00.000Z', attemptedAt: null }]);
      gates[1]?.open();
      expect(await later).toMatchObject({ ok: true, value: { removed: 1 } });
      expect(await marks()).toEqual([]);
    } finally {
      for (const gate of gates) gate.open();
    }
  });

  it('leaves the mark of a sweep delete in flight to that sweep when a withdrawal of the same record runs', async () => {
    const harness = endToEnd();
    await createQuarantinedImageRepository(database.db).recordPublications(TENANT, 'attempt-slow', [image(1)], NOW);
    const sweepMark = '2026-03-01T10:16:00.000Z';
    await createQuarantinedImageLocks(database.db).markDeleteUnresolved(TENANT, 'attempt-slow', image(1), sweepMark);
    const publication = { attemptId: 'attempt-slow', images: [image(1)], startedAt: NOW, reused: [] };
    for (const written of [false, true]) {
      await withdrawPublishedImages(TENANT, publication, { written: written ? [image(1)] : [], unconfirmed: [] }, harness.deps);
      expect(await database.db.select({ unresolvedAt: changeProposalImagePublications.deleteUnresolvedAt }).from(changeProposalImagePublications))
        .toEqual([{ unresolvedAt: sweepMark }]);
    }
  });

  it('commits the delete mark before the withdrawal sends its delete, so a delete that outlives its process keeps the address from reuse', async () => {
    const harness = endToEnd();
    const { id } = await harness.proposeCover(PNG_BYTES);
    const publicKey = `image-assets/${TENANT}/product-cover/${createContentHash().sha256(PNG_BYTES)}.png`;
    const deleteObject = harness.objects.storage.delete;
    let land: () => Promise<unknown> = async () => undefined;
    const dying = {
      ...harness.deps,
      changeProposalTransaction: failingOnce(harness.deps.changeProposalTransaction),
      storage: {
        ...harness.objects.storage,
        delete: async (input: Parameters<typeof deleteObject>[0]) => {
          if (!input.url.includes('/image-assets/')) return deleteObject(input);
          land = () => deleteObject(input);
          throw new Error('Connection terminated unexpectedly');
        },
      },
    };
    expect(await approveChangeProposal(ownerSession, { id }, dying)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(harness.objects.keysUnder('image-assets/')).toEqual([publicKey]);
    expect(await approveChangeProposal(ownerSession, { id }, harness.deps)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    await land();
    const [cover] = await database.db.select({ coverUrl: products.coverUrl }).from(products).where(eq(products.id, 'mug'));
    expect(cover?.coverUrl).toBeNull();
    expect(await database.db.select({ unresolvedAt: changeProposalImagePublications.deleteUnresolvedAt }).from(changeProposalImagePublications))
      .toEqual([{ unresolvedAt: NOW }]);
  });

  it('keeps a record no withdrawal restarted until the write window and the provider grace after its intent have passed', async () => {
    const harness = endToEnd();
    const publicKey = `image-assets/${TENANT}/product-cover/${digestOf(1)}.png`;
    await createQuarantinedImageRepository(database.db).recordPublications(TENANT, 'attempt-crashed', [image(1)], NOW);
    harness.clock.now = '2026-03-01T10:11:00.000Z';
    expect(await sweepQuarantinedImages(harness.deps)).toMatchObject({ ok: true, value: { removed: 0 } });
    expect(await publications()).toEqual(['1']);
    harness.objects.objects.set(publicKey, { bytes: PNG_BYTES, contentType: 'image/png' });
    harness.clock.now = '2026-03-01T10:14:59.000Z';
    expect(await sweepQuarantinedImages(harness.deps)).toMatchObject({ ok: true, value: { removed: 0 } });
    harness.clock.now = '2026-03-01T10:15:01.000Z';
    expect(await sweepQuarantinedImages(harness.deps)).toMatchObject({ ok: true, value: { removed: 1 } });
    expect(harness.objects.keysUnder('image-assets/')).toEqual([]);
    expect(await publications()).toEqual([]);
  });

  it('writes nothing when the record of its attempt is gone by the time it holds the lock', async () => {
    const harness = endToEnd();
    const { id } = await harness.proposeCover(PNG_BYTES);
    const transaction: ChangeProposalTransaction = {
      dryRun: harness.deps.changeProposalTransaction.dryRun,
      run: async (tenantId, operation) => {
        await database.db.delete(changeProposalImagePublications);
        return harness.deps.changeProposalTransaction.run(tenantId, operation);
      },
    };
    expect(await approveChangeProposal(ownerSession, { id }, { ...harness.deps, changeProposalTransaction: transaction }))
      .toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(harness.objects.keysUnder('image-assets/')).toEqual([]);
    expect(await approveChangeProposal(ownerSession, { id }, harness.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
  });
});

describe('uploads a propose-mode key starts', () => {
  const upload = (index: number, createdAt: string, apiKeyId = KEY_ID) => ({
    apiKeyId, objectKey: `image-asset-candidates/${TENANT}/product-cover/00000000-0000-4000-8000-${String(index).padStart(12, '0')}.png`, createdAt,
  });

  it('lets only one of two concurrent begins take the last upload slot of a key, counting only uploads inside the window', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await database.db.insert(changeProposalImageUploads).values([
      ...Array.from({ length: 59 }, (_unused, index) => ({ tenantId: TENANT, ...upload(index + 100, '2026-03-01T09:50:00.000Z') })),
      { tenantId: TENANT, ...upload(1, '2026-03-01T09:40:00.000Z') },
    ]);
    const countedAfter = '2026-03-01T09:45:00.000Z';
    const outcomes = await Promise.all([
      repository.recordUpload(TENANT, upload(2, NOW), countedAfter),
      repository.recordUpload(TENANT, upload(3, NOW), countedAfter),
    ]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['cap_exceeded', 'recorded']);
    expect(outcomes.find((outcome) => outcome.kind === 'cap_exceeded')).toEqual({ kind: 'cap_exceeded', cap: 'key_image_uploads' });
    expect(await repository.recordUpload(TENANT, upload(4, NOW, OTHER_KEY_ID), countedAfter)).toEqual({ kind: 'recorded' });
  });

  it('removes the candidate object of every upload past its lifetime and the margin, completed or not, and keeps younger ones and the record until a second delete', async () => {
    const harness = endToEnd();
    await harness.proposeCover(PNG_BYTES);
    const [recorded] = await database.db.select().from(changeProposalImageUploads);
    if (recorded === undefined) throw new Error('missing upload record');
    harness.objects.objects.set(recorded.objectKey, { bytes: PNG_BYTES, contentType: 'image/png' });
    harness.clock.now = '2026-03-01T10:16:00.000Z';
    const abandoned = await beginProposedProductCoverUpload(keyCtx, { kind: 'product-cover', fileName: 'c.png', contentType: 'image/png', sizeBytes: 9 }, harness.deps);
    if (!abandoned.ok) throw new Error(abandoned.error.message);
    harness.objects.objects.set(abandoned.value.key, { bytes: PNG_BYTES, contentType: 'image/png' });

    harness.clock.now = '2026-03-01T10:21:00.000Z';
    await sweepQuarantinedImages(harness.deps);
    expect(harness.objects.keysUnder('image-asset-candidates/')).toEqual([abandoned.value.key]);
    expect(await database.db.select({ objectKey: changeProposalImageUploads.objectKey, firstDeletedAt: changeProposalImageUploads.firstDeletedAt })
      .from(changeProposalImageUploads).orderBy(changeProposalImageUploads.createdAt))
      .toEqual([{ objectKey: recorded.objectKey, firstDeletedAt: '2026-03-01T10:21:00.000Z' }, { objectKey: abandoned.value.key, firstDeletedAt: null }]);
    harness.clock.now = '2026-03-01T10:37:00.000Z';
    await sweepQuarantinedImages(harness.deps);
    expect(harness.objects.keysUnder('image-asset-candidates/')).toEqual([]);
    expect((await database.db.select().from(changeProposalImageUploads)).map((row) => row.objectKey)).toEqual([abandoned.value.key]);
    harness.objects.objects.set(abandoned.value.key, { bytes: PNG_BYTES, contentType: 'image/png' });
    harness.clock.now = '2026-03-01T10:48:00.000Z';
    await sweepQuarantinedImages(harness.deps);
    expect(harness.objects.keysUnder('image-asset-candidates/')).toEqual([]);
    expect(await database.db.select().from(changeProposalImageUploads)).toEqual([]);
  });
});

describe('quarantined rows and objects of one key', () => {
  it('lets a completion revive a released row, so the release finish leaves its object and row', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await repository.insert(TENANT, image(1), stored);
    expect(await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID }, NOW)).toEqual({ kind: 'written', value: [image(1)] });
    expect(await repository.find(TENANT, KEY_ID, image(1))).toBeNull();
    const revivedAt = '2026-03-01T11:00:00.000Z';
    expect(await repository.insert(TENANT, image(1, { createdAt: revivedAt }), stored)).toEqual({ kind: 'stored', asset: image(1, { createdAt: revivedAt }) });
    const removeObject = vi.fn(async () => 'deleted' as const);
    expect(await repository.finishRelease(TENANT, image(1), removeObject, NOW)).toBe('revived');
    expect(removeObject).not.toHaveBeenCalled();
    expect(await rows()).toEqual([`${TENANT}/${KEY_ID}/1`]);
  });

  it('leaves a row a completion is writing to that completion: a release finish, a second completion and a release keep off it', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await repository.insert(TENANT, image(1), stored);
    await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID }, NOW);
    let finishWrite: () => void = () => undefined;
    const writeMayFinish = new Promise<void>((resolve) => { finishWrite = resolve; });
    let writing: () => void = () => undefined;
    const writeStarted = new Promise<void>((resolve) => { writing = resolve; });
    try {
      const completion = repository.insert(TENANT, image(1), {
        ...stored,
        store: async () => {
          writing();
          await writeMayFinish;
          return ok(undefined);
        },
      });
      await writeStarted;
      const removeObject = vi.fn(async () => 'deleted' as const);
      expect(await repository.finishRelease(TENANT, image(1), removeObject, NOW)).toBe('revived');
      expect(await repository.insert(TENANT, image(1), stored)).toEqual({ kind: 'busy' });
      expect(await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID }, NOW)).toEqual({ kind: 'written', value: [] });
      expect(await repository.find(TENANT, KEY_ID, image(1))).toBeNull();
      finishWrite();
      expect(await completion).toMatchObject({ kind: 'stored' });
      expect(removeObject).not.toHaveBeenCalled();
      expect(await repository.find(TENANT, KEY_ID, image(1))).toEqual(image(1));
    } finally {
      finishWrite();
    }
  });

  it('gives up a release, a release finish and a withdrawal transaction once the lock wait a sweep passes ran out, below a long own bound', async () => {
    const repository = createQuarantinedImageRepository(database.db, { lockWaitMs: 60_000 });
    const harness = endToEnd({ lockWaitMs: 60_000 });
    await repository.insert(TENANT, image(1), stored);
    await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID }, NOW);
    const holder = new pg.Client({ connectionString: database.url });
    await holder.connect();
    try {
      await holder.query('begin');
      for (const name of [`change-proposal-images:${TENANT}:${KEY_ID}`, `change-proposals:${TENANT}`, `change-proposal-transaction:${TENANT}`]) {
        await holder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [name]);
      }
      const removeObject = vi.fn(async () => 'deleted' as const);
      expect(await repository.finishRelease(TENANT, image(1), removeObject, NOW, 50)).toBe('busy');
      expect(await repository.release(TENANT, { kind: 'sweep', createdBefore: NOW, limit: 10 }, NOW, 50)).toEqual({ kind: 'busy' });
      const operation = vi.fn(async () => ok(true));
      expect(await harness.deps.changeProposalTransaction.run(TENANT, operation, { lockWaitMs: 50 })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
      expect(removeObject).not.toHaveBeenCalled();
      expect(operation).not.toHaveBeenCalled();
      await holder.query('rollback');
    } finally {
      await holder.end();
    }
    expect(await releasedRows()).toEqual(['1']);
  }, 15_000);

  it('rolls back the row when the storage refused its object, and keeps a released row released', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    const refused = { ...stored, store: async () => err(storageDefiniteFailure('S3 refused the published image with status 403')) };
    expect(await repository.insert(TENANT, image(1), refused)).toMatchObject({ kind: 'store_failed', error: { code: 'integration_unavailable' } });
    expect(await rows()).toEqual([]);
    await repository.insert(TENANT, image(2), stored);
    await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID }, NOW);
    expect(await repository.insert(TENANT, image(2), refused)).toMatchObject({ kind: 'store_failed' });
    expect(await releasedRows()).toEqual(['2']);
  });

  it('keeps a row pending while its object is written again, and written once the storage stored or refused that write', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await repository.insert(TENANT, image(1), stored);
    const seenDuringWrite: Array<QuarantinedImageAsset | null> = [];
    const repair = (answer: Result<void, AppError>) => ({
      present: async () => ok(false),
      store: async () => {
        seenDuringWrite.push(await repository.find(TENANT, KEY_ID, image(1)));
        return answer;
      },
    });
    expect(await repository.insert(TENANT, image(1, { createdAt: '2026-03-01T10:05:00.000Z' }), repair(ok(undefined)))).toEqual({ kind: 'existing', asset: image(1) });
    expect(await repository.insert(TENANT, image(1, { createdAt: '2026-03-01T10:06:00.000Z' }), repair(err(storageDefiniteFailure('S3 refused the published image with status 403')))))
      .toMatchObject({ kind: 'store_failed' });
    expect(seenDuringWrite).toEqual([null, null]);
    expect(await repository.find(TENANT, KEY_ID, image(1))).toEqual(image(1));
  });

  it('hides a released row from the submit check and the approval lock but counts it toward the limits until its object is deleted', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await database.db.insert(changeProposalImages).values(Array.from({ length: 100 }, (_unused, index) => image(index + 100)));
    expect(await repository.insert(TENANT, image(1), stored)).toEqual({ kind: 'cap_exceeded', cap: 'key_quarantined_images' });
    await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID, images: [image(100)] }, NOW);
    expect(await repository.insert(TENANT, image(1), stored)).toEqual({ kind: 'cap_exceeded', cap: 'key_quarantined_images' });
    expect(await repository.insert(TENANT, image(100), stored)).toMatchObject({ kind: 'stored' });
    await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID, images: [image(100)] }, NOW);
    await database.db.transaction(async (tx) => {
      expect(await createQuarantinedImageLocks(tx).lockForPublication(TENANT, KEY_ID, image(100))).toBeNull();
    });
    expect(await repository.finishRelease(TENANT, image(100), async () => 'failed' as const, NOW)).toBe('failed');
    expect(await repository.insert(TENANT, image(1), stored)).toEqual({ kind: 'cap_exceeded', cap: 'key_quarantined_images' });
    const retried = await repository.release(TENANT, { kind: 'sweep', createdBefore: '2026-01-01T00:00:00.000Z', limit: 10 }, NOW);
    expect(retried).toEqual({ kind: 'written', value: [image(100)] });
    expect(await repository.listTenantIdsToSweep('2026-01-01T00:00:00.000Z', NOW, 10)).toEqual([TENANT]);
    expect(await repository.finishRelease(TENANT, image(100), async () => 'deleted' as const, NOW)).toBe('removed');
    expect(await releasedRows()).toEqual([]);
    expect(await repository.insert(TENANT, image(1), stored)).toMatchObject({ kind: 'stored' });
  });

  it('counts the bytes of released rows whose object is not deleted yet', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await database.db.insert(changeProposalImages).values(Array.from({ length: 10 }, (_unused, index) => image(index + 100, { sizeBytes: IMAGE_ASSET_MAX_BYTES })));
    await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID }, NOW);
    expect(await repository.insert(TENANT, image(1), stored)).toEqual({ kind: 'cap_exceeded', cap: 'key_quarantined_bytes' });
  });

  it('keeps a released row whose delete had no definite answer from revival and from the sweep until the bound, then deletes it again', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await repository.insert(TENANT, image(1), stored);
    await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID }, NOW);
    expect(await repository.finishRelease(TENANT, image(1), async () => 'unresolved' as const, NOW)).toBe('failed');
    const store = vi.fn(stored.store);
    expect(await repository.insert(TENANT, image(1), { ...stored, store })).toEqual({ kind: 'busy' });
    expect(store).not.toHaveBeenCalled();
    const early = '2026-03-01T10:09:00.000Z';
    expect(await repository.listTenantIdsToSweep('2026-01-01T00:00:00.000Z', early, 10)).toEqual([]);
    const removeObject = vi.fn(async () => 'deleted' as const);
    expect(await repository.finishRelease(TENANT, image(1), removeObject, early)).toBe('busy');
    expect(removeObject).not.toHaveBeenCalled();
    const late = '2026-03-01T10:11:00.000Z';
    expect(await repository.release(TENANT, { kind: 'sweep', createdBefore: '2026-01-01T00:00:00.000Z', limit: 10 }, late)).toEqual({ kind: 'written', value: [image(1)] });
    expect(await repository.finishRelease(TENANT, image(1), removeObject, late)).toBe('removed');
    expect(await repository.insert(TENANT, image(1), stored)).toMatchObject({ kind: 'stored' });
  });

  it('commits the delete mark of a released row before its delete is sent, and clears it when the storage refuses the delete', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await repository.insert(TENANT, image(1), stored);
    await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID }, NOW);
    await expect(repository.finishRelease(TENANT, image(1), async () => { throw new Error('Connection terminated unexpectedly'); }, NOW))
      .rejects.toThrow('Connection terminated unexpectedly');
    const store = vi.fn(stored.store);
    expect(await repository.insert(TENANT, image(1), { ...stored, store })).toEqual({ kind: 'busy' });
    expect(store).not.toHaveBeenCalled();
    const late = '2026-03-01T10:11:00.000Z';
    expect(await repository.finishRelease(TENANT, image(1), async () => 'failed' as const, late)).toBe('failed');
    expect(await database.db.select({ unresolvedAt: changeProposalImages.deleteUnresolvedAt, attemptedAt: changeProposalImages.sweepAttemptedAt })
      .from(changeProposalImages)).toEqual([{ unresolvedAt: null, attemptedAt: late }]);
    expect(await repository.insert(TENANT, image(1), stored)).toMatchObject({ kind: 'stored' });
  });

  it('releases a row a completion left pending even while a pending proposal repeats its address unchanged', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    const unanswered = { ...stored, store: async () => err(integrationUnavailable('Could not reach S3.: the storage request deadline passed')) };
    expect(await repository.insert(TENANT, image(1), unanswered)).toMatchObject({ kind: 'store_failed' });
    await pendingProposal('p-title', { title: 'Renamed', coverUrl: pathOf(image(1)) });
    const late = '2026-03-01T10:11:00.000Z';
    expect(await repository.listTenantIdsToSweep('2026-01-01T00:00:00.000Z', late, 10)).toEqual([TENANT]);
    expect(await repository.release(TENANT, { kind: 'sweep', createdBefore: '2026-01-01T00:00:00.000Z', limit: 10 }, late))
      .toEqual({ kind: 'written', value: [image(1)] });
    expect(await releasedRows()).toEqual(['1']);
    expect(await repository.finishRelease(TENANT, image(1), async () => 'deleted' as const, late)).toBe('removed');
    expect(await database.db.select().from(changeProposalImages)).toEqual([]);
  });

  it.each(['deleted', 'failed', 'unresolved'] as const)('lets a release finish whose delete outlived the grace and ended %s change nothing once a later finish took the row over', async (outcome) => {
    const repository = createQuarantinedImageRepository(database.db);
    await repository.insert(TENANT, image(1), stored);
    await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID }, NOW);
    const gate = () => {
      let open: () => void = () => undefined;
      const opened = new Promise<void>((resolve) => { open = resolve; });
      let started: () => void = () => undefined;
      const running = new Promise<void>((resolve) => { started = resolve; });
      return { open, opened, started, running };
    };
    const first = gate();
    const second = gate();
    const late = '2026-03-01T10:11:00.000Z';
    try {
      const earlier = repository.finishRelease(TENANT, image(1), async () => { first.started(); await first.opened; return outcome; }, NOW);
      await first.running;
      const later = repository.finishRelease(TENANT, image(1), async () => { second.started(); await second.opened; return 'deleted' as const; }, late);
      await second.running;
      first.open();
      expect(await earlier).toBe('busy');
      expect(await database.db.select({ unresolvedAt: changeProposalImages.deleteUnresolvedAt, attemptedAt: changeProposalImages.sweepAttemptedAt })
        .from(changeProposalImages)).toEqual([{ unresolvedAt: late, attemptedAt: null }]);
      second.open();
      expect(await later).toBe('removed');
      expect(await database.db.select().from(changeProposalImages)).toEqual([]);
    } finally {
      first.open();
      second.open();
    }
  });

  it('marks a publication record whose delete had no definite answer, blocks its address and lists it by that time', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await repository.recordPublications(TENANT, 'attempt-unresolved', [image(1)], NOW);
    const locks = createQuarantinedImageLocks(database.db);
    expect(await locks.deleteUnresolved(TENANT, image(1))).toBe(false);
    const deletedAt = '2026-03-01T10:20:00.000Z';
    await locks.markDeleteUnresolved(TENANT, 'attempt-unresolved', image(1), deletedAt);
    expect(await locks.deleteUnresolved(TENANT, image(1))).toBe(true);
    expect(await locks.deleteUnresolved(NEIGHBOUR, image(1))).toBe(false);
    expect(await locks.deleteUnresolved(TENANT, image(2))).toBe(false);
    expect(await repository.listPublicationsBefore(TENANT, '2026-03-01T10:15:00.000Z', 10)).toEqual([]);
    expect(await repository.listTenantIdsWithPublicationsBefore('2026-03-01T10:15:00.000Z', 10)).toEqual([]);
    expect(await repository.listPublicationsBefore(TENANT, '2026-03-01T10:30:01.000Z', 10)).toMatchObject([{ attemptId: 'attempt-unresolved' }]);
  });
});

describe('a completion of bytes the key already holds', () => {
  it('writes the quarantined object again only when the storage no longer has it with the recorded size', async () => {
    const harness = endToEnd();
    const complete = async () => {
      const started = await beginProposedProductCoverUpload(keyCtx, { kind: 'product-cover', fileName: 'c.png', contentType: 'image/png', sizeBytes: PNG_BYTES.byteLength }, harness.deps);
      if (!started.ok) throw new Error(started.error.message);
      harness.objects.objects.set(started.value.key, { bytes: PNG_BYTES, contentType: 'image/png' });
      return completeProposedProductCoverUpload(keyCtx, { key: started.value.key }, harness.deps);
    };
    const quarantinedKey = `image-asset-quarantine/${TENANT}/${KEY_ID}/product-cover/${createContentHash().sha256(PNG_BYTES)}.png`;
    const writes = () => harness.objects.calls.filter((call) => call.method === 'putObject' && call.key === quarantinedKey).length;
    expect(await complete()).toMatchObject({ ok: true });
    expect(writes()).toBe(1);
    expect(await complete()).toMatchObject({ ok: true });
    expect(writes()).toBe(1);
    harness.objects.objects.set(quarantinedKey, { bytes: PNG_BYTES.slice(0, 4), contentType: 'image/png' });
    expect(await complete()).toMatchObject({ ok: true });
    expect(writes()).toBe(2);
    harness.objects.objects.delete(quarantinedKey);
    expect(await complete()).toMatchObject({ ok: true });
    expect(writes()).toBe(3);
    expect(harness.objects.objects.get(quarantinedKey)?.bytes).toEqual(PNG_BYTES);
  });
});

describe('a delete the storage refuses', () => {
  it('leaves no unresolved mark on a released row or a publication record when the S3 storage answers AccessDenied', async () => {
    const harness = endToEnd();
    const requests: string[] = [];
    const storage = createS3StorageProvider(harness.deps.secretResolver, {
      lookupAddresses: async () => ['93.184.216.34'],
      fetchStorage: async (_url, init) => {
        requests.push(init.method);
        return {
          ok: false, status: 403, headers: { get: () => null }, body: { cancel: async () => undefined }, text: async () => '<Error><Code>AccessDenied</Code></Error>',
        };
      },
    });
    const repository = createQuarantinedImageRepository(database.db);
    await repository.insert(TENANT, image(1), stored);
    await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID }, NOW);
    await repository.recordPublications(TENANT, 'attempt-crashed', [image(2)], NOW);
    harness.clock.now = '2026-03-01T10:16:00.000Z';
    expect(await sweepQuarantinedImages({ ...harness.deps, storage })).toMatchObject({ ok: true, value: { removed: 0 } });
    expect(requests).toEqual(['DELETE', 'DELETE']);
    expect(await database.db.select({ unresolvedAt: changeProposalImages.deleteUnresolvedAt }).from(changeProposalImages)).toEqual([{ unresolvedAt: null }]);
    expect(await database.db.select({ unresolvedAt: changeProposalImagePublications.deleteUnresolvedAt }).from(changeProposalImagePublications))
      .toEqual([{ unresolvedAt: null }]);
    expect(await repository.insert(TENANT, image(1), stored)).toMatchObject({ kind: 'stored' });
  });
});

describe('a delete the storage answers with 404', () => {
  const answering404 = (body: string) => {
    const requests: string[] = [];
    const bytes = new TextEncoder().encode(body);
    const fetchStorage = async (_url: string, init: { method: string }) => {
      requests.push(init.method);
      let delivered = false;
      return {
        ok: false, status: 404, headers: { get: () => null }, text: async () => body,
        body: {
          cancel: async () => undefined,
          getReader: () => ({
            read: async () => {
              if (delivered || bytes.byteLength === 0) return { done: true };
              delivered = true;
              return { done: false, value: bytes };
            },
            cancel: async () => undefined,
            releaseLock: () => undefined,
          }),
        },
      };
    };
    return { requests, fetchStorage };
  };

  const owedDeletes = async (body: string) => {
    const harness = endToEnd();
    const answer = answering404(body);
    const storage = createS3StorageProvider(harness.deps.secretResolver, { lookupAddresses: async () => ['93.184.216.34'], fetchStorage: answer.fetchStorage });
    const repository = createQuarantinedImageRepository(database.db);
    await repository.insert(TENANT, image(1), stored);
    await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID }, NOW);
    expect(await repository.finishRelease(TENANT, image(1), async () => 'unresolved' as const, NOW)).toBe('failed');
    await repository.recordPublications(TENANT, 'attempt-lost-reply', [image(2)], NOW);
    await createQuarantinedImageLocks(database.db).markDeleteUnresolved(TENANT, 'attempt-lost-reply', image(2), NOW);
    harness.clock.now = '2026-03-01T10:31:00.000Z';
    const swept = await sweepQuarantinedImages({ ...harness.deps, storage });
    expect(answer.requests).toEqual(['DELETE', 'DELETE']);
    return { swept, repository };
  };

  it('retires a released row and a publication record whose earlier delete had no definite answer once the storage names the key missing', async () => {
    const { swept, repository } = await owedDeletes('<Error><Code>NoSuchKey</Code></Error>');
    expect(swept).toMatchObject({ ok: true, value: { removed: 2 } });
    expect(await database.db.select().from(changeProposalImages)).toEqual([]);
    expect(await database.db.select().from(changeProposalImagePublications)).toEqual([]);
    expect(await repository.insert(TENANT, image(1), stored)).toMatchObject({ kind: 'stored' });
  });

  it.each([
    ['an empty body', ''],
    ['a proxy page', '<html><body>Not Found</body></html>'],
    ['a missing bucket', '<Error><Code>NoSuchBucket</Code></Error>'],
  ])('keeps a released row and a publication record counted and marked when the 404 carries %s', async (_label, body) => {
    const { swept, repository } = await owedDeletes(body);
    expect(swept).toMatchObject({ ok: true, value: { removed: 0 } });
    expect(await database.db.select({ releasedAt: changeProposalImages.releasedAt, unresolvedAt: changeProposalImages.deleteUnresolvedAt }).from(changeProposalImages))
      .toEqual([{ releasedAt: expect.any(String), unresolvedAt: '2026-03-01T10:31:00.000Z' }]);
    expect(await database.db.select({ unresolvedAt: changeProposalImagePublications.deleteUnresolvedAt }).from(changeProposalImagePublications))
      .toEqual([{ unresolvedAt: '2026-03-01T10:31:00.000Z' }]);
    expect(await repository.insert(TENANT, image(1), stored)).toEqual({ kind: 'busy' });
  });
});

describe('a quarantined write that outlives its completion', () => {
  const quarantinedKey = `image-asset-quarantine/${TENANT}/${KEY_ID}/product-cover/${createContentHash().sha256(PNG_BYTES)}.png`;
  const reference: ProposalImageReference = { kind: 'product-cover', digest: createContentHash().sha256(PNG_BYTES), extension: 'png' };

  const sweptAfterTheBound = async (harness: ReturnType<typeof endToEnd>) => {
    expect(harness.objects.keysUnder('image-asset-quarantine/')).toEqual([quarantinedKey]);
    expect(await rows()).toEqual([`${TENANT}/${KEY_ID}/${reference.digest.replace(/^0+/u, '')}`]);
    expect(await createQuarantinedImageRepository(database.db).find(TENANT, KEY_ID, reference)).toBeNull();
    harness.clock.now = '2026-03-01T10:09:00.000Z';
    await sweepQuarantinedImages(harness.deps);
    expect(harness.objects.keysUnder('image-asset-quarantine/')).toEqual([quarantinedKey]);
    harness.clock.now = '2026-03-01T10:11:00.000Z';
    await sweepQuarantinedImages(harness.deps);
    expect(harness.objects.keysUnder('image-asset-quarantine/')).toEqual([]);
    expect(await database.db.select().from(changeProposalImages)).toEqual([]);
  };

  it('stays counted when the storage stored the bytes but answered an error, and the sweep removes it after the bound', async () => {
    const harness = endToEnd();
    const put = harness.objects.storage.putObject;
    harness.objects.storage.putObject = async (input) => {
      const written = await put(input);
      return written.ok && input.url.includes('/image-asset-quarantine/') ? err(integrationUnavailable('S3 rejected the published image')) : written;
    };
    await expect(harness.proposeCover(PNG_BYTES)).rejects.toThrow('S3 rejected the published image');
    await sweptAfterTheBound(harness);
  });

  it('stays counted when the process dies after the write, before the row is committed, and the sweep removes it after the bound', async () => {
    const harness = endToEnd();
    const put = harness.objects.storage.putObject;
    harness.objects.storage.putObject = async (input) => {
      const written = await put(input);
      if (input.url.includes('/image-asset-quarantine/')) throw new Error('Connection terminated unexpectedly');
      return written;
    };
    await expect(harness.proposeCover(PNG_BYTES)).rejects.toThrow('Connection terminated unexpectedly');
    await sweptAfterTheBound(harness);
  });

  it('keeps the row of a repair write whose answer was lost pending and counted, so a release leaves it and the sweep removes the late copy', async () => {
    const harness = endToEnd();
    const complete = async () => {
      const started = await beginProposedProductCoverUpload(keyCtx, { kind: 'product-cover', fileName: 'c.png', contentType: 'image/png', sizeBytes: PNG_BYTES.byteLength }, harness.deps);
      if (!started.ok) throw new Error(started.error.message);
      harness.objects.objects.set(started.value.key, { bytes: PNG_BYTES, contentType: 'image/png' });
      return completeProposedProductCoverUpload(keyCtx, { key: started.value.key }, harness.deps);
    };
    expect(await complete()).toMatchObject({ ok: true });
    harness.objects.objects.delete(quarantinedKey);
    const put = harness.objects.storage.putObject;
    let land: () => Promise<unknown> = async () => undefined;
    harness.objects.storage.putObject = async (input) => {
      if (!input.url.includes('/image-asset-quarantine/')) return put(input);
      land = () => put(input);
      return err(integrationUnavailable('Could not reach S3.: the storage request deadline passed'));
    };
    expect(await complete()).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    harness.objects.storage.putObject = put;
    await releaseQuarantinedImages(TENANT, { kind: 'key', apiKeyId: KEY_ID }, harness.deps);
    await land();
    await sweptAfterTheBound(harness);
  });
});

describe('the sweep selection', () => {
  const OLD = '2026-02-01T10:00:00.000Z';
  const createdBefore = '2026-02-22T10:00:00.000Z';

  it('skips more attached old rows than one batch holds and releases the unattached one behind them', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    for (const index of [1, 2, 3, 4]) {
      await repository.insert(TENANT, image(index, { createdAt: OLD }), stored);
      await pendingProposal(`p-attached-${String(index)}`, { coverUrl: pathOf(image(index)) });
    }
    await repository.insert(TENANT, image(5, { createdAt: '2026-02-02T10:00:00.000Z' }), stored);
    expect(await repository.release(TENANT, { kind: 'sweep', createdBefore, limit: 3 }, NOW))
      .toEqual({ kind: 'written', value: [image(5, { createdAt: '2026-02-02T10:00:00.000Z' })] });
  });

  it('skips more workspaces with only attached old rows than one run lists and finds the sweepable one behind them', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await repository.insert(TENANT, image(1, { createdAt: OLD }), stored);
    await pendingProposal('p-attached', { coverUrl: pathOf(image(1)) });
    await repository.insert(NEIGHBOUR, image(2, { tenantId: NEIGHBOUR, apiKeyId: 'key-neighbour', createdAt: OLD }), stored);
    expect(await repository.listTenantIdsToSweep(createdBefore, NOW, 1)).toEqual([NEIGHBOUR]);
  });

  it('agrees with the image references of every image field of every operation', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    const extensions: ProposalImageExtension[] = ['png', 'jpg', 'webp', 'svg', 'ico'];
    const candidates = proposalImageKindSchema.options.flatMap((kind) => extensions.map((extension, index) =>
      image(proposalImageKindSchema.options.indexOf(kind) * 10 + index + 1, { kind, extension })));
    await database.db.insert(changeProposalImages).values(candidates);
    const operations = [...new Set(CHANGE_PROPOSAL_IMAGE_FIELDS.map(({ operation }) => operation)), 'sales-link.update'];
    const fields = [...new Set(CHANGE_PROPOSAL_IMAGE_FIELDS.map(({ field }) => field))];
    let compared = 0;
    for (const operation of operations) {
      for (const field of fields) {
        for (const candidate of candidates) {
          const values = candidate === candidates[0] ? [pathOf(candidate), `${pathOf(candidate)}?`, pathOf(candidate).toUpperCase()] : [pathOf(candidate)];
          for (const value of values) {
            const input = { [field]: value };
            await pendingProposal('p-walk', input, { operation });
            const released = await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID, images: [candidate] }, NOW);
            const releasedBySql = released.kind === 'written' && released.value.length === 1;
            const attachedByCode = changeProposalImageReferences(operation, { id: 'mug', ...input }).length > 0;
            expect({ operation, field, value, attached: !releasedBySql }).toEqual({ operation, field, value, attached: attachedByCode });
            await database.db.update(changeProposalImages).set({ releasedAt: null });
            await database.db.delete(changeProposals);
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBe(operations.length * fields.length * (candidates.length + 2));
  }, 120_000);
});

describe('the order of the image sweep', () => {
  const released = (index: number, tenantId: string, createdAt: string) => ({
    ...image(index, { tenantId, apiKeyId: tenantId === TENANT ? KEY_ID : 'key-neighbour', createdAt }), releasedAt: NOW,
  });
  const LATER = '2026-03-01T10:05:00.000Z';

  it('moves a released image whose deletion fails behind the later images of its workspace', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await database.db.insert(changeProposalImages).values([released(1, TENANT, '2026-03-01T09:00:00.000Z'), released(2, TENANT, '2026-03-01T09:30:00.000Z')]);
    const sweep = { kind: 'sweep', createdBefore: '2026-02-01T00:00:00.000Z', limit: 1 } as const;
    const first = await repository.release(TENANT, sweep, NOW);
    expect(first).toMatchObject({ kind: 'written', value: [{ digest: digestOf(1) }] });
    expect(await repository.finishRelease(TENANT, image(1, { createdAt: '2026-03-01T09:00:00.000Z' }), async () => 'failed' as const, LATER)).toBe('failed');
    expect(await repository.release(TENANT, sweep, NOW)).toMatchObject({ kind: 'written', value: [{ digest: digestOf(2) }] });
  });

  it('moves a workspace whose image deletions fail behind the other workspaces', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await database.db.insert(changeProposalImages).values([released(1, TENANT, '2026-03-01T09:00:00.000Z'), released(2, NEIGHBOUR, '2026-03-01T09:30:00.000Z')]);
    expect(await repository.listTenantIdsToSweep('2026-02-01T00:00:00.000Z', NOW, 1)).toEqual([TENANT]);
    await repository.finishRelease(TENANT, image(1), async () => 'failed' as const, LATER);
    expect(await repository.listTenantIdsToSweep('2026-02-01T00:00:00.000Z', NOW, 1)).toEqual([NEIGHBOUR]);
  });

  it('moves upload records and publication records whose removal fails behind the others, inside and across workspaces', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    const upload = (index: number, tenantId: string, createdAt: string) => ({
      tenantId, apiKeyId: KEY_ID, objectKey: `image-asset-candidates/${tenantId}/product-cover/00000000-0000-4000-8000-${String(index).padStart(12, '0')}.png`, createdAt,
    });
    await database.db.insert(changeProposalImageUploads).values([
      upload(1, TENANT, '2026-03-01T09:00:00.000Z'), upload(2, TENANT, '2026-03-01T09:10:00.000Z'), upload(3, NEIGHBOUR, '2026-03-01T09:20:00.000Z'),
    ]);
    const before = '2026-03-01T09:50:00.000Z';
    expect(await repository.listUploadsBefore(TENANT, before, before, 1)).toMatchObject([{ objectKey: upload(1, TENANT, NOW).objectKey }]);
    expect(await repository.listTenantIdsWithUploadsBefore(before, before, 1)).toEqual([TENANT]);
    await repository.markUploadAttempted(TENANT, upload(1, TENANT, NOW).objectKey, LATER);
    expect(await repository.listUploadsBefore(TENANT, before, before, 1)).toMatchObject([{ objectKey: upload(2, TENANT, NOW).objectKey }]);
    await repository.markUploadAttempted(TENANT, upload(2, TENANT, NOW).objectKey, LATER);
    expect(await repository.listTenantIdsWithUploadsBefore(before, before, 1)).toEqual([NEIGHBOUR]);

    await repository.recordPublications(TENANT, 'attempt-failing', [image(1)], '2026-03-01T09:00:00.000Z');
    await repository.recordPublications(TENANT, 'attempt-later', [image(2)], '2026-03-01T09:10:00.000Z');
    await repository.recordPublications(NEIGHBOUR, 'attempt-neighbour', [image(3)], '2026-03-01T09:20:00.000Z');
    expect(await repository.listPublicationsBefore(TENANT, before, 1)).toMatchObject([{ attemptId: 'attempt-failing' }]);
    await repository.markPublicationAttempted(TENANT, 'attempt-failing', image(1), LATER);
    expect(await repository.listPublicationsBefore(TENANT, before, 1)).toMatchObject([{ attemptId: 'attempt-later' }]);
    await repository.markPublicationAttempted(TENANT, 'attempt-later', image(2), LATER);
    expect(await repository.listTenantIdsWithPublicationsBefore(before, 1)).toEqual([NEIGHBOUR]);
  });

  it('writes the attempt time of every row whose removal failed during a sweep', async () => {
    const harness = endToEnd();
    harness.clock.now = '2026-03-01T10:30:00.000Z';
    await database.db.insert(changeProposalImages).values(released(1, TENANT, NOW));
    await database.db.insert(changeProposalImageUploads).values({ tenantId: TENANT, apiKeyId: KEY_ID, objectKey: `image-asset-candidates/${TENANT}/product-cover/u.png`, createdAt: NOW });
    await createQuarantinedImageRepository(database.db).recordPublications(TENANT, 'attempt-crashed', [image(2)], NOW);
    harness.objects.objects.set(`image-assets/${TENANT}/product-cover/${digestOf(2)}.png`, { bytes: PNG_BYTES, contentType: 'image/png' });
    harness.objects.failDeletes = () => true;
    expect(await sweepQuarantinedImages(harness.deps)).toMatchObject({ ok: true, value: { removed: 0 } });
    const attempted = [
      ...(await database.db.select({ at: changeProposalImages.sweepAttemptedAt }).from(changeProposalImages)),
      ...(await database.db.select({ at: changeProposalImageUploads.sweepAttemptedAt }).from(changeProposalImageUploads)),
      ...(await database.db.select({ at: changeProposalImagePublications.sweepAttemptedAt }).from(changeProposalImagePublications)),
    ];
    expect(attempted).toEqual([{ at: harness.clock.now }, { at: harness.clock.now }, { at: harness.clock.now }]);
  });

  it('stops once storage deletes used its time budget and gives each delete only what is left of it', async () => {
    const harness = endToEnd();
    await database.db.insert(changeProposalImages).values([1, 2, 3, 4, 5].map((index) => released(index, TENANT, NOW)));
    const deadlines: number[] = [];
    const deps = {
      ...harness.deps,
      storage: {
        ...harness.objects.storage,
        delete: async (input: { deadlineMs?: number }) => {
          deadlines.push(input.deadlineMs ?? 0);
          harness.clock.now = new Date(Date.parse(harness.clock.now) + 4_000).toISOString();
          return err(integrationUnavailable('Could not reach S3.: the storage request deadline passed'));
        },
      },
    };
    expect(await sweepQuarantinedImages(deps)).toMatchObject({ ok: true, value: { removed: 0 } });
    expect(deadlines).toEqual([5_000, 5_000, 2_000]);
    expect(await sweepQuarantinedImages({ ...deps, deadlineAt: Date.parse(harness.clock.now) + 3_000 })).toMatchObject({ ok: true });
    expect(deadlines.slice(3)).toEqual([3_000]);
  });
});

describe('database statements of the sweep', () => {
  it('end once a lock they wait on outlives the run budget, the discovery of workspaces included', async () => {
    const harness = endToEnd();
    await database.db.insert(changeProposalImages).values({ ...image(1), releasedAt: NOW });
    const holder = new pg.Client({ connectionString: database.url });
    await holder.connect();
    try {
      await holder.query('begin');
      await holder.query('lock table change_proposal_images in access exclusive mode');
      const started = Date.now();
      const released = new Promise((resolve) => { setTimeout(resolve, 4_000); }).then(() => holder.query('rollback'));
      const outcome = await sweepQuarantinedImages({ ...harness.deps, budgetMs: 1_000 });
      const elapsed = Date.now() - started;
      await released;
      expect(outcome).toEqual({ ok: true, value: { tenants: 0, removed: 0 } });
      expect(elapsed).toBeLessThan(3_000);
    } finally {
      await holder.end();
    }
    expect(await releasedRows()).toEqual(['1']);
  }, 15_000);
});

describe('the release of a sweep', () => {
  it('ends a statement that runs longer than the time the sweep gives it, not only a lock wait', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await repository.insert(TENANT, image(1, { createdAt: '2026-02-01T10:00:00.000Z' }), stored);
    await database.db.execute(sql`create or replace function slow_image_release() returns trigger language plpgsql as $$
      begin perform pg_sleep(3); return new; end $$`);
    await database.db.execute(sql`create trigger slow_image_release before update on change_proposal_images for each row execute function slow_image_release()`);
    try {
      const started = Date.now();
      const outcome = await repository.release(TENANT, { kind: 'sweep', createdBefore: '2026-02-22T10:00:00.000Z', limit: 10 }, NOW, 500);
      expect({ outcome, quick: Date.now() - started < 2_000 }).toEqual({ outcome: { kind: 'busy' }, quick: true });
    } finally {
      await database.db.execute(sql`drop trigger slow_image_release on change_proposal_images`);
      await database.db.execute(sql`drop function slow_image_release()`);
    }
    expect(await rows()).toEqual([`${TENANT}/${KEY_ID}/1`]);
  }, 15_000);
});

describe('storage requests of an approval that never answer', () => {
  it('end at their deadline as a transient error and leave the proposal pending, for the read of the quarantined copy and for the public write', async () => {
    const harness = endToEnd();
    const { id } = await harness.proposeCover(PNG_BYTES);
    const deadlines: Array<[string, number | undefined]> = [];
    const unanswered = <T>(method: string, deadlineMs: number | undefined): Promise<Result<T, AppError>> => {
      deadlines.push([method, deadlineMs]);
      return deadlineMs === undefined ? new Promise(() => undefined)
        : Promise.resolve(err(integrationUnavailable('Could not read the bounded storage object: the storage request deadline passed')));
    };
    const silentRead = { ...harness.deps, storage: { ...harness.objects.storage, getObject: (input: { deadlineMs?: number }) => unanswered<Uint8Array>('getObject', input.deadlineMs) } };
    expect(await approveChangeProposal(ownerSession, { id }, silentRead)).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    const silentWrite = { ...harness.deps, storage: { ...harness.objects.storage, putObject: (input: { deadlineMs?: number }) => unanswered<undefined>('putObject', input.deadlineMs) } };
    expect(await approveChangeProposal(ownerSession, { id }, silentWrite)).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(deadlines).toEqual([['getObject', 5_000], ['putObject', 5_000]]);
    const [proposal] = await database.db.select({ status: changeProposals.status }).from(changeProposals).where(eq(changeProposals.id, id));
    expect(proposal?.status).toBe('pending');
    const [cover] = await database.db.select({ coverUrl: products.coverUrl }).from(products).where(eq(products.id, 'mug'));
    expect(cover?.coverUrl).toBeNull();
    expect(await approveChangeProposal(ownerSession, { id }, harness.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
  });
});
