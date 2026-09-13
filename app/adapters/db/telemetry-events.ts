import { and, eq } from 'drizzle-orm';

import { emailEventSchema, type EmailEvent } from '#core/domain/email-event.js';
import { normalizeEmailTelemetry } from '#core/domain/telemetry.js';

import type { Db } from './client.js';
import { campaignSends, emailEvents } from './schema.js';
import { appendTelemetry } from './telemetry-outbox.js';

export const appendEmailEvents = async (db: Db, events: EmailEvent[]): Promise<void> => {
  for (const event of events) {
    const parsed = emailEventSchema.parse(event);
    await db.insert(emailEvents).values(parsed);
    if (parsed.mailKind !== 'marketing') continue;
    const [send] = await db.select().from(campaignSends).where(and(eq(campaignSends.tenantId, parsed.tenantId), eq(campaignSends.id, parsed.refId)));
    if (send === undefined) continue;
    const normalized = normalizeEmailTelemetry(parsed, {
      campaignId: send.campaignId, contactId: send.contactId, memberId: send.memberId,
      sesMessageId: send.sesMessageId, trackingPolicyVersion: '1',
    });
    if (normalized !== null) await appendTelemetry(db, normalized);
  }
};
