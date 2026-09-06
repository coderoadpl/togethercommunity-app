import { and, desc, eq } from 'drizzle-orm';

import { snapshotPayloadsEqual } from '#core/domain/index.js';
import type { EntityVersionRecord } from '#core/server/index.js';

import type { Db } from './client.js';
import { entityVersions } from './schema.js';

/**
 * Writes a snapshot into `entity_versions`. Runs on whichever executor (`db`
 * or a `tx`) is passed so the write is atomic with the mutation it belongs to,
 * and skips a payload identical to the latest stored one.
 */
export const insertEntityVersion = async (
  executor: Db,
  tenantId: string,
  version: EntityVersionRecord,
): Promise<void> => {
  const latest = await executor
    .select({ schemaVersion: entityVersions.schemaVersion, payload: entityVersions.payload })
    .from(entityVersions)
    .where(
      and(
        eq(entityVersions.tenantId, tenantId),
        eq(entityVersions.entityKind, version.entityKind),
        eq(entityVersions.entityId, version.entityId),
      ),
    )
    .orderBy(desc(entityVersions.createdAt))
    .limit(1);
  const latestRow = latest[0];
  if (
    latestRow &&
    latestRow.schemaVersion === version.schemaVersion &&
    snapshotPayloadsEqual(latestRow.payload, version.payload)
  ) {
    return;
  }
  await executor.insert(entityVersions).values({
    id: version.id,
    tenantId,
    entityKind: version.entityKind,
    entityId: version.entityId,
    schemaVersion: version.schemaVersion,
    payload: version.payload,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
  });
};
