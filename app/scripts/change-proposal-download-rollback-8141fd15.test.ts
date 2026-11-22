// Literal copies of schemas and parsing steps of release 8141fd15, the release on production when download file
// proposals were added. They prove what that release does with what this release stores, so they must stay as that
// release shipped them and never follow the live schema.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createContentHash } from '#adapters/crypto/content-hash.js';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';
import { createChangeProposalGroupRepository } from '#adapters/db/change-proposal-groups.js';
import { createQuarantinedImageRepository } from '#adapters/db/change-proposal-images.js';
import { createChangeProposalOwnerNotifier, createChangeProposalPeopleReader } from '#adapters/db/change-proposal-people.js';
import { createChangeProposalTransaction } from '#adapters/db/change-proposal-transaction.js';
import { createChangeProposalEventRepository, createChangeProposalRepository, createChangeProposalTargetLabelReader } from '#adapters/db/change-proposals.js';
import { createKeyDownloadAttachRepository, createKeyDownloadFileRepository } from '#adapters/db/key-download-files.js';
import { createProductDownloadAssetRepository, createTenantSecretRepository } from '#adapters/db/repositories.js';
import { changeProposalEvents, changeProposals, productDownloadAssets, products, tenants } from '#adapters/db/schema.js';
import { createShopManagementKeyRepository } from '#adapters/db/shop-management-keys.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import type { Identity, ShopManagementKey } from '#core/domain/index.js';
import {
  approveChangeProposal,
  beginKeyDownloadUpload,
  completeKeyDownloadUpload,
  createChangeProposalGroup,
  discardKeyDownloadFile,
  getChangeProposal,
  shopManagementKeyCapabilities,
  submitChangeProposal,
  submitGroupedChangeProposal,
  type Ctx,
} from '#core/server/index.js';
import { createObjectStorageFake } from '#core/server/testing/object-storage-fake.js';

const changeProposalTargetKindSchema = z.enum(['product', 'price', 'sales-link', 'settings']);

const CHANGE_PROPOSAL_OPERATION_DEFINITIONS = [
  { operation: 'product.create', family: 'catalog', targetKind: 'product' },
  { operation: 'product.update', family: 'catalog', targetKind: 'product' },
  { operation: 'product.publish', family: 'catalog', targetKind: 'product' },
  { operation: 'product.unpublish', family: 'catalog', targetKind: 'product' },
  { operation: 'product.delete-draft', family: 'catalog', targetKind: 'product' },
  { operation: 'price.create', family: 'catalog', targetKind: 'product' },
  { operation: 'price.deactivate', family: 'catalog', targetKind: 'price' },
  { operation: 'stock.enable', family: 'catalog', targetKind: 'product' },
  { operation: 'stock.adjust', family: 'catalog', targetKind: 'product' },
  { operation: 'stock.set-threshold', family: 'catalog', targetKind: 'product' },
  { operation: 'sales-link.create', family: 'catalog', targetKind: 'sales-link' },
  { operation: 'sales-link.update', family: 'catalog', targetKind: 'sales-link' },
  { operation: 'sales-link.delete', family: 'catalog', targetKind: 'sales-link' },
  { operation: 'settings.update', family: 'settings', targetKind: 'settings' },
] as const;

type ChangeProposalOperationName = (typeof CHANGE_PROPOSAL_OPERATION_DEFINITIONS)[number]['operation'];

const nonEmpty = <T extends string>(values: readonly T[]): [T, ...T[]] => {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error('A change proposal enumeration needs at least one value');
  return [first, ...rest];
};

const changeProposalOperationSchema = z.enum(
  nonEmpty<ChangeProposalOperationName>(CHANGE_PROPOSAL_OPERATION_DEFINITIONS.map((definition) => definition.operation)),
);

const CHANGE_PROPOSAL_STORED_OPERATION_MAX_LENGTH = 64;

const changeProposalStoredOperationSchema = z.string()
  .max(CHANGE_PROPOSAL_STORED_OPERATION_MAX_LENGTH)
  .regex(/^[a-z]+(-[a-z]+)*[.][a-z]+(-[a-z]+)*$/);

const knownChangeProposalOperation = (operation: string): ChangeProposalOperationName | null => {
  const known = changeProposalOperationSchema.safeParse(operation);
  return known.success ? known.data : null;
};

const unknownChangeProposalOperationNote = (operation: string): string =>
  `This release does not know the operation "${operation}", so the proposal cannot be applied; nothing was changed`;

const changeProposalStatusSchema = z.enum(['pending', 'applied', 'rejected', 'stale', 'withdrawn', 'failed']);

const changeProposalDisplayStatusSchema = z.enum([...changeProposalStatusSchema.options, 'expired']);

const changeProposalEventKindSchema = z.enum([
  'proposed',
  'applied',
  'rejected',
  'stale',
  'withdrawn',
  'expired',
  'apply_failed',
]);

const CHANGE_PROPOSAL_LIMITS = {
  pendingPerKey: 200,
  pendingPerWorkspace: 1_000,
  createdPerKeyPerWindow: 500,
  creationWindowMs: 24 * 60 * 60 * 1000,
  effectMaxBytes: 1_280 * 1024,
  decisionNoteMaxLength: 500,
  groupTitleMaxLength: 500,
  eventNoteMaxLength: 500,
  keyNameMaxLength: 120,
  identifierMaxLength: 200,
  failureCodeMaxLength: 64,
  failureMessageMaxLength: 2_000,
} as const;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));

const changeProposalInputSchema = z.record(z.string(), jsonValueSchema);

const changeProposalFieldChangeSchema = z.object({ before: jsonValueSchema, after: jsonValueSchema }).strict();

const changeProposalDeltaChangeSchema = z.object({ delta: z.number().int() }).strict();

const changeProposalEffectSchema = z.record(
  z.string().min(1),
  z.union([changeProposalFieldChangeSchema, changeProposalDeltaChangeSchema]),
);

const changeProposalTimestampSchema = z.string().datetime({ precision: 3 });

const changeProposalIdentifierSchema = z.string().min(1).max(CHANGE_PROPOSAL_LIMITS.identifierMaxLength);

const changeProposalTargetSchema = z.object({
  kind: changeProposalTargetKindSchema,
  id: changeProposalIdentifierSchema.nullable(),
}).strict();

const changeProposalSchema = z.object({
  id: changeProposalIdentifierSchema,
  tenantId: z.string().min(1),
  groupId: changeProposalIdentifierSchema.nullable(),
  groupPosition: z.number().int().min(1).nullable(),
  operation: changeProposalStoredOperationSchema,
  input: changeProposalInputSchema,
  effect: changeProposalEffectSchema,
  target: changeProposalTargetSchema,
  status: changeProposalStatusSchema,
  proposedByKeyId: changeProposalIdentifierSchema,
  proposedByKeyName: z.string().min(1).max(CHANGE_PROPOSAL_LIMITS.keyNameMaxLength),
  proposedByIssuerUserId: z.string().min(1),
  createdAt: changeProposalTimestampSchema,
  expiresAt: changeProposalTimestampSchema,
  decidedByUserId: z.string().min(1).nullable(),
  decidedAt: changeProposalTimestampSchema.nullable(),
  decisionNote: z.string().max(CHANGE_PROPOSAL_LIMITS.decisionNoteMaxLength).nullable(),
  appliedResourceId: changeProposalIdentifierSchema.nullable(),
  failureCode: z.string().min(1).max(CHANGE_PROPOSAL_LIMITS.failureCodeMaxLength).nullable(),
  failureMessage: z.string().max(CHANGE_PROPOSAL_LIMITS.failureMessageMaxLength).nullable(),
}).strict().superRefine((proposal, context) => {
  if ((proposal.groupId === null) !== (proposal.groupPosition === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['groupPosition'], message: 'A group position needs a group and a group needs a position' });
  }
  const expectedKind = CHANGE_PROPOSAL_OPERATION_DEFINITIONS.find((definition) => definition.operation === proposal.operation)?.targetKind;
  if (expectedKind !== undefined && proposal.target.kind !== expectedKind) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['target', 'kind'], message: `${proposal.operation} targets a ${String(expectedKind)}` });
  }
});

type ChangeProposal = z.output<typeof changeProposalSchema>;

const changeProposalEventSchema = z.object({
  id: changeProposalIdentifierSchema,
  tenantId: z.string().min(1),
  proposalId: changeProposalIdentifierSchema,
  sequence: z.number().int().min(1),
  kind: changeProposalEventKindSchema,
  actorUserId: z.string().min(1).nullable(),
  apiKeyId: changeProposalIdentifierSchema.nullable(),
  note: z.string().max(CHANGE_PROPOSAL_LIMITS.eventNoteMaxLength).nullable(),
  at: changeProposalTimestampSchema,
}).strict().refine(
  (event) => event.actorUserId !== null || event.apiKeyId !== null,
  { message: 'A change proposal event needs an acting account or key', path: ['actorUserId'] },
);

const changeProposalExpired = (proposal: Pick<ChangeProposal, 'status' | 'expiresAt'>, now: string): boolean =>
  proposal.status === 'pending' && Date.parse(proposal.expiresAt) <= Date.parse(now);

type ChangeProposalRow = typeof changeProposals.$inferSelect;

const parseProposal = (row: ChangeProposalRow): ChangeProposal => changeProposalSchema.parse({
  id: row.id,
  tenantId: row.tenantId,
  groupId: row.groupId,
  groupPosition: row.groupPosition,
  operation: row.operation,
  input: row.input,
  effect: row.effect,
  target: { kind: row.targetKind, id: row.targetId },
  status: row.status,
  proposedByKeyId: row.proposedByKeyId,
  proposedByKeyName: row.proposedByKeyName,
  proposedByIssuerUserId: row.proposedByIssuerUserId,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  decidedByUserId: row.decidedByUserId,
  decidedAt: row.decidedAt,
  decisionNote: row.decisionNote,
  appliedResourceId: row.appliedResourceId,
  failureCode: row.failureCode,
  failureMessage: row.failureMessage,
});

const CHANGE_PROPOSAL_REFERENCE_PREFIX = '$proposal:';

const isChangeProposalReference = (value: string): boolean => value.startsWith(CHANGE_PROPOSAL_REFERENCE_PREFIX);

type FactsSubject = Pick<ChangeProposal, 'operation' | 'target' | 'status' | 'appliedResourceId'>;

const labelRequest = (proposal: FactsSubject): { kind: string; id: string } | null => {
  const { kind, id } = proposal.target;
  if (kind === 'settings') return null;
  const applied = proposal.status === 'applied' ? proposal.appliedResourceId : null;
  if (proposal.operation === 'price.create' && applied !== null) return { kind: 'price', id: applied };
  if (id !== null && !isChangeProposalReference(id)) return { kind, id };
  if (proposal.operation === 'price.create' || applied === null) return null;
  return { kind, id: applied };
};

type ApprovalOutcome = { status: 'expired'; at: string } | { status: 'stale'; note: string | null; at: string } | { status: 'runs' };

const applyLockedProposal = (proposal: ChangeProposal, afterProposalLock: string, lockTarget: () => never): ApprovalOutcome => {
  if (changeProposalExpired(proposal, afterProposalLock)) return { status: 'expired', at: afterProposalLock };
  const known = knownChangeProposalOperation(proposal.operation);
  if (known === null) return { status: 'stale', note: unknownChangeProposalOperationNote(proposal.operation), at: afterProposalLock };
  return lockTarget();
};

const changeProposalKeyStateSchema = z.enum(['active', 'expired', 'revoked', 'purged']);

const changeProposalEventViewSchema = z.object({
  sequence: z.number().int().min(1),
  kind: changeProposalEventKindSchema,
  actorUserId: z.string().nullable(),
  apiKeyId: z.string().nullable(),
  note: z.string().nullable(),
  at: z.string(),
}).strict();

const changeProposalIssuerSchema = z.object({
  issuerUserId: z.string(),
  issuerEmail: z.string().nullable(),
  issuerIsVerifiedOwner: z.boolean(),
  issuerIsFormerTeamMember: z.boolean(),
}).strict();

const priceKindSchema = z.enum(['one_time', 'recurring']);

const priceIntervalSchema = z.enum(['day', 'week', 'month', 'year']);

const changeProposalTargetPriceSchema = z.object({
  kind: priceKindSchema,
  interval: priceIntervalSchema.nullable(),
  intervalCount: z.number().int().min(1),
  amountCents: z.number().int().min(0),
  currency: z.string(),
}).strict();

const changeProposalOwnerViewSchema = z.object({
  id: z.string(),
  groupId: z.string().nullable(),
  groupTitle: z.string().nullable(),
  groupPosition: z.number().int().nullable(),
  operation: changeProposalStoredOperationSchema,
  target: changeProposalTargetSchema,
  targetLabel: z.string().nullable(),
  targetPrice: changeProposalTargetPriceSchema.nullable(),
  input: changeProposalInputSchema,
  effect: changeProposalEffectSchema,
  status: changeProposalDisplayStatusSchema,
  proposedBy: z.object({
    keyId: z.string(),
    keyName: z.string(),
    keyState: changeProposalKeyStateSchema,
  }).merge(changeProposalIssuerSchema).strict(),
  createdAt: z.string(),
  expiresAt: z.string(),
  decidedByUserId: z.string().nullable(),
  decidedByEmail: z.string().nullable(),
  decidedByIsFormerTeamMember: z.boolean(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  appliedResourceId: z.string().nullable(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
}).strict();

const changeProposalOwnerDetailSchema = changeProposalOwnerViewSchema.extend({
  events: z.array(changeProposalEventViewSchema),
}).strict();

const providerDiagnosticCodeSchema = z.enum([
  'storage.available',
  'email.available',
  'payment.available',
]);

const providerDiagnosticSchema = z.object({
  code: providerDiagnosticCodeSchema,
  message: z.string().min(1),
  details: z.object({ transport: z.string().min(1) }).optional(),
});

const PRODUCT_DOWNLOAD_MAX_BYTES = 1024 * 1024 * 1024;

const versionNoteSchema = z.string().trim().max(500);

const productDownloadStatusSchema = z.enum(['pending', 'ready']);

const productDownloadAssetSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  lineageId: z.string().min(1),
  versionNumber: z.number().int().positive().default(1),
  versionNote: versionNoteSchema.nullable().default(null),
  supersededAt: z.string().datetime().nullable().default(null),
  replacesAssetId: z.string().min(1).nullable().default(null),
  productId: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(PRODUCT_DOWNLOAD_MAX_BYTES),
  storageKey: z.string().min(1),
  status: productDownloadStatusSchema,
  createdAt: z.string().datetime(),
});

const TENANT = 't-change-proposal-rollback';
const NOW = '2026-03-01T10:00:00.000Z';
const PROPOSER = 'key-rollback-proposer';
const WORKBOOK = 'rollback-workbook';
const PDF = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 42]);

const proposerKey: ShopManagementKey = {
  id: PROPOSER, tenantId: TENANT, name: 'Rollback agent', keyHash: `hash-${PROPOSER}`, scopes: ['shop:catalog:read', 'shop:catalog:write'],
  mode: 'propose', issuedByUserId: 'user-issuer', createdAt: '2026-02-25T00:00:00.000Z', expiresAt: '2026-04-20T00:00:00.000Z', revokedAt: null,
};

const identity = (userId: string): Identity => ({
  userId, email: `${userId}@example.test`, name: 'Owner', emailVerified: true, tenantAccess: 'staff',
  tenantId: TENANT, tenantSlug: TENANT, tenantName: 'Rollback', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
});

const keyCtx: Ctx = {
  identity: identity('user-issuer'),
  capabilities: shopManagementKeyCapabilities(proposerKey),
  machineActor: { kind: 'shop_management_key', apiKeyId: PROPOSER, mode: 'propose' },
};

const ownerSession: Ctx = { identity: identity('user-owner') };

const secretCrypto = createSecretCrypto(Buffer.alloc(32, 7).toString('base64'));

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let ids = 0;

beforeAll(async () => {
  database = await createTestDatabase('together_change_proposal_rollback', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values({ id: TENANT, slug: 'rollback', name: 'Rollback', createdAt: NOW });
  await createTenantSecretRepository(database.db).upsert(TENANT, {
    id: `storage-configuration-${TENANT}`, tenantId: TENANT, key: 's3.configuration', maskedPreview: 'configured', updatedAt: NOW,
    ...secretCrypto.encrypt(JSON.stringify({
      provider: 'aws_s3', endpoint: 'https://storage.example.test', region: 'auto', bucket: 'assets', accessKeyId: 'a', secretAccessKey: 's',
    })),
  });
  await createShopManagementKeyRepository(database.db).create(TENANT, proposerKey, {
    id: 'key-event-created', tenantId: TENANT, apiKeyId: PROPOSER, kind: 'created', actorUserId: 'user-issuer',
    method: null, route: null, resourceId: null, at: proposerKey.createdAt,
  });
  await database.db.insert(products).values({
    id: WORKBOOK, tenantId: TENANT, slug: WORKBOOK, title: 'Workbook', type: 'digital_download', description: '', priceCents: 0, currency: 'EUR', createdAt: NOW,
  });
  await database.db.insert(productDownloadAssets).values({
    id: 'owner-file', tenantId: TENANT, productId: WORKBOOK, lineageId: 'owner-file', versionNumber: 1, versionNote: null, supersededAt: null,
    replacesAssetId: null, fileName: 'guide.pdf', contentType: 'application/pdf', sizeBytes: PDF.byteLength,
    storageKey: `${TENANT}/product-downloads/${WORKBOOK}/owner-file/guide.pdf`, status: 'ready', createdAt: NOW, sha256: null,
  });
});

afterAll(async () => { await database?.close(); });

const harness = () => {
  const objects = createObjectStorageFake({ sha256: (bytes) => createContentHash().sha256(bytes) });
  objects.objects.set(`${TENANT}/product-downloads/${WORKBOOK}/owner-file/guide.pdf`, { bytes: PDF, contentType: 'application/pdf' });
  const logger = { error: () => undefined };
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
    clock: { nowIso: () => NOW },
  };
  const stage = async (fileName: string) => {
    const started = await beginKeyDownloadUpload(keyCtx, { fileName, contentType: 'application/pdf', sizeBytes: PDF.byteLength }, deps);
    if (!started.ok) throw new Error(started.error.message);
    objects.objects.set(decodeURIComponent(new URL(started.value.upload.url).pathname.slice(1)), { bytes: PDF, contentType: 'application/pdf' });
    const completed = await completeKeyDownloadUpload(keyCtx, { uploadId: started.value.upload.id }, deps);
    if (!completed.ok) throw new Error(completed.error.message);
    return completed.value.file;
  };
  const propose = async (operation: 'download.add' | 'download.replace' | 'download.remove', input: Record<string, unknown>) => {
    const submitted = await submitChangeProposal(keyCtx, { operation, input }, deps);
    if (!submitted.ok) throw new Error(submitted.error.message);
    return submitted.value.id;
  };
  return { deps, stage, propose };
};

const storedRow = async (id: string): Promise<ChangeProposalRow> => {
  const [row] = await database.db.select().from(changeProposals).where(and(eq(changeProposals.tenantId, TENANT), eq(changeProposals.id, id)));
  if (row === undefined) throw new Error(`No stored proposal ${id}`);
  return row;
};

describe('release 8141fd15 reading what download file proposals store', () => {
  it('lists every stored download proposal, alone and in a group, and its approval ends stale as an unknown operation before any target lock', async () => {
    const h = harness();
    const added = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: (await h.stage('add.pdf')).id, versionNote: 'First edition' });
    const replaced = await h.propose('download.replace', { productId: WORKBOOK, replacesAssetId: 'owner-file', stagedFileId: (await h.stage('next.pdf')).id });
    const removed = await h.propose('download.remove', { productId: WORKBOOK, assetId: 'owner-file' });
    const group = await createChangeProposalGroup(keyCtx, { title: 'Launch' }, h.deps);
    if (!group.ok) throw new Error(group.error.message);
    const created = await submitGroupedChangeProposal(keyCtx, { groupId: group.value.id, operation: 'product.create', input: { title: 'Pack', slug: 'pack', type: 'digital_download', priceCents: 0, currency: 'EUR' } }, h.deps);
    if (!created.ok) throw new Error(created.error.message);
    const createdId = created.value.items.at(-1)?.id ?? '';
    const grouped = await submitGroupedChangeProposal(keyCtx, {
      groupId: group.value.id, operation: 'download.add', input: { productId: `$proposal:${createdId}`, stagedFileId: (await h.stage('pack.pdf')).id },
    }, h.deps);
    if (!grouped.ok) throw new Error(grouped.error.message);
    const groupedId = grouped.value.items.at(-1)?.id ?? '';

    for (const [id, operation] of [[added, 'download.add'], [replaced, 'download.replace'], [removed, 'download.remove'], [groupedId, 'download.add']] as const) {
      const previous = parseProposal(await storedRow(id));
      expect(previous).toMatchObject({ id, operation, status: 'pending', target: { kind: 'product' } });
      expect(Object.keys(previous.effect)).toEqual(['files']);
      expect(knownChangeProposalOperation(previous.operation)).toBeNull();
      expect(applyLockedProposal(previous, NOW, () => { throw new Error('release 8141fd15 locked a target of an operation it does not know'); }))
        .toEqual({ status: 'stale', note: `This release does not know the operation "${operation}", so the proposal cannot be applied; nothing was changed`, at: NOW });
    }
    expect(labelRequest(parseProposal(await storedRow(added)))).toEqual({ kind: 'product', id: WORKBOOK });
    expect(labelRequest(parseProposal(await storedRow(groupedId)))).toBeNull();
  });

  it('reads the events this release writes, the file_unavailable note included', async () => {
    const h = harness();
    const file = await h.stage('gone.pdf');
    const id = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    expect(await discardKeyDownloadFile(keyCtx, { id: file.id }, h.deps)).toMatchObject({ ok: true });
    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'stale' } });
    const events = await database.db.select().from(changeProposalEvents).where(eq(changeProposalEvents.proposalId, id));
    const previous = events.map((event) => changeProposalEventSchema.parse(event));
    expect(previous.map((event) => event.kind).sort()).toEqual(['proposed', 'stale']);
    expect(previous.find((event) => event.kind === 'stale')?.note).toMatch(/^file_unavailable: /u);
    expect(parseProposal(await storedRow(id)).status).toBe('stale');
  });

  it('reads a product file an approval attached, ignoring its sha256 column', async () => {
    const h = harness();
    const file = await h.stage('attached.pdf');
    const id = await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id });
    expect(await approveChangeProposal(ownerSession, { id }, h.deps)).toMatchObject({ ok: true, value: { status: 'applied' } });
    const [row] = await database.db.select().from(productDownloadAssets).where(and(eq(productDownloadAssets.tenantId, TENANT), eq(productDownloadAssets.id, file.id)));
    expect(row?.sha256).toMatch(/^[0-9a-f]{64}$/u);
    const previous = productDownloadAssetSchema.parse(row);
    expect(previous).toMatchObject({ id: file.id, status: 'ready', storageKey: row?.storageKey });
    expect(previous).not.toHaveProperty('sha256');
  });

  it('fails, as a client of that release, on an owner view that lists proposed files, and reads every other owner view', async () => {
    const h = harness();
    const file = await h.stage('client.pdf');
    const withFile = await getChangeProposal(ownerSession, { id: await h.propose('download.add', { productId: WORKBOOK, stagedFileId: file.id }) }, h.deps);
    const withoutFile = await getChangeProposal(ownerSession, { id: await h.propose('download.remove', { productId: WORKBOOK, assetId: 'owner-file' }) }, h.deps);
    if (!withFile.ok || !withoutFile.ok) throw new Error('The owner view did not answer');
    expect(changeProposalOwnerDetailSchema.safeParse(withFile.value).success).toBe(false);
    const withoutTheNewKey = Object.fromEntries(Object.entries(withFile.value).filter(([field]) => field !== 'proposedFiles'));
    expect(changeProposalOwnerDetailSchema.safeParse(withoutTheNewKey).success).toBe(true);
    expect(changeProposalOwnerDetailSchema.parse(withoutFile.value).operation).toBe('download.remove');
  });

  it('strips the new probe field from a storage diagnostic', () => {
    const diagnostic = { code: 'storage.available', message: 'Storage completed the write, read and delete probe.', signedResponseOverrides: 'honoured' };
    expect(providerDiagnosticSchema.parse(diagnostic)).toEqual({ code: 'storage.available', message: diagnostic.message });
  });
});
