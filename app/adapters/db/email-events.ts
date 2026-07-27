import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';

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
  reputationCounts: async (tenantId, window) => {
    const [[sendCounts], [eventCounts]] = await Promise.all([
      db.select({
        sends: sql<number>`count(*)::int`,
      }).from(campaignSends).where(and(
        eq(campaignSends.tenantId, tenantId),
        gte(campaignSends.sentAt, window.since),
        lte(campaignSends.sentAt, window.until),
      )),
      db.select({
        hardBounces: sql<number>`count(distinct case when ${emailEvents.type} = 'bounced' and ${emailEvents.meta}->>'classification' = 'hard' then ${emailEvents.refId} end)::int`,
        complaints: sql<number>`count(distinct case when ${emailEvents.type} = 'complained' then ${emailEvents.refId} end)::int`,
      }).from(emailEvents).where(and(
        eq(emailEvents.tenantId, tenantId),
        eq(emailEvents.mailKind, 'marketing'),
        gte(emailEvents.occurredAt, window.since),
        lte(emailEvents.occurredAt, window.until),
      )),
    ]);
    return {
      sends: sendCounts?.sends ?? 0,
      hardBounces: eventCounts?.hardBounces ?? 0,
      complaints: eventCounts?.complaints ?? 0,
    };
  },
});
