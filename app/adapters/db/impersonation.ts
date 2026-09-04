import { and, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import {
  impersonationSessionSchema,
  tenantAuditEventSchema,
  type ImpersonationSession,
  type TenantAuditEvent,
  type TenantAuditEventInput,
} from '#core/domain/index.js';
import type {
  ImpersonationSessionRepository,
  TenantAuditEventRepository,
} from '#core/server/index.js';

import type { Db } from './client.js';
import { members, impersonationSessions, tenantAuditEvents, user } from './schema.js';

const parseSession = (row: ImpersonationSession & { tokenHash: string }): ImpersonationSession =>
  impersonationSessionSchema.parse({
    id: row.id,
    tenantId: row.tenantId,
    actorUserId: row.actorUserId,
    actorSessionId: row.actorSessionId,
    subjectMemberId: row.subjectMemberId,
    reason: row.reason,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    endedAt: row.endedAt,
  });

const appendAudit = async (
  tx: Db,
  tenantId: string,
  events: TenantAuditEventInput[],
): Promise<void> => {
  if (events.length === 0) return;
  await tx.insert(tenantAuditEvents).values(events.map((event) => ({ ...event, tenantId })));
};

const encodeCursor = (event: TenantAuditEvent): string =>
  `${encodeURIComponent(event.at)}~${encodeURIComponent(event.id)}`;

const decodeCursor = (cursor: string): { at: string; id: string } => {
  const [at = '', id = ''] = cursor.split('~');
  return { at: decodeURIComponent(at), id: decodeURIComponent(id) };
};

export const createImpersonationSessionRepository = (
  db: Db,
): ImpersonationSessionRepository => ({
  open: async (tenantId, session, tokenHash, audit) => db.transaction(async (tx) => {
    // There is no row to lock before the first view of an acting login exists,
    // so concurrent starts would each supersede nothing and both insert.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${session.actorSessionId}`}, 0))`,
    );
    const superseded = await tx
      .update(impersonationSessions)
      .set({ endedAt: session.createdAt })
      .where(and(
        eq(impersonationSessions.tenantId, tenantId),
        eq(impersonationSessions.actorSessionId, session.actorSessionId),
        isNull(impersonationSessions.endedAt),
      ))
      .returning();
    await tx.insert(impersonationSessions).values({
      id: session.id,
      tenantId,
      actorUserId: session.actorUserId,
      actorSessionId: session.actorSessionId,
      subjectMemberId: session.subjectMemberId,
      tokenHash,
      reason: session.reason,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      endedAt: session.endedAt,
    });
    await appendAudit(tx, tenantId, audit(superseded.map(parseSession)));
  }),
  findById: async (tenantId, id) => {
    const [row] = await db
      .select()
      .from(impersonationSessions)
      .where(and(eq(impersonationSessions.tenantId, tenantId), eq(impersonationSessions.id, id)))
      .limit(1);
    return row === undefined ? null : { ...parseSession(row), tokenHash: row.tokenHash };
  },
  end: async (tenantId, id, endedAt, audit) => db.transaction(async (tx) => {
    const [row] = await tx
      .update(impersonationSessions)
      .set({ endedAt })
      .where(and(
        eq(impersonationSessions.tenantId, tenantId),
        eq(impersonationSessions.id, id),
        isNull(impersonationSessions.endedAt),
      ))
      .returning();
    if (row === undefined) return null;
    const ended = parseSession(row);
    await appendAudit(tx, tenantId, [audit(ended)]);
    return ended;
  }),
  endLapsed: async (tenantId, now, audit) => db.transaction(async (tx) => {
    const rows = await tx
      .update(impersonationSessions)
      .set({ endedAt: sql`${impersonationSessions.expiresAt}` })
      .where(and(
        eq(impersonationSessions.tenantId, tenantId),
        isNull(impersonationSessions.endedAt),
        lte(impersonationSessions.expiresAt, now),
      ))
      .returning();
    if (rows.length === 0) return 0;
    const actors = await tx
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(inArray(user.id, rows.map((row) => row.actorUserId)));
    const emailById = new Map(actors.map((actor) => [actor.id, actor.email]));
    const lapsed = rows.map((row) => ({
      session: parseSession(row),
      actorEmail: emailById.get(row.actorUserId) ?? row.actorUserId,
    }));
    await appendAudit(tx, tenantId, audit(lapsed));
    return lapsed.length;
  }),
  listLapsedTenantIds: async (now) => {
    const rows = await db
      .selectDistinct({ tenantId: impersonationSessions.tenantId })
      .from(impersonationSessions)
      .where(and(
        isNull(impersonationSessions.endedAt),
        lte(impersonationSessions.expiresAt, now),
      ));
    return rows.map((row) => row.tenantId);
  },
});

export const createTenantAuditEventRepository = (db: Db): TenantAuditEventRepository => ({
  list: async (tenantId, query) => {
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const rows = await db
      .select({
        event: tenantAuditEvents,
        subjectDisplayName: members.displayName,
        subjectEmail: members.email,
        subjectDeletedAt: members.deletedAt,
      })
      .from(tenantAuditEvents)
      .leftJoin(
        members,
        and(
          eq(members.tenantId, tenantAuditEvents.tenantId),
          eq(members.id, tenantAuditEvents.subjectMemberId),
        ),
      )
      .where(and(
        eq(tenantAuditEvents.tenantId, tenantId),
        cursor === undefined ? undefined : or(
          lt(tenantAuditEvents.at, cursor.at),
          and(eq(tenantAuditEvents.at, cursor.at), lt(tenantAuditEvents.id, cursor.id)),
        ),
      ))
      .orderBy(desc(tenantAuditEvents.at), desc(tenantAuditEvents.id))
      .limit(query.limit + 1);
    const events = rows.slice(0, query.limit).map((row) =>
      tenantAuditEventSchema.parse({
        ...row.event,
        subjectLabel: row.subjectDeletedAt === null
          ? row.subjectDisplayName ?? row.subjectEmail
          : null,
      }) satisfies TenantAuditEvent,
    );
    const last = events.at(-1);
    return {
      events,
      nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last) : null,
    };
  },
});
