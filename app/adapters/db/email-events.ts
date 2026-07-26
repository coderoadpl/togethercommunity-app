import { and, asc, eq, sql } from 'drizzle-orm';

import { emailEventSchema, normalizeEmail, type EmailEvent } from '@core/domain/index.js';
import type { EmailEventRepository } from '@core/server/index.js';

import type { Db } from './client.js';
import { campaignSends, emailEvents, emailOutbox } from './schema.js';

const parseEvent = (row: typeof emailEvents.$inferSelect): EmailEvent => emailEventSchema.parse({
  ...row,
  occurredAt: new Date(row.occurredAt).toISOString(),
  createdAt: new Date(row.createdAt).toISOString(),
});

const orderedEvents = (db: Db) => db.select().from(emailEvents)
  .orderBy(asc(emailEvents.occurredAt), asc(emailEvents.sequence));

export const createEmailEventRepository = (db: Db): EmailEventRepository => ({
  append: async (tenantId, event) => {
    await db.insert(emailEvents).values(emailEventSchema.parse({ ...event, tenantId }));
  },
  listByRef: async (tenantId, mailKind, refId) =>
    (await orderedEvents(db).where(and(
      eq(emailEvents.tenantId, tenantId),
      eq(emailEvents.mailKind, mailKind),
      eq(emailEvents.refId, refId),
    ))).map(parseEvent),
  listByEmailAcrossKinds: async (tenantId, email) =>
    (await orderedEvents(db).where(and(
      eq(emailEvents.tenantId, tenantId),
      sql`(
        (${emailEvents.mailKind} = 'marketing' and exists (
          select 1 from ${campaignSends}
          where ${campaignSends.tenantId} = ${tenantId}
            and ${campaignSends.id} = ${emailEvents.refId}
            and ${campaignSends.email} = ${normalizeEmail(email)}
        ))
        or
        (${emailEvents.mailKind} = 'transactional' and exists (
          select 1 from ${emailOutbox}
          where ${emailOutbox.tenantId} = ${tenantId}
            and ${emailOutbox.id} = ${emailEvents.refId}
            and lower(trim(${emailOutbox.to})) = ${normalizeEmail(email)}
        ))
      )`,
    ))).map(parseEvent),
});
