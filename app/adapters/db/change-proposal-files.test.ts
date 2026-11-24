import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createContentHash } from '#adapters/crypto/content-hash.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import {
  CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS,
  isChangeProposalFileMissingNote,
  KEY_DOWNLOAD_FILE_LIMITS,
  KEY_DOWNLOAD_STORAGE_DEADLINES,
  type AppError,
  type Identity,
  type Result,
  type ShopManagementKey,
} from '#core/domain/index.js';
import {
  approveChangeProposal,
  approveChangeProposalGroup,
  attachStagedProductDownload,
  beginKeyDownloadUpload,
  completeKeyDownloadUpload,
  copyKeyDownloadFile,
  createChangeProposalGroup,
  discardKeyDownloadFile,
  getChangeProposal,
  getChangeProposalFileLink,
  purgeShopManagementKeys,
  rejectChangeProposal,
  rejectChangeProposalGroup,
  removeProductDownloadFile,
  revokeShopManagementKey,
  shopManagementKeyCapabilities,
  submitChangeProposal,
  submitGroupedChangeProposal,
  sweepKeyDownloadFiles,
  withdrawOwnChangeProposal,
  type ChangeProposalTransaction,
  type ChangeProposalTransactionScope,
  type Ctx,
  type StorageProvider,
} from '#core/server/index.js';
import { createObjectStorageFake } from '#core/server/testing/object-storage-fake.js';

import { createChangeProposalGroupRepository } from './change-proposal-groups.js';
import { createQuarantinedImageRepository } from './change-proposal-images.js';
import { createChangeProposalOwnerNotifier, createChangeProposalPeopleReader } from './change-proposal-people.js';
import { createChangeProposalTransaction } from './change-proposal-transaction.js';
import { createChangeProposalEventRepository, createChangeProposalRepository, createChangeProposalTargetLabelReader } from './change-proposals.js';
import { createKeyDownloadAttachRepository, createKeyDownloadFileRepository } from './key-download-files.js';
import { createProductDownloadAssetRepository, createTenantSecretRepository } from './repositories.js';
import {
  changeProposalDownloadDeletions,
  changeProposalDownloadFiles,
  changeProposalDownloadUploadEvents,
  changeProposalDownloadUploads,
  changeProposalEvents,
  changeProposalGroups,
  changeProposals,
  productDownloadAssets,
  productPrices,
  products,
  productStock,
  shopManagementKeyEvents,
  shopManagementKeys,
  stockEvents,
  tenants,
} from './schema.js';
import { createShopManagementKeyRepository } from './shop-management-keys.js';
import { createStockRepository } from './stock.js';
import { createTestDatabase } from './test-database-name.js';

const TENANT = 't-change-proposal-files';
const NEIGHBOUR = 't-change-proposal-files-neighbour';
const NOW = '2026-03-01T10:00:00.000Z';
const OWNER = 'user-owner';
const ISSUER = 'user-issuer';
const PROPOSER = 'key-proposer';
const OTHER_PROPOSER = 'key-proposer-second';
const DIRECT = 'key-direct';
const NEIGHBOUR_KEY = 'key-neighbour';
const WORKBOOK = 'workbook';
const GUIDE = 'guide';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let sequence = 0;

const key = (id: string, mode: 'propose' | 'direct' = 'propose', tenantId = TENANT): ShopManagementKey => ({
  id, tenantId, name: `Agent ${id}`, keyHash: `hash-${id}`, scopes: ['shop:catalog:read', 'shop:catalog:write'],
  mode, issuedByUserId: ISSUER, createdAt: '2026-02-25T00:00:00.000Z', expiresAt: '2026-04-20T00:00:00.000Z', revokedAt: null,
});

const identity = (overrides: Partial<Identity> = {}, tenantId = TENANT): Identity => ({
  userId: OWNER, email: 'owner@example.test', name: 'Owner', emailVerified: true, tenantAccess: 'staff',
  tenantId, tenantSlug: tenantId, tenantName: 'Files', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  ...overrides,
});

const keyCtx = (apiKeyId = PROPOSER, mode: 'propose' | 'direct' = 'propose', tenantId = TENANT): Ctx => ({
  identity: identity({ userId: ISSUER, email: 'issuer@example.test' }, tenantId),
  capabilities: shopManagementKeyCapabilities(key(apiKeyId, mode, tenantId)),
  machineActor: { kind: 'shop_management_key', apiKeyId, mode },
});

const ownerSession: Ctx = { identity: identity() };

const secretCrypto = createSecretCrypto(Buffer.alloc(32, 9).toString('base64'));

const PDF = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 42]);
const LONGER_PDF = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 42, 42, 42]);

const sha256 = (bytes: Uint8Array): string => createContentHash().sha256(bytes);

const lockWaiters = async (observer: pg.Client): Promise<number> => (await observer.query<{ count: number }>(
  "select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
)).rows[0]?.count ?? 0;

const untilWaiting = async (observer: pg.Client, what: string, waiters: number): Promise<void> => {
  for (const deadline = Date.now() + 10_000; await lockWaiters(observer) < waiters;) {
    if (Date.now() > deadline) throw new Error(`${what} never waited`);
  }
};

const gate = () => {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open };
};

beforeAll(async () => {
  database = await createTestDatabase('together_change_proposal_files', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values([
    { id: TENANT, slug: 'files', name: 'Files', createdAt: NOW },
    { id: NEIGHBOUR, slug: 'files-neighbour', name: 'Neighbour', createdAt: NOW },
  ]);
  for (const tenantId of [TENANT, NEIGHBOUR]) {
    await createTenantSecretRepository(database.db).upsert(tenantId, {
      id: `storage-configuration-${tenantId}`, tenantId, key: 's3.configuration', maskedPreview: 'configured', updatedAt: NOW,
      ...secretCrypto.encrypt(JSON.stringify({
        provider: 'aws_s3', endpoint: 'https://storage.example.test', region: 'auto', bucket: 'assets', accessKeyId: 'a', secretAccessKey: 's',
      })),
    });
  }
});

afterAll(async () => { await database?.close(); });

beforeEach(async () => {
  for (const table of [
    changeProposalDownloadFiles, changeProposalDownloadUploads, changeProposalDownloadDeletions, changeProposalDownloadUploadEvents,
    changeProposalEvents, changeProposals, changeProposalGroups, stockEvents, productStock, productPrices, productDownloadAssets, products,
    shopManagementKeyEvents, shopManagementKeys,
  ]) {
    await database.db.delete(table);
  }
  for (const created of [key(PROPOSER), key(OTHER_PROPOSER), key(DIRECT, 'direct'), key(NEIGHBOUR_KEY, 'propose', NEIGHBOUR)]) {
    await createShopManagementKeyRepository(database.db).create(created.tenantId, created, {
      id: `key-event-${String(++sequence)}`, tenantId: created.tenantId, apiKeyId: created.id, kind: 'created', actorUserId: ISSUER,
      method: null, route: null, resourceId: null, at: created.createdAt,
    });
  }
  await database.db.insert(products).values([
    { id: WORKBOOK, tenantId: TENANT, slug: WORKBOOK, title: 'Workbook', type: 'digital_download', description: '', priceCents: 0, currency: 'EUR', createdAt: NOW },
    { id: GUIDE, tenantId: TENANT, slug: GUIDE, title: 'Field Guide', type: 'digital_download', description: '', priceCents: 0, currency: 'EUR', createdAt: NOW },
    { id: 'neighbour-book', tenantId: NEIGHBOUR, slug: 'neighbour-book', title: 'Book', type: 'digital_download', description: '', priceCents: 0, currency: 'EUR', createdAt: NOW },
  ]);
});

const harness = () => {
  const objects = createObjectStorageFake({ sha256 });
  const clock = { now: NOW };
  const logger = { error: vi.fn<(message: string) => void>() };
  let ids = 0;
  const deps = {
    changeProposalTransaction: createChangeProposalTransaction(database.db, logger, (connection) =>
      createTenantSecretResolver(createTenantSecretRepository(connection), secretCrypto)),
    changeProposals: createChangeProposalRepository(database.db),
    changeProposalEvents: createChangeProposalEventRepository(database.db),
    changeProposalGroups: createChangeProposalGroupRepository(database.db),
    shopManagementKeys: createShopManagementKeyRepository(database.db),
    changeProposalTargetLabels: createChangeProposalTargetLabelReader(database.db),
    changeProposalPeople: createChangeProposalPeopleReader(database.db),
    changeProposalOwnerNotifier: createChangeProposalOwnerNotifier(database.db),
    realtimeBus: { publish: () => undefined },
    quarantinedImages: createQuarantinedImageRepository(database.db),
    keyDownloadFiles: createKeyDownloadFileRepository(database.db),
    keyDownloadAttach: createKeyDownloadAttachRepository(database.db),
    downloadAssets: createProductDownloadAssetRepository(database.db),
    storage: objects.storage,
    secretResolver: createTenantSecretResolver(createTenantSecretRepository(database.db), secretCrypto),
    contentHash: createContentHash(),
    logger,
    ids: { nextId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` },
    clock: { nowIso: () => clock.now },
  };
  const stage = async (bytes: Uint8Array = PDF, ctx: Ctx = keyCtx(), fileName = 'workbook.pdf') => {
    const started = await beginKeyDownloadUpload(ctx, { fileName, contentType: 'application/pdf', sizeBytes: bytes.byteLength }, deps);
    if (!started.ok) throw new Error(started.error.message);
    objects.objects.set(decodeURIComponent(new URL(started.value.upload.url).pathname.slice(1)), { bytes, contentType: 'application/pdf' });
    const completed = await completeKeyDownloadUpload(ctx, { uploadId: started.value.upload.id }, deps);
    if (!completed.ok) throw new Error(completed.error.message);
    return completed.value.file;
  };
  const propose = async (operation: 'download.add' | 'download.replace' | 'download.remove', input: Record<string, unknown>, ctx: Ctx = keyCtx()) => {
    const submitted = await submitChangeProposal(ctx, { operation, input }, deps);
    if (!submitted.ok) throw new Error(submitted.error.message);
    return submitted.value;
  };
  return { objects, clock, logger, deps, stage, propose };
};

type Harness = ReturnType<typeof harness>;

const stagedKeyOf = (fileId: string, keyId = PROPOSER): string => `${TENANT}/product-downloads/key-files/${keyId}/${fileId}/workbook.pdf`;

const stagedRow = async (id: string) => (await database.db.select().from(changeProposalDownloadFiles)
  .where(and(eq(changeProposalDownloadFiles.tenantId, TENANT), eq(changeProposalDownloadFiles.id, id))))[0] ?? null;

const assetsOf = async (productId: string) => (await database.db.select().from(productDownloadAssets)
  .where(and(eq(productDownloadAssets.tenantId, TENANT), eq(productDownloadAssets.productId, productId))))
  .map((row) => ({ id: row.id, versionNumber: row.versionNumber, latest: row.supersededAt === null, storageKey: row.storageKey, sha256: row.sha256 }))
  .sort((left, right) => left.versionNumber - right.versionNumber || left.id.localeCompare(right.id));

const owedRows = async () => (await database.db.select().from(changeProposalDownloadDeletions)).map((row) => row.objectKey).sort();

const eventNotes = async (proposalId: string) => (await database.db.select().from(changeProposalEvents)
  .where(eq(changeProposalEvents.proposalId, proposalId))).sort((left, right) => left.sequence - right.sequence).map((row) => `${row.kind}:${row.note ?? ''}`);

const lastNote = async (proposalId: string): Promise<string | null> => (await eventNotes(proposalId)).at(-1)?.replace(/^[a-z_]+:/u, '') ?? null;

const statusOf = async (proposalId: string) => (await database.db.select().from(changeProposals).where(eq(changeProposals.id, proposalId)))[0]?.status;

const seedOwnerFile = async (h: Harness, id: string, productId = WORKBOOK): Promise<string> => {
  const storageKey = `${TENANT}/product-downloads/${productId}/${id}/guide.pdf`;
  await database.db.insert(productDownloadAssets).values({
    id, tenantId: TENANT, productId, lineageId: id, versionNumber: 1, versionNote: null, supersededAt: null, replacesAssetId: null,
    fileName: 'guide.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength, storageKey, status: 'ready', createdAt: NOW, sha256: null,
  });
  h.objects.objects.set(storageKey, { bytes: PDF, contentType: 'application/pdf' });
  return storageKey;
};

const removeStagedObjects = (h: Harness): void => {
  for (const objectKey of h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)) h.objects.objects.delete(objectKey);
};

const seedUploadingFile = async (h: Harness, id: string): Promise<string> => {
  const storageKey = `${TENANT}/product-downloads/${WORKBOOK}/${id}/draft.pdf`;
  await database.db.insert(productDownloadAssets).values({
    id, tenantId: TENANT, productId: WORKBOOK, lineageId: id, versionNumber: 1, versionNote: null, supersededAt: null, replacesAssetId: null,
    fileName: 'draft.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength, storageKey, status: 'pending', createdAt: NOW, sha256: null,
  });
  h.objects.objects.set(storageKey, { bytes: PDF, contentType: 'application/pdf' });
  return storageKey;
};

const MAX_STAGED_ROW_BYTES = KEY_DOWNLOAD_FILE_LIMITS.maxBytes;

const fillStaging = async (apiKeyId: string, bytes: number, rows = Math.ceil(bytes / MAX_STAGED_ROW_BYTES)): Promise<void> => {
  let left = bytes;
  for (let row = 0; row < rows; row += 1) {
    const sizeBytes = row === rows - 1 ? left : Math.min(MAX_STAGED_ROW_BYTES, left - (rows - row - 1));
    left -= sizeBytes;
    const id = `filler-${apiKeyId}-${String(row)}`;
    await database.db.insert(changeProposalDownloadFiles).values({
      tenantId: TENANT, id, apiKeyId, fileName: 'filler.pdf', contentType: 'application/pdf', sizeBytes, sha256: 'a'.repeat(64),
      objectKey: `${TENANT}/product-downloads/key-files/${apiKeyId}/${id}/filler.pdf`, createdAt: NOW,
    });
  }
};

const beginStaging = (h: Harness) => beginKeyDownloadUpload(keyCtx(), { fileName: 'next.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength }, h.deps);

describe('a proposed download file', () => {
  it('changes no live file list until approval, which attaches the staged object in place under the staged id and nothing else', async () => {
    const h = harness();
    const file = await h.stage();
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id, versionNote: 'First edition' });
    expect(receipt).toMatchObject({ status: 'pending', operation: 'download.add', target: { kind: 'product', id: WORKBOOK } });
    expect(JSON.stringify(receipt)).not.toContain(sha256(PDF));
    expect(await assetsOf(WORKBOOK)).toEqual([]);
    expect((await stagedRow(file.id))?.proposalId).toBe(receipt.id);

    const shown = await getChangeProposal(ownerSession, { id: receipt.id }, h.deps);
    if (!shown.ok) throw new Error(shown.error.message);
    const entry = {
      id: file.id, lineageId: file.id, versionNumber: 1, latest: true, fileName: 'workbook.pdf', contentType: 'application/pdf',
      sizeBytes: PDF.byteLength, fingerprint: sha256(PDF), versionNote: 'First edition',
    };
    expect(shown.value.effect).toEqual({ files: { before: [], after: [entry] } });
    expect(shown.value.proposedFiles).toEqual([{ id: file.id, available: true, copiedFrom: null }]);

    h.objects.calls.length = 0;
    const approved = await approveChangeProposal(ownerSession, { id: receipt.id }, h.deps);
    expect(approved).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: file.id, proposedFiles: [{ id: file.id, available: false }] } });
    expect(h.objects.calls.map((call) => call.method)).toEqual(['head']);
    expect(await assetsOf(WORKBOOK)).toEqual([{ id: file.id, versionNumber: 1, latest: true, storageKey: stagedKeyOf(file.id), sha256: sha256(PDF) }]);
    expect(await stagedRow(file.id)).toBeNull();
    expect(h.objects.keysUnder(`${TENANT}/`)).toEqual([stagedKeyOf(file.id)]);
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it('goes stale when the live file list changed since, keeps the staged file and lets the key propose it again', async () => {
    const h = harness();
    const file = await h.stage();
    const first = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    const live = await h.stage(PDF, keyCtx(DIRECT, 'direct'));
    expect(await attachStagedProductDownload(keyCtx(DIRECT, 'direct'), { productId: WORKBOOK, stagedFileId: live.id }, h.deps)).toMatchObject({ ok: true });

    expect(await approveChangeProposal(ownerSession, { id: first.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect((await assetsOf(WORKBOOK)).map((asset) => asset.id)).toEqual([live.id]);
    expect(await stagedRow(file.id)).toMatchObject({ id: file.id, proposalId: null });

    const again = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    expect(await approveChangeProposal(ownerSession, { id: again.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect((await assetsOf(WORKBOOK)).map((asset) => asset.id).sort()).toEqual([file.id, live.id].sort());
  });

  it('lets one pending proposal hold a staged file, and refuses another key’s, a discarded or an unknown file with the same answer', async () => {
    const h = harness();
    const file = await h.stage();
    const other = await h.stage(PDF, keyCtx(OTHER_PROPOSER));
    const discarded = await h.stage();
    expect(await discardKeyDownloadFile(keyCtx(), { id: discarded.id }, h.deps)).toMatchObject({ ok: true });
    await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    h.objects.calls.length = 0;

    const refusals = [
      await submitChangeProposal(keyCtx(), { operation: 'download.add', input: { productId: GUIDE, stagedFileId: file.id } }, h.deps),
      await submitChangeProposal(keyCtx(), { operation: 'download.add', input: { productId: WORKBOOK, stagedFileId: other.id } }, h.deps),
      await submitChangeProposal(keyCtx(), { operation: 'download.add', input: { productId: WORKBOOK, stagedFileId: discarded.id } }, h.deps),
      await submitChangeProposal(keyCtx(), { operation: 'download.add', input: { productId: WORKBOOK, stagedFileId: 'never-staged' } }, h.deps),
      await submitChangeProposal(keyCtx(NEIGHBOUR_KEY, 'propose', NEIGHBOUR), { operation: 'download.add', input: { productId: 'neighbour-book', stagedFileId: file.id } }, h.deps),
    ];
    const answers = refusals.map((refusal) => refusal.ok ? null : JSON.stringify(refusal.error));
    expect(new Set(answers).size).toBe(1);
    expect(refusals[0]).toMatchObject({ ok: false, error: { code: 'validation', details: { fieldErrors: { stagedFileId: [expect.any(String)] } } } });
    expect(h.objects.calls).toEqual([]);
    expect((await database.db.select().from(changeProposals)).length).toBe(1);
  });

  it('answers the same refusal for a file the key discards between the submission check and the dry run, alone or in a group', async () => {
    const h = harness();
    const refusalOf = async (submit: (deps: Harness['deps'], stagedFileId: string) => Promise<{ ok: boolean }>) => {
      const file = await h.stage();
      const proposable = h.deps.keyDownloadFiles.proposable;
      let discarded = false;
      const racing = {
        ...h.deps,
        keyDownloadFiles: {
          ...h.deps.keyDownloadFiles,
          proposable: async (...args: Parameters<typeof proposable>) => {
            const answer = await proposable(...args);
            if (!discarded) {
              discarded = true;
              expect(await discardKeyDownloadFile(keyCtx(), { id: file.id }, h.deps)).toMatchObject({ ok: true });
            }
            return answer;
          },
        },
      };
      return { file, refusal: await submit(racing, file.id) };
    };
    const alone = await refusalOf((deps, stagedFileId) => submitChangeProposal(keyCtx(), { operation: 'download.add', input: { productId: WORKBOOK, stagedFileId } }, deps));
    const group = await createChangeProposalGroup(keyCtx(), { title: 'Tidy the workbook' }, h.deps);
    if (!group.ok) throw new Error(group.error.message);
    const grouped = await refusalOf((deps, stagedFileId) => submitGroupedChangeProposal(keyCtx(), {
      groupId: group.value.id, operation: 'download.add', input: { productId: WORKBOOK, stagedFileId },
    }, deps));
    const before = await submitChangeProposal(keyCtx(), { operation: 'download.add', input: { productId: WORKBOOK, stagedFileId: alone.file.id } }, h.deps);

    expect(before).toMatchObject({ ok: false, error: { code: 'validation', details: { fieldErrors: { stagedFileId: [expect.any(String)] } } } });
    expect(JSON.stringify(alone.refusal)).toBe(JSON.stringify(before));
    expect(JSON.stringify(grouped.refusal)).toBe(JSON.stringify(before));
    expect(await database.db.select().from(changeProposals)).toEqual([]);
  });

  it('lets only one of two concurrent proposals hold the same staged file', async () => {
    const h = harness();
    const file = await h.stage();
    const outcomes = await Promise.all([GUIDE, WORKBOOK].map((productId) =>
      submitChangeProposal(keyCtx(), { operation: 'download.add', input: { productId, stagedFileId: file.id } }, h.deps)));
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.find((outcome) => !outcome.ok)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect((await database.db.select().from(changeProposals)).length).toBe(1);
  });

  it.each<[string, (h: Harness, fileId: string) => Promise<void>]>([
    ['its key discarded it', async (h, fileId) => {
      expect(await discardKeyDownloadFile(keyCtx(), { id: fileId }, h.deps)).toMatchObject({ ok: true });
    }],
    ['the storage reports its object missing', async (h) => {
      removeStagedObjects(h);
    }],
    ['its object has another size', async (h, fileId) => {
      h.objects.objects.set(stagedKeyOf(fileId), { bytes: LONGER_PDF, contentType: 'application/pdf' });
    }],
  ])('ends stale with the file_unavailable note and changes nothing when %s', async (_name, breakIt) => {
    const h = harness();
    const file = await h.stage();
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    await breakIt(h, file.id);
    expect(await approveChangeProposal(ownerSession, { id: receipt.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(isChangeProposalFileMissingNote(await lastNote(receipt.id))).toBe(true);
    expect(await assetsOf(WORKBOOK)).toEqual([]);
  });

  it('answers a storage failure before the approval and leaves the proposal pending', async () => {
    const h = harness();
    const file = await h.stage();
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    h.objects.failReads = () => true;
    expect(await approveChangeProposal(ownerSession, { id: receipt.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(await statusOf(receipt.id)).toBe('pending');
    h.objects.failReads = () => false;
    expect(await approveChangeProposal(ownerSession, { id: receipt.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
  });

  it('replaces a file as its next version and removes versions, applying exactly the stored effects', async () => {
    const h = harness();
    const ownerKey = await seedOwnerFile(h, 'owner-file');
    const file = await h.stage(LONGER_PDF);
    const replace = await h.propose('download.replace', { productId: WORKBOOK, stagedFileId: file.id, replacesAssetId: 'owner-file', versionNote: 'Second edition' });
    expect(await approveChangeProposal(ownerSession, { id: replace.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: file.id } });
    expect((await assetsOf(WORKBOOK)).map((asset) => [asset.id, asset.versionNumber, asset.latest])).toEqual([['owner-file', 1, false], [file.id, 2, true]]);

    const removeKeyFile = await h.propose('download.remove', { productId: WORKBOOK, assetId: file.id });
    expect(h.objects.objects.has(stagedKeyOf(file.id))).toBe(true);
    expect(await approveChangeProposal(ownerSession, { id: removeKeyFile.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied', appliedResourceId: WORKBOOK } });
    expect((await assetsOf(WORKBOOK)).map((asset) => [asset.id, asset.latest])).toEqual([['owner-file', true]]);
    expect(h.objects.objects.has(stagedKeyOf(file.id))).toBe(false);
    expect(await owedRows()).toEqual([stagedKeyOf(file.id)]);
    await sweepKeyDownloadFiles(h.deps);
    expect(await owedRows()).toEqual([]);

    const removeOwnerFile = await h.propose('download.remove', { productId: WORKBOOK, assetId: 'owner-file' });
    expect(h.objects.objects.has(ownerKey)).toBe(true);
    expect(await approveChangeProposal(ownerSession, { id: removeOwnerFile.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    expect(await assetsOf(WORKBOOK)).toEqual([]);
    expect(h.objects.objects.has(ownerKey)).toBe(false);
  });

  it('never reaches a product or file of another workspace', async () => {
    const h = harness();
    await database.db.insert(productDownloadAssets).values({
      id: 'neighbour-file', tenantId: NEIGHBOUR, productId: 'neighbour-book', lineageId: 'neighbour-file', versionNumber: 1, fileName: 'book.pdf',
      contentType: 'application/pdf', sizeBytes: 10, storageKey: `${NEIGHBOUR}/product-downloads/neighbour-book/neighbour-file/book.pdf`, status: 'ready', createdAt: NOW,
    });
    const file = await h.stage();
    expect(await submitChangeProposal(keyCtx(), { operation: 'download.remove', input: { productId: 'neighbour-book', assetId: 'neighbour-file' } }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await submitChangeProposal(keyCtx(), { operation: 'download.add', input: { productId: 'neighbour-book', stagedFileId: file.id } }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await submitChangeProposal(keyCtx(), { operation: 'download.remove', input: { productId: WORKBOOK, assetId: 'neighbour-file' } }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await database.db.select().from(changeProposals)).toEqual([]);
    expect((await stagedRow(file.id))?.proposalId).toBeNull();
  });

  it('shows the owner where a copied file came from and its fingerprint, which the key never receives', async () => {
    const h = harness();
    await seedOwnerFile(h, 'guide-file', GUIDE);
    const copied = await copyKeyDownloadFile(keyCtx(), { productId: GUIDE, assetId: 'guide-file' }, h.deps);
    if (!copied.ok) throw new Error(copied.error.message);
    expect(copied.value.file.sha256).toBeNull();
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: copied.value.file.id });
    expect(JSON.stringify(receipt)).not.toContain(sha256(PDF));
    const shown = await getChangeProposal(ownerSession, { id: receipt.id }, h.deps);
    if (!shown.ok) throw new Error(shown.error.message);
    expect(shown.value.proposedFiles).toEqual([{ id: copied.value.file.id, available: true, copiedFrom: { productId: GUIDE, productTitle: 'Field Guide', versionNumber: 1 } }]);
    expect(JSON.stringify(shown.value.effect)).toContain(sha256(PDF));
  });

  it('ends a proposal of an operation this release does not register stale with the unknown-operation note, and changes no file and no staged row', async () => {
    const h = harness();
    await seedOwnerFile(h, 'owner-file');
    const loose = await h.stage();
    const filesBefore = await assetsOf(WORKBOOK);
    const stagedBefore = await stagedRow(loose.id);
    await database.db.insert(changeProposals).values({
      id: 'later-operation', tenantId: TENANT, operation: 'download.rename', input: { productId: WORKBOOK, assetId: 'a', fileName: 'b.pdf' }, effect: {},
      targetKind: 'product', targetId: WORKBOOK, status: 'pending', proposedByKeyId: PROPOSER, proposedByKeyName: 'Agent',
      proposedByIssuerUserId: ISSUER, createdAt: NOW, expiresAt: '2026-03-31T10:00:00.000Z',
    });
    expect(await approveChangeProposal(ownerSession, { id: 'later-operation' }, h.deps)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(await lastNote('later-operation')).toContain('does not know the operation "download.rename"');
    expect(await assetsOf(WORKBOOK)).toEqual(filesBefore);
    expect(await stagedRow(loose.id)).toEqual(stagedBefore);
    expect(h.objects.keysUnder(`${TENANT}/`)).toEqual([`${TENANT}/product-downloads/${WORKBOOK}/owner-file/guide.pdf`, stagedKeyOf(loose.id)].sort());
  });

  it('refuses to propose removing a file that is not ready, alone or in a group, and leaves the owner’s upload in place', async () => {
    const h = harness();
    const uploadingKey = await seedUploadingFile(h, 'uploading');
    const alone = await submitChangeProposal(keyCtx(), { operation: 'download.remove', input: { productId: WORKBOOK, assetId: 'uploading' } }, h.deps);
    expect(alone).toMatchObject({ ok: false, error: { code: 'validation', message: 'Only a ready file can be removed by a proposal' } });
    const group = await createChangeProposalGroup(keyCtx(), { title: 'Tidy the workbook' }, h.deps);
    if (!group.ok) throw new Error(group.error.message);
    expect(await submitGroupedChangeProposal(keyCtx(), { groupId: group.value.id, operation: 'download.remove', input: { productId: WORKBOOK, assetId: 'uploading' } }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await database.db.select().from(changeProposals)).toEqual([]);
    expect((await assetsOf(WORKBOOK)).map((asset) => asset.id)).toEqual(['uploading']);
    expect(h.objects.objects.has(uploadingKey)).toBe(true);

    expect(await removeProductDownloadFile(keyCtx(DIRECT, 'direct'), { productId: WORKBOOK, assetId: 'uploading' }, h.deps)).toEqual({ ok: true, value: { deleted: true } });
    expect(await assetsOf(WORKBOOK)).toEqual([]);
  });

  it('ends a removal stale when the ready files changed between submission and approval, and removes nothing', async () => {
    const h = harness();
    await seedOwnerFile(h, 'owner-file');
    const removal = await h.propose('download.remove', { productId: WORKBOOK, assetId: 'owner-file' });
    const shown = await getChangeProposal(ownerSession, { id: removal.id }, h.deps);
    expect(shown.ok && Object.keys(shown.value.effect)).toEqual(['files']);
    const live = await h.stage(PDF, keyCtx(DIRECT, 'direct'));
    expect(await attachStagedProductDownload(keyCtx(DIRECT, 'direct'), { productId: WORKBOOK, stagedFileId: live.id }, h.deps)).toMatchObject({ ok: true });

    expect(await approveChangeProposal(ownerSession, { id: removal.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect((await assetsOf(WORKBOOK)).map((asset) => asset.id).sort()).toEqual(['owner-file', live.id].sort());
  });
});

describe('releasing proposed files on decisions', () => {
  it('releases the file of a rejected proposal and frees its budget only once the storage confirmed the deletion', async () => {
    const h = harness();
    const file = await h.stage();
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    h.objects.failDeletes = (objectKey) => objectKey === stagedKeyOf(file.id);
    expect(await rejectChangeProposal(ownerSession, { id: receipt.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'rejected' } });
    expect(await stagedRow(file.id)).toBeNull();
    expect(await owedRows()).toEqual([stagedKeyOf(file.id)]);
    expect(h.objects.objects.has(stagedKeyOf(file.id))).toBe(true);

    h.objects.failDeletes = () => false;
    await sweepKeyDownloadFiles(h.deps);
    expect(await owedRows()).toEqual([]);
    expect(h.objects.objects.has(stagedKeyOf(file.id))).toBe(false);
  });

  it('refuses to propose again a file whose rejected or expired proposal has not released it yet, and the sweep discards it', async () => {
    const h = harness();
    const rejected = await h.stage();
    const expiring = await h.stage();
    const first = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: rejected.id });
    const second = await h.propose('download.add', { productId: GUIDE, stagedFileId: expiring.id });
    await database.db.update(changeProposals).set({ status: 'rejected', decidedAt: NOW, decidedByUserId: 'user-owner' }).where(eq(changeProposals.id, first.id));
    h.clock.now = second.expiresAt;

    for (const file of [rejected, expiring]) {
      expect(await submitChangeProposal(keyCtx(), { operation: 'download.add', input: { productId: WORKBOOK, stagedFileId: file.id } }, h.deps))
        .toMatchObject({ ok: false, error: { code: 'validation', details: { fieldErrors: { stagedFileId: [expect.any(String)] } } } });
    }
    expect((await stagedRow(rejected.id))?.proposalId).toBe(first.id);
    expect((await stagedRow(expiring.id))?.proposalId).toBe(second.id);

    await sweepKeyDownloadFiles(h.deps);
    expect(await stagedRow(rejected.id)).toBeNull();
    expect(await stagedRow(expiring.id)).toBeNull();
  });

  it('releases the file of a withdrawn proposal at once', async () => {
    const h = harness();
    const file = await h.stage();
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    expect(await withdrawOwnChangeProposal(keyCtx(), { id: receipt.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'withdrawn' } });
    expect(await stagedRow(file.id)).toBeNull();
    expect(await owedRows()).toEqual([]);
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toEqual([]);
  });

  it('releases the file of an expired proposal when the expiry is recorded', async () => {
    const h = harness();
    const file = await h.stage();
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    h.clock.now = '2026-04-01T10:00:00.000Z';
    expect(await approveChangeProposal(ownerSession, { id: receipt.id }, h.deps)).toMatchObject({ ok: false, error: { details: { changeProposalStatus: 'expired' } } });
    expect(await stagedRow(file.id)).toBeNull();
  });

  it('withdraws the proposals of a revoked key and releases its files', async () => {
    const h = harness();
    const held = await h.stage();
    const loose = await h.stage();
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: held.id });
    expect(await revokeShopManagementKey(ownerSession, { id: PROPOSER }, h.deps)).toMatchObject({ ok: true });
    expect(await statusOf(receipt.id)).toBe('withdrawn');
    expect(await stagedRow(held.id)).toBeNull();
    expect(await stagedRow(loose.id)).toBeNull();
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/${PROPOSER}/`)).toEqual([]);
  });

  it.each([
    ['the key’s staged file count', async () => { await fillStaging(PROPOSER, 19, 19); }],
    ['the key’s staged bytes', async () => { await fillStaging(PROPOSER, KEY_DOWNLOAD_FILE_LIMITS.stagedBytesPerKey - 3 * PDF.byteLength); }],
    ['the workspace’s staged bytes', async () => { await fillStaging(OTHER_PROPOSER, KEY_DOWNLOAD_FILE_LIMITS.stagedBytesPerWorkspace - 3 * PDF.byteLength); }],
  ])('keeps a rejected file in %s until the storage confirmed its deletion', async (_limit, fill) => {
    const h = harness();
    const file = await h.stage();
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    await fill();
    h.objects.failDeletes = (objectKey) => objectKey === stagedKeyOf(file.id);
    expect(await rejectChangeProposal(ownerSession, { id: receipt.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'rejected' } });
    expect(await owedRows()).toEqual([stagedKeyOf(file.id)]);
    expect(await beginStaging(h)).toMatchObject({ ok: false, error: { code: 'conflict', details: { changeProposalCap: expect.any(String) } } });

    h.objects.failDeletes = () => false;
    await sweepKeyDownloadFiles(h.deps);
    expect(await owedRows()).toEqual([]);
    expect(await beginStaging(h)).toMatchObject({ ok: true });
  });

  it('keeps the staged file of an approval that failed, so the key can propose it again', async () => {
    const h = harness();
    const file = await h.stage();
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    for (let index = 0; index < KEY_DOWNLOAD_FILE_LIMITS.filesPerProduct; index += 1) await seedUploadingFile(h, `uploading-${String(index)}`);
    expect(await approveChangeProposal(ownerSession, { id: receipt.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'failed' } });
    expect(await stagedRow(file.id)).toMatchObject({ id: file.id, proposalId: null });
    expect(h.objects.objects.has(stagedKeyOf(file.id))).toBe(true);
    expect(await owedRows()).toEqual([]);
  });

  it('releases the file of every item when the owner rejects a group', async () => {
    const h = harness();
    const first = await h.stage();
    const second = await h.stage(LONGER_PDF);
    const group = await createChangeProposalGroup(keyCtx(), { title: 'Two editions' }, h.deps);
    if (!group.ok) throw new Error(group.error.message);
    for (const [productId, file] of [[WORKBOOK, first], [GUIDE, second]] as const) {
      expect(await submitGroupedChangeProposal(keyCtx(), { groupId: group.value.id, operation: 'download.add', input: { productId, stagedFileId: file.id } }, h.deps))
        .toMatchObject({ ok: true });
    }
    expect(await rejectChangeProposalGroup(ownerSession, { id: group.value.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'rejected' } });
    expect(await stagedRow(first.id)).toBeNull();
    expect(await stagedRow(second.id)).toBeNull();
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toEqual([]);
    expect(await owedRows()).toEqual([]);
  });

  it('releases the files that withdrawn proposals held when the owner purges the keys', async () => {
    const h = harness();
    const held = await h.stage();
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: held.id });
    expect(await purgeShopManagementKeys(ownerSession, h.deps)).toMatchObject({ ok: true });
    expect(await statusOf(receipt.id)).toBe('withdrawn');
    expect(await stagedRow(held.id)).toBeNull();
    expect(h.objects.objects.has(stagedKeyOf(held.id))).toBe(false);
  });

  it('keeps a file a pending, unexpired proposal holds past its seven days, and sweeps it once that proposal ended', async () => {
    const h = harness();
    const file = await h.stage();
    const loose = await h.stage();
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    h.clock.now = '2026-03-09T10:00:00.000Z';
    await sweepKeyDownloadFiles(h.deps);
    expect(await stagedRow(file.id)).not.toBeNull();
    expect(await stagedRow(loose.id)).toBeNull();

    h.clock.now = '2026-03-02T10:00:00.000Z';
    await database.db.update(changeProposals).set({ status: 'rejected', decidedAt: NOW, decidedByUserId: OWNER }).where(eq(changeProposals.id, receipt.id));
    await sweepKeyDownloadFiles(h.deps);
    expect(await stagedRow(file.id)).toBeNull();
    expect(h.objects.keysUnder(`${TENANT}/product-downloads/key-files/`)).toEqual([]);
  });
});

describe('a group with a proposed file', () => {
  const launch = async (h: Harness, fileId: string) => {
    const group = await createChangeProposalGroup(keyCtx(), { title: 'Launch the workbook pack' }, h.deps);
    if (!group.ok) throw new Error(group.error.message);
    const groupId = group.value.id;
    const add = async (operation: 'product.create' | 'download.add' | 'price.create' | 'product.publish', input: Record<string, unknown>) => {
      const added = await submitGroupedChangeProposal(keyCtx(), { groupId, operation, input }, h.deps);
      if (!added.ok) throw new Error(added.error.message);
      const item = added.value.items.at(-1);
      if (item === undefined) throw new Error('The group answered no item');
      return item.id;
    };
    const created = await add('product.create', { title: 'Workbook pack', slug: 'workbook-pack', type: 'digital_download', priceCents: 0, currency: 'EUR' });
    const itemIds = [
      created,
      await add('download.add', { productId: `$proposal:${created}`, stagedFileId: fileId }),
      await add('price.create', { productId: `$proposal:${created}`, kind: 'one_time', amountCents: 1900, currency: 'EUR' }),
      await add('product.publish', { id: `$proposal:${created}` }),
    ];
    return { groupId, itemIds };
  };

  it('approves a new digital product, its file, a price and publishing as one unit', async () => {
    const h = harness();
    const file = await h.stage();
    const { groupId, itemIds } = await launch(h, file.id);
    expect(await submitGroupedChangeProposal(keyCtx(), { groupId, operation: 'download.add', input: { productId: WORKBOOK, stagedFileId: file.id } }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await database.db.select().from(products).where(eq(products.slug, 'workbook-pack'))).toEqual([]);

    expect(await approveChangeProposalGroup(ownerSession, { id: groupId, itemIds }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    const [created] = await database.db.select().from(products).where(eq(products.slug, 'workbook-pack'));
    expect(created?.published).toBe(true);
    expect((await assetsOf(created?.id ?? '')).map((asset) => asset.id)).toEqual([file.id]);
    expect(await stagedRow(file.id)).toBeNull();
  });

  it('ends the whole group stale with the note on the item whose file is gone, and creates nothing', async () => {
    const h = harness();
    const file = await h.stage();
    const { groupId, itemIds } = await launch(h, file.id);
    expect(await discardKeyDownloadFile(keyCtx(), { id: file.id }, h.deps)).toMatchObject({ ok: true });

    expect(await approveChangeProposalGroup(ownerSession, { id: groupId, itemIds }, h.deps)).toMatchObject({ ok: true, value: { status: 'stale' } });
    expect(await database.db.select().from(products).where(eq(products.slug, 'workbook-pack'))).toEqual([]);
    const fileItem = itemIds[1] ?? '';
    expect(isChangeProposalFileMissingNote(await lastNote(fileItem))).toBe(true);
    expect(await lastNote(itemIds[0] ?? '')).toContain(`item 2 (${fileItem})`);
  });
});

describe('the storage checks of a group’s files before its approval', () => {
  it('answers a retry when the storage answers too slowly for the budget, and leaves the group open and every item pending', async () => {
    const h = harness();
    const files = [];
    for (let index = 0; index < 6; index += 1) files.push(await h.stage());
    const group = await createChangeProposalGroup(keyCtx(), { title: 'Six editions' }, h.deps);
    if (!group.ok) throw new Error(group.error.message);
    const itemIds = [];
    for (const file of files) {
      const added = await submitGroupedChangeProposal(keyCtx(), { groupId: group.value.id, operation: 'download.add', input: { productId: WORKBOOK, stagedFileId: file.id } }, h.deps);
      if (!added.ok) throw new Error(added.error.message);
      itemIds.push(added.value.items.at(-1)?.id ?? '');
    }
    const slowHead: StorageProvider['head'] = async (input) => {
      h.clock.now = new Date(Date.parse(h.clock.now) + KEY_DOWNLOAD_STORAGE_DEADLINES.headMs - 100).toISOString();
      return h.deps.storage.head(input);
    };
    const approval = await approveChangeProposalGroup(ownerSession, { id: group.value.id, itemIds }, { ...h.deps, storage: { ...h.deps.storage, head: slowHead } });
    expect(approval).toMatchObject({ ok: false, error: { code: 'unavailable', details: { retryAfterSeconds: CHANGE_PROPOSAL_APPROVAL_FILE_CHECKS.retryAfterSeconds } } });
    expect((await database.db.select().from(changeProposalGroups)).map((row) => row.id)).toEqual([group.value.id]);
    for (const id of itemIds) expect(await statusOf(id)).toBe('pending');
    expect(await assetsOf(WORKBOOK)).toEqual([]);
    for (const file of files) expect((await stagedRow(file.id))?.proposalId).not.toBeNull();
  });
});

describe('the owner file link', () => {
  it('answers a 60-second signed download of the proposed file that forces an opaque attachment', async () => {
    const h = harness();
    const name = 'work“book”.pdf';
    const file = await h.stage(PDF, keyCtx(), name);
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    h.objects.calls.length = 0;
    const link = await getChangeProposalFileLink(ownerSession, { id: receipt.id, fileId: file.id }, h.deps);
    if (!link.ok) throw new Error(link.error.message);
    expect(link.value.download).toMatchObject({ expiresAt: '2026-03-01T10:01:00.000Z', fileName: name, sizeBytes: PDF.byteLength });
    const url = new URL(link.value.download.url);
    expect(url.searchParams.get('response-content-disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    expect(url.searchParams.get('response-content-type')).toBe('application/octet-stream');
    expect(url.searchParams.get('response-cache-control')).toBe('no-store');
    expect(h.objects.calls.map((call) => call.method)).toEqual(['head', 'presignGet']);
  });

  it('finds nothing for a proposal past its expiry whose row is still pending', async () => {
    const h = harness();
    const file = await h.stage();
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    h.clock.now = '2026-04-01T10:00:00.000Z';
    h.objects.calls.length = 0;
    expect(await getChangeProposalFileLink(ownerSession, { id: receipt.id, fileId: file.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await statusOf(receipt.id)).toBe('pending');
    expect(h.objects.calls).toEqual([]);
  });

  it('is refused to every key, an admin, an impersonating or unverified owner, and finds nothing for another workspace, another file, a gone object or a decided proposal', async () => {
    const h = harness();
    const file = await h.stage();
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    const input = { id: receipt.id, fileId: file.id };
    const impersonating: Ctx = {
      identity: identity(),
      impersonation: {
        id: 'imp-1', actorUserId: OWNER, actorEmail: 'owner@example.test', actorName: 'Owner', actorStaffRole: 'owner',
        subjectMemberId: 'member-1', subjectName: 'Member', expiresAt: '2026-03-01T11:00:00.000Z',
      },
    };
    const refused: Ctx[] = [keyCtx(), keyCtx(DIRECT, 'direct'), { identity: identity({ staffRole: 'admin' }) }, { identity: identity({ emailVerified: false }) }, impersonating];
    for (const ctx of refused) {
      const answer = await getChangeProposalFileLink(ctx, input, h.deps);
      expect(answer.ok ? null : answer.error.code).toMatch(/^(forbidden|impersonation_read_only)$/u);
    }
    expect(await getChangeProposalFileLink({ identity: identity({}, NEIGHBOUR) }, input, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await getChangeProposalFileLink(ownerSession, { id: receipt.id, fileId: 'other-file' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    removeStagedObjects(h);
    expect(await getChangeProposalFileLink(ownerSession, input, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await rejectChangeProposal(ownerSession, { id: receipt.id }, h.deps)).toMatchObject({ ok: true });
    expect(await getChangeProposalFileLink(ownerSession, input, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.objects.calls.filter((call) => call.method === 'presignGet')).toEqual([]);
  });
});

type Pause = { at: 'lockStaged' | 'attach'; reached: () => void; resume: Promise<void> };

const pausedScope = (scope: ChangeProposalTransactionScope, pause: Pause, nested: boolean): ChangeProposalTransactionScope => {
  const { productFiles, keyDownloadAttach } = scope.repositories;
  return {
    ...scope,
    repositories: {
      ...scope.repositories,
      productFiles: pause.at !== 'lockStaged' || nested ? productFiles : {
        ...productFiles,
        lockStaged: async (tenantId, apiKeyId, id) => {
          const locked = await productFiles.lockStaged(tenantId, apiKeyId, id);
          pause.reached();
          await pause.resume;
          return locked;
        },
      },
      keyDownloadAttach: pause.at !== 'attach' || !nested ? keyDownloadAttach : {
        ...keyDownloadAttach,
        attach: async (tenantId, input) => {
          pause.reached();
          await pause.resume;
          return keyDownloadAttach.attach(tenantId, input);
        },
      },
    },
    savepoint: (operation) => scope.savepoint((inner) => operation(pausedScope(inner, pause, true))),
  };
};

const pausing = (transaction: ChangeProposalTransaction, pause: Pause): ChangeProposalTransaction => ({
  dryRun: transaction.dryRun,
  run: <T>(tenantId: string, operation: (scope: ChangeProposalTransactionScope) => Promise<Result<T, AppError>>, options?: { lockWaitMs?: number }) =>
    transaction.run<T>(tenantId, (scope) => operation(pausedScope(scope, pause, false)), options),
});

describe('lock order of an approval that attaches a file', () => {
  const setUp = async (h: Harness) => {
    expect(await createStockRepository(database.db).enableTracking(TENANT, { productId: WORKBOOK, onHand: 5, lowStockThreshold: null, actorUserId: null, now: NOW }))
      .toMatchObject({ ok: true });
    const proposed = await h.stage();
    const live = await h.stage(PDF, keyCtx(DIRECT, 'direct'));
    const receipt = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: proposed.id });
    return { live, receipt };
  };

  it('holding the proposing key’s staged row, never blocks a live attach of another key’s file or a stock adjustment', async () => {
    const h = harness();
    const { live, receipt } = await setUp(h);
    const reached = gate();
    const resume = gate();
    const approval = approveChangeProposal(ownerSession, { id: receipt.id }, {
      ...h.deps, changeProposalTransaction: pausing(h.deps.changeProposalTransaction, { at: 'lockStaged', reached: reached.open, resume: resume.opened }),
    });
    try {
      await reached.opened;
      expect(await attachStagedProductDownload(keyCtx(DIRECT, 'direct'), { productId: WORKBOOK, stagedFileId: live.id }, h.deps)).toMatchObject({ ok: true });
      expect(await createStockRepository(database.db).adjust(TENANT, { productId: WORKBOOK, delta: 1, reason: 'restock', actorUserId: null, now: NOW }))
        .toMatchObject({ ok: true, value: { onHand: 6 } });
    } finally {
      resume.open();
    }
    expect(await approval).toMatchObject({ ok: true, value: { status: 'stale' } });
  });

  it('holding the product for the attach, makes a live attach and a stock adjustment wait, and both finish once it applied', async () => {
    const h = harness();
    const { live, receipt } = await setUp(h);
    const observer = new pg.Client({ connectionString: database.url });
    await observer.connect();
    const reached = gate();
    const resume = gate();
    try {
      const approval = approveChangeProposal(ownerSession, { id: receipt.id }, {
        ...h.deps, changeProposalTransaction: pausing(h.deps.changeProposalTransaction, { at: 'attach', reached: reached.open, resume: resume.opened }),
      });
      await reached.opened;
      const attached = attachStagedProductDownload(keyCtx(DIRECT, 'direct'), { productId: WORKBOOK, stagedFileId: live.id }, h.deps);
      const adjusted = createStockRepository(database.db).adjust(TENANT, { productId: WORKBOOK, delta: 1, reason: 'restock', actorUserId: null, now: NOW });
      await untilWaiting(observer, 'The live attach and the stock adjustment', 2);
      resume.open();
      expect(await approval).toMatchObject({ ok: true, value: { status: 'applied' } });
      expect(await attached).toMatchObject({ ok: true });
      expect(await adjusted).toMatchObject({ ok: true, value: { onHand: 6 } });
    } finally {
      resume.open();
      await observer.end();
    }
    expect((await assetsOf(WORKBOOK)).length).toBe(2);
  });
});
