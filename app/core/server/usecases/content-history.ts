import {
  entityHistoryQuerySchema,
  err,
  forbidden,
  notFound,
  ok,
  readSnapshot,
  tenantNotFound,
  validation,
  type AppError,
  type EntityHistoryEntry,
  type EntityVersionDetail,
  type Result,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type { EntityVersionRepository } from '../ports.js';

export interface ContentHistoryDeps {
  entityVersions: EntityVersionRepository;
}

const requireStaffTenant = (ctx: Ctx): Result<string, AppError> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to read content history'));
  if (!ctx.identity.staffRole) return err(forbidden('Only tenant staff can read content history'));
  return ok(ctx.identity.tenantId);
};

/** Lists snapshot versions (newest first) for one entity, capped by `limit`. */
export const getContentHistory = async (
  ctx: Ctx,
  input: unknown,
  deps: ContentHistoryDeps,
): Promise<Result<EntityHistoryEntry[], AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  const parsed = entityHistoryQuerySchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid history query', parsed.error.flatten()));
  return ok(
    await deps.entityVersions.list(tenant.value, {
      entityKind: parsed.data.entityKind,
      entityId: parsed.data.entityId,
      limit: parsed.data.limit,
    }),
  );
};

/** Fetches one stored version and upcasts its payload to the current schema. */
export const getContentVersion = async (
  ctx: Ctx,
  versionId: string,
  deps: ContentHistoryDeps,
): Promise<Result<EntityVersionDetail, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  if (versionId.length === 0) return err(validation('Missing version id'));

  const record = await deps.entityVersions.findById(tenant.value, versionId);
  if (!record) return err(notFound(`No version "${versionId}" in this tenant`));

  const read = readSnapshot(record.entityKind, {
    schemaVersion: record.schemaVersion,
    payload: record.payload,
  });
  if (!read.ok) return read;

  return ok({
    id: record.id,
    entityKind: record.entityKind,
    entityId: record.entityId,
    schemaVersion: record.schemaVersion,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    currentSchemaVersion: read.value.schemaVersion,
    payload: read.value.payload,
  });
};
