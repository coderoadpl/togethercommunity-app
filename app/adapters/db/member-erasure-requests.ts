import { and, asc, desc, eq } from 'drizzle-orm';

import {
  memberErasureRequestSchema,
  memberErasureRequestWithMemberSchema,
} from '#core/domain/index.js';
import type { MemberErasureRequestRepository } from '#core/server/index.js';

import {
  memberErasureRequestEvents,
  memberErasureRequests,
  members,
} from './app-schema.js';
import type { Db } from './client.js';

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;

const uniqueViolation = (cause: unknown): boolean =>
  record(cause)?.['code'] === '23505' ||
  record(record(cause)?.['cause'])?.['code'] === '23505';

const iso = (value: string): string => new Date(value).toISOString();
const nullableIso = (value: string | null): string | null =>
  value === null ? null : iso(value);
const parseRequest = (row: typeof memberErasureRequests.$inferSelect) =>
  memberErasureRequestSchema.parse({
    ...row,
    requestedAt: iso(row.requestedAt),
    dueAt: iso(row.dueAt),
    resolvedAt: nullableIso(row.resolvedAt),
  });

export const createMemberErasureRequestRepository = (
  db: Db,
): MemberErasureRequestRepository => ({
  create: async (tenantId, request, event) => {
    try {
      await db.transaction(async (tx) => {
        await tx.insert(memberErasureRequests).values({ ...request, tenantId });
        await tx
          .insert(memberErasureRequestEvents)
          .values({ ...event, tenantId, requestId: request.id });
      });
      return 'created';
    } catch (cause) {
      if (uniqueViolation(cause)) return 'already-open';
      throw cause;
    }
  },
  findOpenForMember: async (tenantId, memberId) => {
    const [row] = await db
      .select()
      .from(memberErasureRequests)
      .where(
        and(
          eq(memberErasureRequests.tenantId, tenantId),
          eq(memberErasureRequests.memberId, memberId),
          eq(memberErasureRequests.status, 'open'),
        ),
      )
      .limit(1);
    return row === undefined ? null : parseRequest(row);
  },
  findLatestForMember: async (tenantId, memberId) => {
    const [row] = await db
      .select()
      .from(memberErasureRequests)
      .where(
        and(
          eq(memberErasureRequests.tenantId, tenantId),
          eq(memberErasureRequests.memberId, memberId),
        ),
      )
      .orderBy(desc(memberErasureRequests.requestedAt), desc(memberErasureRequests.id))
      .limit(1);
    return row === undefined ? null : parseRequest(row);
  },
  list: async (tenantId, query) => {
    const condition =
      query.status === undefined
        ? eq(memberErasureRequests.tenantId, tenantId)
        : and(
            eq(memberErasureRequests.tenantId, tenantId),
            eq(memberErasureRequests.status, query.status),
          );
    const rows = await db
      .select({ request: memberErasureRequests, member: members })
      .from(memberErasureRequests)
      .innerJoin(
        members,
        and(
          eq(members.tenantId, memberErasureRequests.tenantId),
          eq(members.id, memberErasureRequests.memberId),
        ),
      )
      .where(condition)
      .orderBy(asc(memberErasureRequests.requestedAt), asc(memberErasureRequests.id));
    return rows.map((row) =>
      memberErasureRequestWithMemberSchema.parse({
        ...parseRequest(row.request),
        member: {
          id: row.member.id,
          email: row.member.email,
          displayName: row.member.displayName,
        },
      }),
    );
  },
  resolve: async (tenantId, input, event) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .update(memberErasureRequests)
        .set({
          status: input.status,
          resolvedAt: input.resolvedAt,
          resolvedByUserId: input.resolvedByUserId,
          resolutionNote: input.resolutionNote,
        })
        .where(
          and(
            eq(memberErasureRequests.tenantId, tenantId),
            eq(memberErasureRequests.id, input.id),
            eq(memberErasureRequests.status, 'open'),
          ),
        )
        .returning();
      if (row === undefined) return null;
      await tx
        .insert(memberErasureRequestEvents)
        .values({ ...event, tenantId, requestId: input.id });
      return parseRequest(row);
    }),
});
