import { and, desc, eq } from 'drizzle-orm';

import { importAuditEventSchema, type ImportAuditEvent } from '#core/domain/index.js';
import type { ImportAuditEventRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { importAuditEvents, tenantApiKeys } from './schema.js';

const parseEvent = (event: ImportAuditEvent): ImportAuditEvent => importAuditEventSchema.parse(event);

export const createImportAuditEventRepository = (db: Db): ImportAuditEventRepository => ({
  append: async (tenantId, event) => {
    const [owned] = await db
      .select({ id: tenantApiKeys.id })
      .from(tenantApiKeys)
      .where(and(
        eq(tenantApiKeys.tenantId, tenantId),
        eq(tenantApiKeys.id, event.apiKeyId),
      ))
      .limit(1);
    if (owned === undefined) throw new Error('Import audit API key does not belong to tenant');
    await db.insert(importAuditEvents).values({
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
  },
  findLatestByImportKey: async (tenantId, kind, importKey) => {
    const rows = await db
      .select()
      .from(importAuditEvents)
      .where(and(
        eq(importAuditEvents.tenantId, tenantId),
        eq(importAuditEvents.kind, kind),
        eq(importAuditEvents.importKey, importKey),
      ))
      .orderBy(desc(importAuditEvents.at), desc(importAuditEvents.id))
      .limit(1);
    const row = rows[0];
    return row ? parseEvent(row) : null;
  },
  listByApiKey: async (tenantId, apiKeyId) =>
    (
      await db
        .select()
        .from(importAuditEvents)
        .where(and(
          eq(importAuditEvents.tenantId, tenantId),
          eq(importAuditEvents.apiKeyId, apiKeyId),
        ))
        .orderBy(desc(importAuditEvents.at), desc(importAuditEvents.id))
    ).map(parseEvent),
});
