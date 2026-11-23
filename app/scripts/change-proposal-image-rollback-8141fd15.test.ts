// Literal copies of schemas and parsing steps of release 8141fd15, the release on production when proposed images were
// added, and of the notification kinds of its parent release b6a8634a. They prove what those releases do with what this
// release stores and answers, so they must stay as those releases shipped them and never follow the live schema.
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
import { createTenantSecretRepository } from '#adapters/db/repositories.js';
import { type changeProposals, notifications, products, tenantAdmins, tenants, user } from '#adapters/db/schema.js';
import { createShopManagementKeyRepository } from '#adapters/db/shop-management-keys.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import type { Identity, ShopManagementKey } from '#core/domain/index.js';
import {
  approveChangeProposal,
  beginProductCoverUpload,
  beginProposedBrandingAssetUpload,
  beginProposedProductCoverUpload,
  completeProposedBrandingAssetUpload,
  completeProposedProductCoverUpload,
  createChangeProposalGroup,
  getChangeProposal,
  shopManagementKeyCapabilities,
  submitChangeProposal,
  submitGroupedChangeProposal,
  type Ctx,
} from '#core/server/index.js';
import { createObjectStorageFake } from '#core/server/testing/object-storage-fake.js';

import { imageUploadAnswer } from '../apps/server/src/shop-machine-auth.js';

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

const changeProposalKeyReceiptSchema = z.object({
  id: z.string(),
  status: changeProposalDisplayStatusSchema,
  operation: changeProposalStoredOperationSchema,
  target: changeProposalTargetSchema,
  groupId: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  input: changeProposalInputSchema,
  decisionNote: z.string().nullable(),
  appliedResourceId: z.string().nullable(),
  failureCode: z.string().nullable(),
}).strict();

const notificationKindSchema = z.enum([
  'thread-reply',
  'space-post',
  'lesson-question',
  'dm-message',
  'dm-report',
  'space-event',
  'tenant-domain-verified',
  'tenant-domain-error',
  'change-proposal',
]);

const notificationContextKindSchema = z.enum(['lesson', 'space', 'dm', 'tenant']);

const notificationPayloadSchema = z.object({
  rootPostId: z.string().min(1).nullable().default(null),
  postId: z.string().min(1).nullable().default(null),
  contextKind: notificationContextKindSchema,
  contextId: z.string().min(1).nullable().default(null),
  courseId: z.string().min(1).nullable().default(null),
  eventId: z.string().min(1).nullable().default(null),
  domain: z.string().min(1).nullable().default(null),
  lessonName: z.string().default(''),
  authorDisplay: z.string().trim().min(1).nullable().default(null),
  authorAvatarUrl: z.string().nullable().default(null),
  snippet: z.string(),
});

const notificationSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  recipientUserId: z.string().min(1),
  kind: notificationKindSchema,
  payload: notificationPayloadSchema,
  sourceKey: z.string().min(1).nullable().default(null),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

type Notification = z.output<typeof notificationSchema>;

const parseNotification = (notification: typeof notifications.$inferSelect): Notification =>
  notificationSchema.parse(notification);

const TENANT_DOMAIN_KINDS: readonly Notification['kind'][] = [
  'tenant-domain-verified',
  'tenant-domain-error',
];

const notificationSubject = (notification: Notification): string =>
  TENANT_DOMAIN_KINDS.includes(notification.kind)
    ? notification.payload.domain ?? ''
    : notification.kind === 'space-event'
      ? notification.payload.lessonName
      : notification.payload.authorDisplay ?? '';

const notificationKindSchemaOfB6a8634a = z.enum([
  'thread-reply',
  'space-post',
  'lesson-question',
  'dm-message',
  'dm-report',
  'space-event',
  'tenant-domain-verified',
  'tenant-domain-error',
]);

const notificationSchemaOfB6a8634a = notificationSchema.extend({ kind: notificationKindSchemaOfB6a8634a });

const productCoverUrlSchema = z.union([
  z
    .string()
    .trim()
    .url('Cover must be a valid URL')
    .regex(/^https?:\/\//iu, 'Cover URL must use HTTP or HTTPS'),
  z.string().trim().regex(/^\/\S+$/),
]);

const brandingAssetUrlSchema = z.union([z.string().url(), z.string().regex(/^\/\S+$/)]);

const imageAssetUploadOutputSchema = z.object({
  key: z.string().min(1),
  servePath: z.string().startsWith('/'),
  upload: z.object({
    url: z.string().url(),
    headers: z.record(z.string()),
    expiresAt: z.string().datetime(),
  }),
});

const imageAssetCompleteOutputSchema = z.object({
  url: z.string().startsWith('/'),
});

const IMAGE_ASSET_KINDS = [
  'course-cover',
  'product-cover',
  'logo',
  'logo-dark',
  'favicon',
  'share-image',
  'avatar',
] as const;

const imageAssetKindSchema = z.enum(IMAGE_ASSET_KINDS);

type ImageAssetKind = z.infer<typeof imageAssetKindSchema>;

const IMAGE_ASSET_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;

const IMAGE_ASSET_FAVICON_CONTENT_TYPES = [
  ...IMAGE_ASSET_CONTENT_TYPES,
  'image/x-icon',
  'image/vnd.microsoft.icon',
] as const;

const IMAGE_ASSET_SHARE_IMAGE_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

const CONTENT_TYPES_BY_KIND: Record<ImageAssetKind, readonly string[]> = {
  'course-cover': IMAGE_ASSET_CONTENT_TYPES,
  'product-cover': IMAGE_ASSET_CONTENT_TYPES,
  logo: IMAGE_ASSET_CONTENT_TYPES,
  'logo-dark': IMAGE_ASSET_CONTENT_TYPES,
  favicon: IMAGE_ASSET_FAVICON_CONTENT_TYPES,
  'share-image': IMAGE_ASSET_SHARE_IMAGE_CONTENT_TYPES,
  avatar: IMAGE_ASSET_SHARE_IMAGE_CONTENT_TYPES,
};

const imageAssetContentTypesFor = (kind: ImageAssetKind): readonly string[] =>
  CONTENT_TYPES_BY_KIND[kind];

const IMAGE_ASSET_CONTENT_TYPE_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
} as const;

const imageAssetFilePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|svg|ico)$/;

const fileContentType = (file: string) => Object.entries(IMAGE_ASSET_CONTENT_TYPE_BY_EXTENSION)
  .find(([extension]) => file.endsWith(`.${extension}`))?.[1];

const publicImageAssetFound = (input: { kind: string; file: string }): boolean => {
  const kind = imageAssetKindSchema.safeParse(input.kind);
  const fileMatch = imageAssetFilePattern.exec(input.file);
  if (!kind.success || fileMatch === null) return false;
  const contentType = fileContentType(input.file);
  if (contentType === undefined || !imageAssetContentTypesFor(kind.data).includes(contentType)
    || (kind.data === 'avatar' && contentType !== 'image/webp')) {
    return false;
  }
  return true;
};

const orphanReportReferences = (tenantId: string, value: string): string[] =>
  [...value.matchAll(/\/api\/public\/assets\/(course-cover|product-cover|logo-dark|logo|favicon|share-image|avatar)\/([0-9a-f-]{36}\.(?:png|jpg|webp|svg|ico))/gi)]
    .map((match) => `image-assets/${tenantId}/${String(match[1])}/${String(match[2])}`);

const TENANT = 'acme';
const NOW = '2026-03-01T10:00:00.000Z';
const OWNER = 'user-owner';
const ISSUER = 'user-issuer';
const PROPOSER = 'key-image-rollback';
const MUG = 'acme-mug';
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const proposerKey: ShopManagementKey = {
  id: PROPOSER, tenantId: TENANT, name: 'Acme image agent', keyHash: `hash-${PROPOSER}`,
  scopes: ['shop:catalog:read', 'shop:catalog:write', 'shop:settings:read', 'shop:settings:write'],
  mode: 'propose', issuedByUserId: ISSUER, createdAt: '2026-02-25T00:00:00.000Z', expiresAt: '2026-04-20T00:00:00.000Z', revokedAt: null,
};

const identity = (userId: string): Identity => ({
  userId, email: `${userId}@example.test`, name: 'Owner', emailVerified: true, tenantAccess: 'staff',
  tenantId: TENANT, tenantSlug: TENANT, tenantName: 'Acme', staffRole: 'owner', memberId: null, image: null,
  memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
});

const keyCtx: Ctx = {
  identity: identity(ISSUER),
  capabilities: shopManagementKeyCapabilities(proposerKey),
  machineActor: { kind: 'shop_management_key', apiKeyId: PROPOSER, mode: 'propose' },
};

const ownerSession: Ctx = { identity: identity(OWNER) };

const secretCrypto = createSecretCrypto(Buffer.alloc(32, 7).toString('base64'));

const DIGEST_ADDRESS = /^\/api\/public\/assets\/[a-z-]+\/[0-9a-f]{64}[.][a-z]+$/u;

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let ids = 0;
let variant = 0;

beforeAll(async () => {
  database = await createTestDatabase('together_change_proposal_image_rollback', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values({ id: TENANT, slug: TENANT, name: 'Acme', createdAt: NOW });
  await createTenantSecretRepository(database.db).upsert(TENANT, {
    id: `storage-configuration-${TENANT}`, tenantId: TENANT, key: 's3.configuration', maskedPreview: 'configured', updatedAt: NOW,
    ...secretCrypto.encrypt(JSON.stringify({
      provider: 'aws_s3', endpoint: 'https://storage.example.test', region: 'auto', bucket: 'assets', accessKeyId: 'a', secretAccessKey: 's',
    })),
  });
  await database.db.insert(user).values({ id: OWNER, email: 'owner@example.test', name: 'Owner', emailVerified: true });
  await database.db.insert(tenantAdmins).values({ id: 'grant-owner', tenantId: TENANT, userId: OWNER, role: 'owner' });
  await createShopManagementKeyRepository(database.db).create(TENANT, proposerKey, {
    id: 'key-event-created', tenantId: TENANT, apiKeyId: PROPOSER, kind: 'created', actorUserId: ISSUER,
    method: null, route: null, resourceId: null, at: proposerKey.createdAt,
  });
  await database.db.insert(products).values({
    id: MUG, tenantId: TENANT, slug: MUG, title: 'Acme mug', type: 'physical', description: '', priceCents: 0, currency: 'EUR', createdAt: NOW,
  });
});

afterAll(async () => { await database?.close(); });

const harness = () => {
  const objects = createObjectStorageFake();
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
    storage: objects.storage,
    secretResolver: createTenantSecretResolver(createTenantSecretRepository(database.db), secretCrypto),
    contentHash: createContentHash(),
    logger,
    ids: { nextId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` },
    clock: { nowIso: () => NOW },
  };
  const upload = async (family: 'cover' | 'logo'): Promise<string> => {
    const bytes = new Uint8Array([...PNG, ++variant]);
    const input = { kind: family === 'cover' ? 'product-cover' as const : 'logo' as const, fileName: 'image.png', contentType: 'image/png' as const, sizeBytes: bytes.byteLength };
    const started = family === 'cover' ? await beginProposedProductCoverUpload(keyCtx, input, deps) : await beginProposedBrandingAssetUpload(keyCtx, input, deps);
    if (!started.ok) throw new Error(started.error.message);
    objects.objects.set(started.value.key, { bytes, contentType: 'image/png' });
    const completed = family === 'cover'
      ? await completeProposedProductCoverUpload(keyCtx, { key: started.value.key }, deps)
      : await completeProposedBrandingAssetUpload(keyCtx, { key: started.value.key }, deps);
    if (!completed.ok) throw new Error(completed.error.message);
    return completed.value.url;
  };
  const propose = async (operation: 'product.update' | 'settings.update', input: Record<string, unknown>) => {
    const submitted = await submitChangeProposal(keyCtx, { operation, input }, deps);
    if (!submitted.ok) throw new Error(submitted.error.message);
    return submitted.value;
  };
  return { objects, deps, upload, propose };
};

const storedRow = async (id: string): Promise<ChangeProposalRow> => {
  const row = await database.db.query.changeProposals.findFirst({ where: (table, { and, eq }) => and(eq(table.tenantId, TENANT), eq(table.id, id)) });
  if (row === undefined) throw new Error(`No stored proposal ${id}`);
  return row;
};

const countResultSchema = z.object({ rows: z.tuple([z.object({ count: z.coerce.number() })]) });

const countQuery = async (statement: string): Promise<number> =>
  countResultSchema.parse(await database.db.execute(statement)).rows[0].count;

const ownerNotification = () => database.db.query.notifications.findFirst({
  where: (table, { and, eq }) => and(eq(table.recipientUserId, OWNER), eq(table.kind, 'change-proposal')),
});

const PENDING_DIGEST_PROPOSALS = `select count(*) from change_proposals
where status = 'pending' and input::text ~ '/api/public/assets/[a-z-]+/[0-9a-f]{64}[.]'`;

const LIVE_DIGEST_FIELDS = `select
  (select count(*) from products where cover_url ~ '^/api/public/assets/[a-z-]+/[0-9a-f]{64}[.]')
  + (select count(*) from tenants where concat_ws(' ', logo_url, logo_dark_url, favicon_url, og_image_url) ~ '/api/public/assets/[a-z-]+/[0-9a-f]{64}[.]')
  as count`;

describe('release 8141fd15 reading what proposed images store', () => {
  it('reads a pending cover and logo proposal and their receipts and owner views, and would apply the address without publishing it', async () => {
    const h = harness();
    const cover = await h.upload('cover');
    const logo = await h.upload('logo');
    expect(cover).toMatch(DIGEST_ADDRESS);
    const coverReceipt = await h.propose('product.update', { id: MUG, coverUrl: cover });
    const logoReceipt = await h.propose('settings.update', { logoUrl: logo });

    expect(changeProposalKeyReceiptSchema.parse(coverReceipt)).toMatchObject({ operation: 'product.update', input: { id: MUG, coverUrl: cover } });
    expect(changeProposalKeyReceiptSchema.parse(logoReceipt)).toMatchObject({ operation: 'settings.update', input: { logoUrl: logo } });
    for (const [id, field, address] of [[coverReceipt.id, 'coverUrl', cover], [logoReceipt.id, 'logoUrl', logo]] as const) {
      const previous = parseProposal(await storedRow(id));
      expect(previous.status).toBe('pending');
      expect(knownChangeProposalOperation(previous.operation)).toBe(previous.operation);
      expect(previous.effect[field]).toEqual({ before: null, after: address });
      const view = await getChangeProposal(ownerSession, { id }, h.deps);
      if (!view.ok) throw new Error(view.error.message);
      expect(changeProposalOwnerDetailSchema.parse(view.value).effect[field]).toEqual({ before: null, after: address });
    }
    expect(productCoverUrlSchema.nullable().optional().parse(cover)).toBe(cover);
    expect(brandingAssetUrlSchema.nullable().parse(logo)).toBe(logo);
    expect(await countQuery(PENDING_DIGEST_PROPOSALS)).toBe(2);
  });

  it('reads the image_unavailable note of a stale approval like any other note', async () => {
    const h = harness();
    const cover = await h.upload('cover');
    const receipt = await h.propose('product.update', { id: MUG, coverUrl: cover });
    for (const key of h.objects.keysUnder('image-asset-quarantine/')) h.objects.objects.delete(key);
    expect(await approveChangeProposal(ownerSession, { id: receipt.id }, h.deps)).toMatchObject({ ok: true, value: { status: 'stale' } });
    const events = await database.db.query.changeProposalEvents.findMany({ where: (table, { eq }) => eq(table.proposalId, receipt.id) });
    const previous = events.map((event) => changeProposalEventSchema.parse(event));
    expect(previous.map((event) => event.kind).sort()).toEqual(['proposed', 'stale']);
    expect(previous.find((event) => event.kind === 'stale')?.note).toMatch(/^image_unavailable: /u);
    expect(parseProposal(await storedRow(receipt.id)).status).toBe('stale');
  });

  it('reads a product cover and a logo an approval published, and its public route does not serve their digest file names', async () => {
    const h = harness();
    const cover = await h.upload('cover');
    const logo = await h.upload('logo');
    const coverApproval = await approveChangeProposal(ownerSession, { id: (await h.propose('product.update', { id: MUG, coverUrl: cover })).id }, h.deps);
    const logoApproval = await approveChangeProposal(ownerSession, { id: (await h.propose('settings.update', { logoUrl: logo })).id }, h.deps);
    if (!coverApproval.ok || !logoApproval.ok) throw new Error('An approval did not answer');
    expect(changeProposalOwnerViewSchema.parse(coverApproval.value).status).toBe('applied');
    expect(changeProposalOwnerViewSchema.parse(logoApproval.value).status).toBe('applied');

    const product = await database.db.query.products.findFirst({ columns: { coverUrl: true }, where: (table, { and, eq }) => and(eq(table.tenantId, TENANT), eq(table.id, MUG)) });
    const workspace = await database.db.query.tenants.findFirst({ columns: { logoUrl: true }, where: (table, { eq }) => eq(table.id, TENANT) });
    expect(productCoverUrlSchema.nullable().parse(product?.coverUrl)).toBe(cover);
    expect(brandingAssetUrlSchema.nullable().parse(workspace?.logoUrl)).toBe(logo);
    expect(await countQuery(LIVE_DIGEST_FIELDS)).toBe(2);

    for (const address of [cover, logo]) {
      const [, , , , kind = '', file = ''] = address.split('/');
      expect(h.objects.objects.has(`image-assets/${TENANT}/${kind}/${file}`)).toBe(true);
      expect(publicImageAssetFound({ kind, file })).toBe(false);
      expect(orphanReportReferences(TENANT, address)).toEqual([]);
    }
    expect(publicImageAssetFound({ kind: 'product-cover', file: '00000000-0000-4000-8000-000000000001.png' })).toBe(true);
  });

  it('reads the notification a proposal raises and still names the key and the group from the community fields', async () => {
    const h = harness();
    await database.db.delete(notifications);
    await h.propose('product.update', { id: MUG, title: 'Acme mug, second edition' });
    const single = await ownerNotification();
    if (single === undefined) throw new Error('No notification was raised');
    const previousSingle = parseNotification(single);
    expect(previousSingle).toMatchObject({ kind: 'change-proposal', payload: { authorDisplay: proposerKey.name, contextId: null, snippet: '' } });
    expect(previousSingle.payload).not.toHaveProperty('changeProposal');
    expect(notificationSubject(previousSingle)).toBe(proposerKey.name);

    await database.db.delete(notifications);
    const group = await createChangeProposalGroup(keyCtx, { title: 'Acme spring launch' }, h.deps);
    if (!group.ok) throw new Error(group.error.message);
    const grouped = await submitGroupedChangeProposal(keyCtx, { groupId: group.value.id, operation: 'product.update', input: { id: MUG, description: 'Spring' } }, h.deps);
    if (!grouped.ok) throw new Error(grouped.error.message);
    const inGroup = await ownerNotification();
    if (inGroup === undefined) throw new Error('No notification was raised for the group');
    const previousGroup = parseNotification(inGroup);
    expect(previousGroup.payload).toMatchObject({ authorDisplay: proposerKey.name, contextId: group.value.id, snippet: 'Acme spring launch' });
    expect(notificationSubject(previousGroup)).toBe(proposerKey.name);
  });

  it('is refused by release b6a8634a, which has no change-proposal notification kind', async () => {
    const row = await ownerNotification();
    if (row === undefined) throw new Error('No change-proposal notification is stored');
    expect(notificationSchemaOfB6a8634a.safeParse(row).success).toBe(false);
    expect(notificationSchemaOfB6a8634a.safeParse({ ...row, kind: 'tenant-domain-verified' }).success).toBe(true);
  });
});

describe('a client of release 8141fd15 reading the image upload answers of this release', () => {
  it('fails on the begin answer of a propose-mode key, reads its completion without the quarantined flag, and reads every answer of a direct-mode key', async () => {
    const h = harness();
    const input = { kind: 'product-cover' as const, fileName: 'image.png', contentType: 'image/png' as const, sizeBytes: PNG.byteLength };
    const proposed = await beginProposedProductCoverUpload(keyCtx, input, h.deps);
    if (!proposed.ok) throw new Error(proposed.error.message);
    const quarantinedAnswer = imageUploadAnswer(proposed.value, 'image/png', true);
    expect(quarantinedAnswer.servePath).toBeNull();
    expect(imageAssetUploadOutputSchema.safeParse(quarantinedAnswer).success).toBe(false);

    h.objects.objects.set(proposed.value.key, { bytes: new Uint8Array([...PNG, ++variant]), contentType: 'image/png' });
    const completed = await completeProposedProductCoverUpload(keyCtx, { key: proposed.value.key }, h.deps);
    if (!completed.ok) throw new Error(completed.error.message);
    expect(imageAssetCompleteOutputSchema.parse(completed.value)).toEqual({ url: completed.value.url });

    const started = await beginProductCoverUpload(ownerSession, input, h.deps);
    if (!started.ok) throw new Error(started.error.message);
    const directAnswer = imageUploadAnswer(started.value, 'image/png', false);
    expect(directAnswer).not.toHaveProperty('quarantined');
    expect(imageAssetUploadOutputSchema.parse(directAnswer).servePath).toBe(started.value.servePath);
  });
});
