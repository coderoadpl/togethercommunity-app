import { and, asc, count, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm';

import {
  changeProposalImageReferences,
  QUARANTINED_IMAGE_LIMITS,
  quarantinedImageAssetSchema,
  type ProposalImageReference,
  type QuarantinedImageAsset,
} from '#core/domain/index.js';
import type {
  ChangeProposalWrite,
  QuarantinedImageInsertion,
  QuarantinedImageLiveUse,
  QuarantinedImageLocks,
  QuarantinedImageRelease,
  QuarantinedImageRepository,
} from '#core/server/index.js';

import { boundLockWait, busyAfterRollback, changeProposalBounds, lockWorkspaceProposals, type ChangeProposalBoundOptions } from './change-proposal-bounds.js';
import type { Db } from './client.js';
import { changeProposalImages, changeProposals, products, shopManagementKeys, tenants } from './schema.js';

type ChangeProposalImageRow = typeof changeProposalImages.$inferSelect;

const parseImage = (row: ChangeProposalImageRow): QuarantinedImageAsset => quarantinedImageAssetSchema.parse({
  tenantId: row.tenantId,
  apiKeyId: row.apiKeyId,
  kind: row.kind,
  digest: row.digest,
  extension: row.extension,
  sizeBytes: row.sizeBytes,
  createdAt: row.createdAt,
});

const sameImage = (image: ProposalImageReference): SQL | undefined => and(
  eq(changeProposalImages.kind, image.kind),
  eq(changeProposalImages.digest, image.digest),
  eq(changeProposalImages.extension, image.extension),
);

const imageOfKey = (tenantId: string, apiKeyId: string, image: ProposalImageReference): SQL | undefined => and(
  eq(changeProposalImages.tenantId, tenantId),
  eq(changeProposalImages.apiKeyId, apiKeyId),
  sameImage(image),
);

const findImage = async (
  executor: Db,
  tenantId: string,
  apiKeyId: string,
  image: ProposalImageReference,
  lock: 'share' | 'key share' | null = null,
): Promise<QuarantinedImageAsset | null> => {
  const query = executor.select().from(changeProposalImages).where(imageOfKey(tenantId, apiKeyId, image));
  const [row] = lock === null ? await query.limit(1) : await query.for(lock);
  return row === undefined ? null : parseImage(row);
};

export const quarantinedImagesPresent = async (
  executor: Db,
  tenantId: string,
  apiKeyId: string,
  images: readonly ProposalImageReference[],
): Promise<boolean> => {
  for (const image of images) {
    if (await findImage(executor, tenantId, apiKeyId, image, 'key share') === null) return false;
  }
  return true;
};

const liveUseOver = (executor: Db): QuarantinedImageLiveUse => ({
  inLiveUse: async (tenantId, path) => {
    const covers = await executor.select({ id: products.id }).from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.coverUrl, path))).limit(1);
    if (covers.length > 0) return true;
    const branding = await executor.select({ id: tenants.id }).from(tenants).where(and(
      eq(tenants.id, tenantId),
      or(eq(tenants.logoUrl, path), eq(tenants.logoDarkUrl, path), eq(tenants.faviconUrl, path), eq(tenants.ogImageUrl, path)),
    )).limit(1);
    return branding.length > 0;
  },
});

export const createQuarantinedImageLocks = (executor: Db): QuarantinedImageLocks => ({
  ...liveUseOver(executor),
  lockForPublication: (tenantId, apiKeyId, image) => findImage(executor, tenantId, apiKeyId, image, 'share'),
});

const keyIsActive = sql`exists (select 1 from ${shopManagementKeys} where ${shopManagementKeys.tenantId} = ${changeProposalImages.tenantId}
  and ${shopManagementKeys.id} = ${changeProposalImages.apiKeyId} and ${shopManagementKeys.revokedAt} is null)`;

const sweepable = (createdBefore: string): SQL | undefined =>
  or(lt(changeProposalImages.createdAt, createdBefore), sql`not ${keyIsActive}`);

const selectionFilter = (tenantId: string, selection: QuarantinedImageRelease): SQL | undefined => {
  const workspace = eq(changeProposalImages.tenantId, tenantId);
  if (selection.kind === 'sweep') return and(workspace, sweepable(selection.createdBefore));
  const images = selection.images;
  return and(
    workspace,
    eq(changeProposalImages.apiKeyId, selection.apiKeyId),
    ...(images === undefined ? [] : [images.length === 0 ? sql`false` : or(...images.map(sameImage))]),
  );
};

const referenceKey = (apiKeyId: string, image: ProposalImageReference): string =>
  `${apiKeyId}/${image.kind}/${image.digest}.${image.extension}`;

const referencedByPendingProposals = async (executor: Db, tenantId: string, keyIds: readonly string[], now: string): Promise<Set<string>> => {
  const pending = await executor
    .select({ operation: changeProposals.operation, input: changeProposals.input, keyId: changeProposals.proposedByKeyId })
    .from(changeProposals)
    .where(and(
      eq(changeProposals.tenantId, tenantId),
      inArray(changeProposals.proposedByKeyId, [...keyIds]),
      eq(changeProposals.status, 'pending'),
      gt(changeProposals.expiresAt, now),
    ));
  return new Set(pending.flatMap((row) =>
    changeProposalImageReferences(row.operation, row.input).map((image) => referenceKey(row.keyId, image))));
};

export const createQuarantinedImageRepository = (db: Db, options: ChangeProposalBoundOptions = {}): QuarantinedImageRepository => {
  const bounds = changeProposalBounds(options);
  return {
    ...liveUseOver(db),
    insert: async (tenantId, asset) => {
      const parsed = quarantinedImageAssetSchema.parse(asset);
      if (parsed.tenantId !== tenantId) throw new Error('A quarantined image belongs to another tenant');
      return db.transaction(async (tx): Promise<QuarantinedImageInsertion> => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`change-proposal-images:${tenantId}:${parsed.apiKeyId}`}, 0))`);
        const existing = await findImage(tx, tenantId, parsed.apiKeyId, parsed);
        if (existing !== null) return { kind: 'existing', asset: existing };
        const [usage] = await tx
          .select({ images: count(), bytes: sql<number>`coalesce(sum(${changeProposalImages.sizeBytes}), 0)::bigint` })
          .from(changeProposalImages)
          .where(and(eq(changeProposalImages.tenantId, tenantId), eq(changeProposalImages.apiKeyId, parsed.apiKeyId)));
        if ((usage?.images ?? 0) >= QUARANTINED_IMAGE_LIMITS.assetsPerKey) return { kind: 'cap_exceeded', cap: 'key_quarantined_images' };
        if (Number(usage?.bytes ?? 0) + parsed.sizeBytes > QUARANTINED_IMAGE_LIMITS.bytesPerKey) return { kind: 'cap_exceeded', cap: 'key_quarantined_bytes' };
        const [row] = await tx.insert(changeProposalImages).values(parsed).returning();
        if (row === undefined) throw new Error('Quarantined image insert returned no row');
        return { kind: 'stored', asset: parseImage(row) };
      });
    },
    find: (tenantId, apiKeyId, image) => findImage(db, tenantId, apiKeyId, image),
    release: (tenantId, selection, now) => busyAfterRollback(() => db.transaction(async (tx): Promise<ChangeProposalWrite<QuarantinedImageAsset[]>> => {
      if (!await lockWorkspaceProposals(tx, tenantId, bounds)) return { kind: 'busy' };
      await boundLockWait(tx, bounds);
      const query = tx.select().from(changeProposalImages).where(selectionFilter(tenantId, selection))
        .orderBy(asc(changeProposalImages.createdAt), asc(changeProposalImages.apiKeyId), asc(changeProposalImages.digest));
      const candidates = (selection.kind === 'sweep' ? await query.limit(selection.limit).for('update') : await query.for('update')).map(parseImage);
      if (candidates.length === 0) return { kind: 'written', value: [] };
      const referenced = await referencedByPendingProposals(tx, tenantId, [...new Set(candidates.map((image) => image.apiKeyId))], now);
      const released = candidates.filter((image) => !referenced.has(referenceKey(image.apiKeyId, image)));
      for (const image of released) await tx.delete(changeProposalImages).where(imageOfKey(tenantId, image.apiKeyId, image));
      return { kind: 'written', value: released };
    }), { kind: 'busy' } as const),
    listTenantIdsToSweep: async (createdBefore, limit) =>
      (await db.selectDistinct({ tenantId: changeProposalImages.tenantId }).from(changeProposalImages)
        .where(sweepable(createdBefore)).orderBy(asc(changeProposalImages.tenantId)).limit(limit)).map((row) => row.tenantId),
  };
};
