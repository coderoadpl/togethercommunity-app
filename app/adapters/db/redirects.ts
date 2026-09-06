import { and, eq } from 'drizzle-orm';

import {
  importAuditEventSchema,
  tenantRedirectSchema,
  type TenantRedirect,
} from '#core/domain/index.js';
import type { ImportRedirectMutation, ImportRedirectRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { uniqueViolation } from './pg-errors.js';
import { importAuditEvents, tenantApiKeys, tenantRedirects } from './schema.js';

const FROM_PATH_CONSTRAINT = 'tenant_redirects_tenant_from_path_uidx';

type RedirectRow = typeof tenantRedirects.$inferSelect;

const toRedirect = (row: RedirectRow): TenantRedirect =>
  tenantRedirectSchema.parse({ ...row, createdAt: new Date(row.createdAt).toISOString() });

const insertAuditEvent = async (
  executor: Db,
  tenantId: string,
  mutation: ImportRedirectMutation,
): Promise<void> => {
  const event = importAuditEventSchema.parse(mutation.event);
  const [owned] = await executor
    .select({ id: tenantApiKeys.id })
    .from(tenantApiKeys)
    .where(and(eq(tenantApiKeys.tenantId, tenantId), eq(tenantApiKeys.id, event.apiKeyId)))
    .limit(1);
  if (owned === undefined) throw new Error('Import audit API key does not belong to tenant');
  await executor.insert(importAuditEvents).values({
    id: event.id,
    tenantId,
    apiKeyId: event.apiKeyId,
    kind: event.kind,
    importKey: event.importKey,
    resourceId: event.resourceId,
    action: event.action,
    payloadHash: event.payloadHash,
    at: event.at,
  });
};

export const createTenantRedirectRepository = (db: Db): ImportRedirectRepository => {
  const findById = async (tenantId: string, redirectId: string): Promise<TenantRedirect | null> => {
    const [row] = await db
      .select()
      .from(tenantRedirects)
      .where(and(eq(tenantRedirects.tenantId, tenantId), eq(tenantRedirects.id, redirectId)))
      .limit(1);
    return row === undefined ? null : toRedirect(row);
  };

  return {
    findById,
    findByFromPath: async (tenantId, fromPath) => {
      const [row] = await db
        .select()
        .from(tenantRedirects)
        .where(and(eq(tenantRedirects.tenantId, tenantId), eq(tenantRedirects.fromPath, fromPath)))
        .limit(1);
      return row === undefined ? null : toRedirect(row);
    },
    listByTenant: async (tenantId) => {
      const rows = await db
        .select()
        .from(tenantRedirects)
        .where(eq(tenantRedirects.tenantId, tenantId))
        .orderBy(tenantRedirects.fromPath);
      return rows.map(toRedirect);
    },
    commit: async (tenantId, mutation) => {
      const redirect = tenantRedirectSchema.parse(mutation.resource);
      try {
        return await db.transaction(async (tx) => {
          if (mutation.action === 'created') {
            await tx.insert(tenantRedirects).values({ ...redirect, tenantId });
          }
          if (mutation.action === 'updated') {
            const rows = await tx
              .update(tenantRedirects)
              .set({
                fromPath: redirect.fromPath,
                targetKind: redirect.targetKind,
                targetId: redirect.targetId,
                targetPath: redirect.targetPath,
                permanent: redirect.permanent,
                createdAt: redirect.createdAt,
              })
              .where(and(
                eq(tenantRedirects.tenantId, tenantId),
                eq(tenantRedirects.id, redirect.id),
              ))
              .returning({ id: tenantRedirects.id });
            if (rows.length !== 1) return 'conflict';
          }
          await insertAuditEvent(tx, tenantId, mutation);
          return 'saved';
        });
      } catch (cause) {
        if (uniqueViolation(cause, FROM_PATH_CONSTRAINT)) return 'path_taken';
        throw cause;
      }
    },
  };
};
