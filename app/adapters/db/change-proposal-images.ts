import { and, asc, count, eq, gt, isNotNull, isNull, lt, not, or, sql, type SQL } from 'drizzle-orm';

import {
  CHANGE_PROPOSAL_IMAGE_FIELDS,
  proposalImageExtensionsFor,
  proposalImagePublicationSchema,
  QUARANTINED_IMAGE_LIMITS,
  quarantinedImageAssetSchema,
  quarantinedImageUploadSchema,
  type ProposalImagePublication,
  type ProposalImageReference,
  type QuarantinedImageAsset,
  type QuarantinedImageUpload,
} from '#core/domain/index.js';
import type {
  ChangeProposalWrite,
  QuarantinedImageInsertion,
  QuarantinedImageLiveUse,
  QuarantinedImageLocks,
  QuarantinedImageRelease,
  QuarantinedImageReleaseEnd,
  QuarantinedImageRepository,
  QuarantinedImageUploadRecord,
} from '#core/server/index.js';

import { boundedAdvisoryLock, lockWaitMs } from './bounded-advisory-lock.js';
import { boundLockWait, busyAfterRollback, changeProposalBounds, lockWorkspaceProposals, type ChangeProposalBoundOptions } from './change-proposal-bounds.js';
import type { Db } from './client.js';
import {
  changeProposalImagePublications,
  changeProposalImages,
  changeProposalImageUploads,
  changeProposals,
  products,
  shopManagementKeys,
  tenants,
} from './schema.js';

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

const parsePublication = (row: typeof changeProposalImagePublications.$inferSelect): ProposalImagePublication => proposalImagePublicationSchema.parse({
  attemptId: row.attemptId,
  image: { kind: row.kind, digest: row.digest, extension: row.extension },
  startedAt: row.startedAt,
});

const parseUpload = (row: typeof changeProposalImageUploads.$inferSelect): QuarantinedImageUpload => quarantinedImageUploadSchema.parse({
  apiKeyId: row.apiKeyId,
  objectKey: row.objectKey,
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

const unreleased = isNull(changeProposalImages.releasedAt);

const keyLock = (tenantId: string, apiKeyId: string): string => `change-proposal-images:${tenantId}:${apiKeyId}`;

const findUnreleased = async (
  executor: Db,
  tenantId: string,
  apiKeyId: string,
  image: ProposalImageReference,
  lock: 'share' | 'key share' | null = null,
): Promise<QuarantinedImageAsset | null> => {
  const query = executor.select().from(changeProposalImages).where(and(imageOfKey(tenantId, apiKeyId, image), unreleased));
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
    if (await findUnreleased(executor, tenantId, apiKeyId, image, 'key share') === null) return false;
  }
  return true;
};

const rowPath = sql`'/api/public/assets/' || ${changeProposalImages.kind} || '/' || ${changeProposalImages.digest} || '.' || ${changeProposalImages.extension}`;

/** The SQL form of `changeProposalImageReferences`: a field of the operation holds the row's address and the row's kind and format fit the field. */
const fieldAttaches = or(...CHANGE_PROPOSAL_IMAGE_FIELDS.map(({ operation, field, kind }) => and(
  eq(changeProposals.operation, operation),
  eq(changeProposalImages.kind, kind),
  sql`${changeProposalImages.extension} in (${sql.join(proposalImageExtensionsFor(kind).map((extension) => sql`${extension}`), sql`, `)})`,
  sql`${changeProposals.input} ->> ${field}::text = ${rowPath}`,
)));

const attached = (now: string): SQL => sql`exists (select 1 from ${changeProposals} where ${and(
  eq(changeProposals.tenantId, changeProposalImages.tenantId),
  eq(changeProposals.proposedByKeyId, changeProposalImages.apiKeyId),
  eq(changeProposals.status, 'pending'),
  gt(changeProposals.expiresAt, now),
  fieldAttaches,
)})`;

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

const publicationOf = (tenantId: string, attemptId: string, image: ProposalImageReference): SQL | undefined => and(
  eq(changeProposalImagePublications.tenantId, tenantId),
  eq(changeProposalImagePublications.attemptId, attemptId),
  eq(changeProposalImagePublications.kind, image.kind),
  eq(changeProposalImagePublications.digest, image.digest),
  eq(changeProposalImagePublications.extension, image.extension),
);

export const createQuarantinedImageLocks = (executor: Db): QuarantinedImageLocks => ({
  ...liveUseOver(executor),
  lockForPublication: (tenantId, apiKeyId, image) => findUnreleased(executor, tenantId, apiKeyId, image, 'share'),
  inAppliedProposal: async (tenantId, path) => (await executor.select({ id: changeProposals.id }).from(changeProposals).where(and(
    eq(changeProposals.tenantId, tenantId),
    eq(changeProposals.status, 'applied'),
    sql`strpos(${changeProposals.input}::text, ${path}) > 0`,
  )).limit(1)).length > 0,
  claimPublications: async (tenantId, attemptId, images) => {
    if (images.length === 0) return true;
    const claimed = await executor.select({ kind: changeProposalImagePublications.kind }).from(changeProposalImagePublications)
      .where(or(...images.map((image) => publicationOf(tenantId, attemptId, image)))).for('update');
    return claimed.length === images.length;
  },
  settlePublications: async (tenantId, attemptId) => {
    await executor.delete(changeProposalImagePublications).where(and(
      eq(changeProposalImagePublications.tenantId, tenantId),
      eq(changeProposalImagePublications.attemptId, attemptId),
    ));
  },
  deletePublication: async (tenantId, attemptId, image) => {
    await executor.delete(changeProposalImagePublications).where(publicationOf(tenantId, attemptId, image));
  },
});

const keyIsActive = sql`exists (select 1 from ${shopManagementKeys} where ${shopManagementKeys.tenantId} = ${changeProposalImages.tenantId}
  and ${shopManagementKeys.id} = ${changeProposalImages.apiKeyId} and ${shopManagementKeys.revokedAt} is null)`;

const sweepable = (createdBefore: string, now: string): SQL | undefined => or(
  isNotNull(changeProposalImages.releasedAt),
  and(or(lt(changeProposalImages.createdAt, createdBefore), sql`not ${keyIsActive}`), not(attached(now))),
);

const selectionFilter = (tenantId: string, selection: QuarantinedImageRelease, now: string): SQL | undefined => {
  const workspace = eq(changeProposalImages.tenantId, tenantId);
  if (selection.kind === 'sweep') return and(workspace, sweepable(selection.createdBefore, now));
  const images = selection.images;
  return and(
    workspace,
    eq(changeProposalImages.apiKeyId, selection.apiKeyId),
    ...(images === undefined ? [] : [images.length === 0 ? sql`false` : or(...images.map(sameImage))]),
  );
};

type Settled<T> = { current: T | null };

const imageWaiting = sql`coalesce(${changeProposalImages.sweepAttemptedAt}, ${changeProposalImages.createdAt})`;

const uploadWaiting = sql`coalesce(${changeProposalImageUploads.sweepAttemptedAt}, ${changeProposalImageUploads.createdAt})`;

const publicationWaiting = sql`coalesce(${changeProposalImagePublications.sweepAttemptedAt}, ${changeProposalImagePublications.startedAt})`;

export const createQuarantinedImageRepository = (db: Db, options: ChangeProposalBoundOptions = {}): QuarantinedImageRepository => {
  const bounds = changeProposalBounds(options);
  const boundsFor = (wait: number | undefined) => wait === undefined ? bounds : { ...bounds, lockWaitMs: Math.min(bounds.lockWaitMs, lockWaitMs(wait)) };
  return {
    ...liveUseOver(db),
    insert: async (tenantId, asset, store) => {
      const parsed = quarantinedImageAssetSchema.parse(asset);
      if (parsed.tenantId !== tenantId) throw new Error('A quarantined image belongs to another tenant');
      const failed: Settled<QuarantinedImageInsertion> = { current: null };
      try {
        return await db.transaction(async (tx): Promise<QuarantinedImageInsertion> => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${keyLock(tenantId, parsed.apiKeyId)}, 0))`);
          const [row] = await tx.select().from(changeProposalImages).where(imageOfKey(tenantId, parsed.apiKeyId, parsed)).for('update');
          if (row !== undefined && row.releasedAt === null) {
            const stored = await store();
            return stored.ok ? { kind: 'existing', asset: parseImage(row) } : { kind: 'store_failed', error: stored.error };
          }
          const [usage] = await tx
            .select({ images: count(), bytes: sql<number>`coalesce(sum(${changeProposalImages.sizeBytes}), 0)::bigint` })
            .from(changeProposalImages)
            .where(and(eq(changeProposalImages.tenantId, tenantId), eq(changeProposalImages.apiKeyId, parsed.apiKeyId), unreleased));
          if ((usage?.images ?? 0) >= QUARANTINED_IMAGE_LIMITS.assetsPerKey) return { kind: 'cap_exceeded', cap: 'key_quarantined_images' };
          if (Number(usage?.bytes ?? 0) + parsed.sizeBytes > QUARANTINED_IMAGE_LIMITS.bytesPerKey) return { kind: 'cap_exceeded', cap: 'key_quarantined_bytes' };
          const [saved] = row === undefined
            ? await tx.insert(changeProposalImages).values(parsed).returning()
            : await tx.update(changeProposalImages).set({ sizeBytes: parsed.sizeBytes, createdAt: parsed.createdAt, releasedAt: null, sweepAttemptedAt: null })
              .where(imageOfKey(tenantId, parsed.apiKeyId, parsed)).returning();
          if (saved === undefined) throw new Error('Quarantined image write returned no row');
          const stored = await store();
          if (!stored.ok) {
            failed.current = { kind: 'store_failed', error: stored.error };
            tx.rollback();
          }
          return { kind: 'stored', asset: parseImage(saved) };
        });
      } catch (cause) {
        if (failed.current !== null) return failed.current;
        throw cause;
      }
    },
    find: (tenantId, apiKeyId, image) => findUnreleased(db, tenantId, apiKeyId, image),
    release: (tenantId, selection, now, wait) => busyAfterRollback(() => db.transaction(async (tx): Promise<ChangeProposalWrite<QuarantinedImageAsset[]>> => {
      const scoped = boundsFor(wait);
      if (!await lockWorkspaceProposals(tx, tenantId, scoped)) return { kind: 'busy' };
      await boundLockWait(tx, scoped);
      const query = tx.select().from(changeProposalImages).where(selectionFilter(tenantId, selection, now))
        .orderBy(asc(imageWaiting), asc(changeProposalImages.apiKeyId), asc(changeProposalImages.kind), asc(changeProposalImages.digest), asc(changeProposalImages.extension));
      const candidates = selection.kind === 'sweep' ? await query.limit(selection.limit).for('update') : await query.for('update');
      const earlier = candidates.filter((row) => row.releasedAt !== null);
      const fresh = candidates.filter((row) => row.releasedAt === null);
      const marked = fresh.length === 0 ? [] : await tx.update(changeProposalImages).set({ releasedAt: now }).where(and(
        eq(changeProposalImages.tenantId, tenantId),
        or(...fresh.map((row) => and(eq(changeProposalImages.apiKeyId, row.apiKeyId), sameImage(row)))),
        unreleased,
        not(attached(now)),
      )).returning();
      return { kind: 'written', value: [...earlier, ...marked].map(parseImage) };
    }), { kind: 'busy' } as const),
    finishRelease: (tenantId, asset, removeObject, now, wait) => busyAfterRollback(() => db.transaction(async (tx): Promise<QuarantinedImageReleaseEnd> => {
      const { lockWaitMs: scoped } = boundsFor(wait);
      if (!await boundedAdvisoryLock(tx, keyLock(tenantId, asset.apiKeyId), { lockWaitMs: scoped, lockWaitAfterMs: scoped })) return 'busy';
      const [row] = await tx.select().from(changeProposalImages).where(imageOfKey(tenantId, asset.apiKeyId, asset)).for('update');
      if (row === undefined) return 'gone';
      if (row.releasedAt === null) return 'revived';
      if (!await removeObject()) {
        await tx.update(changeProposalImages).set({ sweepAttemptedAt: now }).where(imageOfKey(tenantId, asset.apiKeyId, asset));
        return 'failed';
      }
      await tx.delete(changeProposalImages).where(imageOfKey(tenantId, asset.apiKeyId, asset));
      return 'removed';
    }), 'busy' as const),
    listTenantIdsToSweep: async (createdBefore, now, limit) =>
      (await db.select({ tenantId: changeProposalImages.tenantId }).from(changeProposalImages)
        .where(sweepable(createdBefore, now)).groupBy(changeProposalImages.tenantId)
        .orderBy(sql`min(${imageWaiting})`, asc(changeProposalImages.tenantId)).limit(limit)).map((row) => row.tenantId),
    recordUpload: (tenantId, upload, countedAfter) => {
      const parsed = quarantinedImageUploadSchema.parse(upload);
      return db.transaction(async (tx): Promise<QuarantinedImageUploadRecord> => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`change-proposal-image-uploads:${tenantId}:${parsed.apiKeyId}`}, 0))`);
        const [usage] = await tx.select({ uploads: count() }).from(changeProposalImageUploads).where(and(
          eq(changeProposalImageUploads.tenantId, tenantId),
          eq(changeProposalImageUploads.apiKeyId, parsed.apiKeyId),
          gt(changeProposalImageUploads.createdAt, countedAfter),
        ));
        if ((usage?.uploads ?? 0) >= QUARANTINED_IMAGE_LIMITS.uploadsPerKey) return { kind: 'cap_exceeded', cap: 'key_image_uploads' };
        await tx.insert(changeProposalImageUploads).values({ tenantId, ...parsed });
        return { kind: 'recorded' };
      });
    },
    listTenantIdsWithUploadsBefore: async (createdBefore, limit) =>
      (await db.select({ tenantId: changeProposalImageUploads.tenantId }).from(changeProposalImageUploads)
        .where(lt(changeProposalImageUploads.createdAt, createdBefore)).groupBy(changeProposalImageUploads.tenantId)
        .orderBy(sql`min(${uploadWaiting})`, asc(changeProposalImageUploads.tenantId)).limit(limit))
        .map((row) => row.tenantId),
    listUploadsBefore: async (tenantId, createdBefore, limit) =>
      (await db.select().from(changeProposalImageUploads)
        .where(and(eq(changeProposalImageUploads.tenantId, tenantId), lt(changeProposalImageUploads.createdAt, createdBefore)))
        .orderBy(asc(uploadWaiting), asc(changeProposalImageUploads.objectKey)).limit(limit)).map(parseUpload),
    deleteUpload: async (tenantId, objectKey) => {
      await db.delete(changeProposalImageUploads)
        .where(and(eq(changeProposalImageUploads.tenantId, tenantId), eq(changeProposalImageUploads.objectKey, objectKey)));
    },
    markUploadAttempted: async (tenantId, objectKey, now) => {
      await db.update(changeProposalImageUploads).set({ sweepAttemptedAt: now })
        .where(and(eq(changeProposalImageUploads.tenantId, tenantId), eq(changeProposalImageUploads.objectKey, objectKey)));
    },
    recordPublications: async (tenantId, attemptId, images, startedAt) => {
      if (images.length === 0) return;
      const rows = images.map((image) => proposalImagePublicationSchema.parse({ attemptId, image: { kind: image.kind, digest: image.digest, extension: image.extension }, startedAt }));
      await db.insert(changeProposalImagePublications)
        .values(rows.map((row) => ({ tenantId, attemptId: row.attemptId, ...row.image, startedAt: row.startedAt })))
        .onConflictDoNothing();
    },
    listTenantIdsWithPublicationsBefore: async (startedBefore, limit) =>
      (await db.select({ tenantId: changeProposalImagePublications.tenantId }).from(changeProposalImagePublications)
        .where(lt(changeProposalImagePublications.startedAt, startedBefore)).groupBy(changeProposalImagePublications.tenantId)
        .orderBy(sql`min(${publicationWaiting})`, asc(changeProposalImagePublications.tenantId)).limit(limit))
        .map((row) => row.tenantId),
    listPublicationsBefore: async (tenantId, startedBefore, limit) =>
      (await db.select().from(changeProposalImagePublications)
        .where(and(eq(changeProposalImagePublications.tenantId, tenantId), lt(changeProposalImagePublications.startedAt, startedBefore)))
        .orderBy(asc(publicationWaiting), asc(changeProposalImagePublications.attemptId), asc(changeProposalImagePublications.kind),
          asc(changeProposalImagePublications.digest), asc(changeProposalImagePublications.extension)).limit(limit)).map(parsePublication),
    markPublicationAttempted: async (tenantId, attemptId, image, now) => {
      await db.update(changeProposalImagePublications).set({ sweepAttemptedAt: now }).where(publicationOf(tenantId, attemptId, image));
    },
  };
};
