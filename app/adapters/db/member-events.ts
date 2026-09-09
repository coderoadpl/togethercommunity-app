import { and, desc, eq, sql } from 'drizzle-orm';

import {
  memberEventSchema,
  normalizeEmail,
  type MemberEvent,
} from '#core/domain/index.js';
import type { MemberEventRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { memberEvents, members } from './schema.js';

export const appendMemberEvent = async (
  db: Db,
  event: MemberEvent,
): Promise<void> => {
  const parsed = memberEventSchema.parse(event);
  const inserted = await db.insert(memberEvents).values(parsed).onConflictDoNothing({
    target: memberEvents.id,
  }).returning({ id: memberEvents.id });
  if (inserted.length > 0) return;

  const duplicates = await db.select({ id: memberEvents.id }).from(memberEvents).where(and(
    eq(memberEvents.tenantId, parsed.tenantId),
    eq(memberEvents.id, parsed.id),
    eq(memberEvents.memberId, parsed.memberId),
    eq(memberEvents.type, parsed.type),
    ...(parsed.type === 'grant' || parsed.type === 'revoke' ? [
      eq(memberEvents.occurredAt, parsed.occurredAt),
      sql`${memberEvents.payload} = ${JSON.stringify(parsed.payload)}::jsonb`,
    ] : []),
  ));
  if (duplicates.length === 0) throw new Error('Member event idempotency key collision');
};

// The persisted revision distinguishes transitions even when their timestamps and windows match.
type GrantMemberEvent = Extract<MemberEvent, { type: 'grant' | 'revoke' }>;

export const appendGrantMemberEvent = async (
  db: Db,
  event: Omit<Extract<GrantMemberEvent, { type: 'grant' }>, 'id'>
    | Omit<Extract<GrantMemberEvent, { type: 'revoke' }>, 'id'>,
  revision: number,
): Promise<void> => appendMemberEvent(db, {
  ...event,
  id: `grant-transition:${JSON.stringify([event.tenantId, event.payload.grantId, revision])}`,
});

export const appendEmailSentMemberEvents = async (
  db: Db,
  input: {
    tenantId: string;
    recipient: string;
    sendId: string;
    mailKind: 'transactional' | 'marketing';
    subject: string;
    source: string;
    transport: 'tenant-ses' | 'smtp' | 'resend' | 'platform';
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
