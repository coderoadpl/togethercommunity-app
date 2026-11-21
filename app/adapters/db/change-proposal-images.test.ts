import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createContentHash } from '#adapters/crypto/content-hash.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import {
  IMAGE_ASSET_MAX_BYTES,
  type Identity,
  type ProposalImageReference,
  type QuarantinedImageAsset,
  type ShopManagementKey,
} from '#core/domain/index.js';
import {
  approveChangeProposal,
  completeProposedProductCoverUpload,
  beginProposedProductCoverUpload,
  shopManagementKeyCapabilities,
  submitChangeProposal,
  type Ctx,
} from '#core/server/index.js';
import { createObjectStorageFake } from '#core/server/testing/object-storage-fake.js';

import { createChangeProposalGroupRepository } from './change-proposal-groups.js';
import { createQuarantinedImageLocks, createQuarantinedImageRepository } from './change-proposal-images.js';
import { createChangeProposalOwnerNotifier, createChangeProposalPeopleReader } from './change-proposal-people.js';
import { createChangeProposalTransaction } from './change-proposal-transaction.js';
import { createChangeProposalRepository, createChangeProposalTargetLabelReader } from './change-proposals.js';
import { createTenantSecretRepository } from './repositories.js';
import { changeProposalEvents, changeProposalImages, changeProposals, products, shopManagementKeys, tenants } from './schema.js';
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

const pendingProposal = async (id: string, input: Record<string, unknown>, values: { keyId?: string; expired?: boolean; status?: 'pending' | 'rejected' } = {}) => {
  const status = values.status ?? 'pending';
  await database.db.insert(changeProposals).values({
    id, tenantId: TENANT, operation: 'product.update', input: { id: 'mug', ...input }, effect: {}, targetKind: 'product', targetId: 'mug',
    status, proposedByKeyId: values.keyId ?? KEY_ID, proposedByKeyName: 'Agent', proposedByIssuerUserId: ISSUER,
    createdAt: values.expired === true ? '2026-01-01T10:00:00.000Z' : NOW,
    expiresAt: values.expired === true ? '2026-01-31T10:00:00.000Z' : '2026-03-31T10:00:00.000Z',
    ...(status === 'pending' ? {} : { decidedAt: NOW, decidedByUserId: OWNER }),
  });
};

const rows = async () => (await database.db.select().from(changeProposalImages))
  .map((row) => `${row.tenantId}/${row.apiKeyId}/${row.digest.replace(/^0+/u, '')}`).sort();

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
  for (const table of [changeProposalImages, changeProposalEvents, changeProposals, shopManagementKeys, products]) await database.db.delete(table);
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
    expect(await repository.insert(TENANT, image(1))).toEqual({ kind: 'stored', asset: image(1) });
    expect(await repository.insert(TENANT, image(1, { createdAt: '2026-03-02T10:00:00.000Z' }))).toEqual({ kind: 'existing', asset: image(1) });
    expect(await repository.find(TENANT, KEY_ID, image(1))).toEqual(image(1));
    expect(await repository.find(TENANT, OTHER_KEY_ID, image(1))).toBeNull();
    expect(await repository.find(NEIGHBOUR, KEY_ID, image(1))).toBeNull();
    await expect(repository.insert(NEIGHBOUR, image(2))).rejects.toThrow('another tenant');
  });

  it('lets only one of two concurrent completions take the last image slot of a key', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await database.db.insert(changeProposalImages).values(Array.from({ length: 99 }, (_unused, index) => image(index + 100)));
    const outcomes = await Promise.all([repository.insert(TENANT, image(1)), repository.insert(TENANT, image(2))]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['cap_exceeded', 'stored']);
    expect(outcomes.find((outcome) => outcome.kind === 'cap_exceeded')).toEqual({ kind: 'cap_exceeded', cap: 'key_quarantined_images' });
    expect((await database.db.select().from(changeProposalImages).where(eq(changeProposalImages.apiKeyId, KEY_ID))).length).toBe(100);
    expect(await repository.insert(TENANT, image(3, { apiKeyId: OTHER_KEY_ID }))).toMatchObject({ kind: 'stored' });
  });

  it('lets only one of two concurrent completions take the last bytes of a key', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await database.db.insert(changeProposalImages).values(Array.from({ length: 9 }, (_unused, index) => image(index + 100, { sizeBytes: IMAGE_ASSET_MAX_BYTES })));
    const outcomes = await Promise.all([
      repository.insert(TENANT, image(1, { sizeBytes: 3 * 1024 * 1024 })),
      repository.insert(TENANT, image(2, { sizeBytes: 3 * 1024 * 1024 })),
    ]);
    expect(outcomes.map((outcome) => outcome.kind === 'cap_exceeded' ? outcome.cap : outcome.kind).sort()).toEqual(['key_quarantined_bytes', 'stored']);
  });

  it('releases only the images no pending, unexpired proposal of their own key references', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    for (const index of [1, 2, 3, 4]) await repository.insert(TENANT, image(index));
    await pendingProposal('p-pending', { coverUrl: pathOf(image(1)) });
    await pendingProposal('p-expired', { coverUrl: pathOf(image(2)) }, { expired: true });
    await pendingProposal('p-rejected', { coverUrl: pathOf(image(3)) }, { status: 'rejected' });
    await pendingProposal('p-other-key', { coverUrl: pathOf(image(4)) }, { keyId: OTHER_KEY_ID });

    const released = await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID }, NOW);
    expect(released.kind === 'written' ? released.value.map((row) => row.digest) : released).toEqual([digestOf(2), digestOf(3), digestOf(4)]);
    expect(await rows()).toEqual([`${TENANT}/${KEY_ID}/1`]);
    expect(await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID, images: [] }, NOW)).toEqual({ kind: 'written', value: [] });
  });

  it('sweeps images past the age bound and every image of a revoked or deleted key, across workspaces', async () => {
    const repository = createQuarantinedImageRepository(database.db);
    await repository.insert(TENANT, image(1, { createdAt: '2026-02-01T10:00:00.000Z' }));
    await repository.insert(TENANT, image(2));
    await repository.insert(TENANT, image(3, { apiKeyId: OTHER_KEY_ID }));
    await repository.insert(TENANT, image(4, { apiKeyId: 'key-deleted' }));
    await repository.insert(NEIGHBOUR, image(5, { tenantId: NEIGHBOUR, apiKeyId: 'key-neighbour' }));
    await repository.insert(TENANT, image(6, { createdAt: '2026-02-01T10:00:00.000Z' }));
    await pendingProposal('p-attached', { coverUrl: pathOf(image(6)) });
    await database.db.update(shopManagementKeys).set({ revokedAt: NOW }).where(eq(shopManagementKeys.id, OTHER_KEY_ID));
    const createdBefore = '2026-02-22T10:00:00.000Z';

    expect(await repository.listTenantIdsToSweep(createdBefore, 10)).toEqual([TENANT]);
    const released = await repository.release(TENANT, { kind: 'sweep', createdBefore, limit: 2 }, NOW);
    expect(released.kind === 'written' ? released.value.map((row) => row.digest) : released).toEqual([digestOf(1)]);
    const rest = await repository.release(TENANT, { kind: 'sweep', createdBefore, limit: 10 }, NOW);
    expect(rest.kind === 'written' ? rest.value.map((row) => row.digest).sort() : rest).toEqual([digestOf(3), digestOf(4)]);
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
    await repository.insert(TENANT, image(1));
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
    await repository.insert(TENANT, image(1));
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
      for (const deadline = Date.now() + 10_000; ;) {
        const waiting = await observer.query<{ count: number }>(
          "select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
        );
        if ((waiting.rows[0]?.count ?? 0) >= 1) break;
        if (Date.now() > deadline) throw new Error('The release never waited for the approval');
      }
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
    await repository.insert(TENANT, image(1));
    await pendingProposal('p-new', { coverUrl: pathOf(image(1)) });
    expect(await repository.release(TENANT, { kind: 'key', apiKeyId: KEY_ID }, NOW)).toEqual({ kind: 'written', value: [] });
    expect(await rows()).toEqual([`${TENANT}/${KEY_ID}/1`]);
  });

  it('lists quarantined objects the database records in the storage reference inventory', async () => {
    await createQuarantinedImageRepository(database.db).insert(TENANT, image(1));
    const inventory = await createStorageReferenceRepository(database.db).readInventory(TENANT);
    expect(inventory.quarantinedImages).toEqual([{ storageKey: `image-asset-quarantine/${TENANT}/${KEY_ID}/product-cover/${digestOf(1)}.png` }]);
    expect((await createStorageReferenceRepository(database.db).readInventory(NEIGHBOUR)).quarantinedImages).toEqual([]);
  });
});

describe('a proposed product cover end to end on the database', () => {
  it('quarantines the upload, proposes it, publishes the verified bytes on approval and releases the quarantined copy', async () => {
    const objects = createObjectStorageFake();
    const logger = { error: vi.fn<(message: string) => void>() };
    const secretResolver = createTenantSecretResolver(createTenantSecretRepository(database.db), secretCrypto);
    let ids = 0;
    const deps = {
      changeProposalTransaction: createChangeProposalTransaction(database.db, logger, (connection) =>
        createTenantSecretResolver(createTenantSecretRepository(connection), secretCrypto)),
      changeProposals: createChangeProposalRepository(database.db),
      changeProposalGroups: createChangeProposalGroupRepository(database.db),
      shopManagementKeys: createShopManagementKeyRepository(database.db),
      changeProposalTargetLabels: createChangeProposalTargetLabelReader(database.db),
      changeProposalPeople: createChangeProposalPeopleReader(database.db),
      changeProposalOwnerNotifier: createChangeProposalOwnerNotifier(database.db),
      realtimeBus: { publish: () => undefined },
      quarantinedImages: createQuarantinedImageRepository(database.db),
      storage: objects.storage,
      secretResolver,
      contentHash: createContentHash(),
      logger,
      ids: { nextId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` },
      clock: { nowIso: () => NOW },
    };
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
    expect(logger.error).not.toHaveBeenCalled();
  });
});
