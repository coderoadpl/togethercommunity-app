import { and, desc, eq, sql } from 'drizzle-orm';

import {
  memberEventSchema,
  normalizeEmail,
  type MemberEvent,
} from '#core/domain/index.js';
import type { MemberEventRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { memberEvents, members } from './schema.js';

export const appendMemberEvent = async (db: Db, event: MemberEvent): Promise<void> => {
  const parsed = memberEventSchema.parse(event);
  await db.insert(memberEvents).values(parsed).onConflictDoNothing({ target: memberEvents.id });
};

export const appendEmailSentMemberEvents = async (
  db: Db,
  input: {
    tenantId: string;
    recipient: string;
    sendId: string;
    mailKind: 'transactional' | 'marketing';
    subject: string;
    source: string;
    transport: 'tenant-ses' | 'smtp' | 'platform';
    occurredAt: string;
  },
): Promise<void> => {
  const recipient = normalizeEmail(input.recipient);
  const rows = await db.select({ memberId: members.id }).from(members).where(and(
    eq(members.tenantId, input.tenantId),
    sql`lower(btrim(${members.email})) = ${recipient}`,
  ));
  for (const row of rows) {
    await appendMemberEvent(db, memberEventSchema.parse({
      id: `email-sent:${input.mailKind}:${input.sendId}:${row.memberId}`,
      tenantId: input.tenantId,
      memberId: row.memberId,
      type: 'email-sent',
      payload: {
        sendId: input.sendId,
        mailKind: input.mailKind,
        subject: input.subject,
        source: input.source,
        transport: input.transport,
      },
      occurredAt: input.occurredAt,
    }));
  }
};

export const createMemberEventRepository = (db: Db): MemberEventRepository => ({
  append: async (tenantId, event) => appendMemberEvent(
    db,
    memberEventSchema.parse({ ...event, tenantId }),
  ),
  listForMember: async (tenantId, memberId) => (
    await db.select().from(memberEvents).where(and(
      eq(memberEvents.tenantId, tenantId),
      eq(memberEvents.memberId, memberId),
    )).orderBy(desc(memberEvents.occurredAt), desc(memberEvents.sequence))
  ).flatMap((event) => {
    const parsed = memberEventSchema.safeParse(event);
    return parsed.success ? [parsed.data] : [];
  }),
});
