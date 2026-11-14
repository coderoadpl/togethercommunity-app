import { and, eq } from 'drizzle-orm';

import { importAuditEventSchema, type ImportAuditEvent } from '#core/domain/index.js';

import type { Db } from './client.js';
import { importAuditEvents, tenantApiKeys } from './schema.js';

export const parseOwnedImportAuditEvent = async (
  executor: Db,
  tenantId: string,
  rawEvent: unknown,
): Promise<ImportAuditEvent> => {
  const event = importAuditEventSchema.parse(rawEvent);
  const [owned] = await executor
    .select({ id: tenantApiKeys.id })
    .from(tenantApiKeys)
    .where(and(eq(tenantApiKeys.tenantId, tenantId), eq(tenantApiKeys.id, event.apiKeyId)))
    .limit(1);
  if (owned === undefined) throw new Error('Import audit API key does not belong to tenant');
  return event;
};

export const insertImportAuditEvent = async (
  executor: Db,
  tenantId: string,
  rawEvent: unknown,
): Promise<void> => {
  const event = await parseOwnedImportAuditEvent(executor, tenantId, rawEvent);
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
