import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';

import {
  importAuditEventSchema,
  memberCourseProgressSchema,
  memberEventSchema,
  normalizeEmail,
  productGrantSchema,
} from '#core/domain/index.js';
import type {
  ImportMemberResource,
  ImportUsersMutation,
  ImportUsersRepository,
} from '#core/server/index.js';

import type { Db } from './client.js';
import { appendMemberEvent } from './member-events.js';
import { uniqueViolation } from './pg-errors.js';
import {
  account,
  importAuditEvents,
  memberCourseProgress,
  members,
  productGrants,
  tenantAdmins,
  tenantApiKeys,
  user,
} from './schema.js';

const parseMember = (row: typeof members.$inferSelect): ImportMemberResource => ({
  id: row.id,
  tenantId: row.tenantId,
  userId: row.userId,
  email: normalizeEmail(row.email),
  displayName: row.displayName ?? row.email,
  legacyId: row.legacyId,
  createdAt: row.createdAt,
});

const parseProgress = (
  row: typeof memberCourseProgress.$inferSelect,
) => memberCourseProgressSchema.parse({
  ...row,
  lastViewedLessonId: row.lastViewedLessonId ?? undefined,
  lastViewedModuleId: row.lastViewedModuleId ?? undefined,
  lastViewedChapterId: row.lastViewedChapterId ?? undefined,
});

const insertAuditEvent = async (
  executor: Db,
  tenantId: string,
  mutation: ImportUsersMutation,
): Promise<void> => {
  const event = importAuditEventSchema.parse(mutation.event);
  const [owned] = await executor
    .select({ id: tenantApiKeys.id })
    .from(tenantApiKeys)
    .where(and(eq(tenantApiKeys.tenantId, tenantId), eq(tenantApiKeys.id, event.apiKeyId)))
    .limit(1);
  if (owned === undefined) throw new Error('Import audit API key does not belong to tenant');
  await executor.insert(importAuditEvents).values(event);
};

const ensureAuthUser = async (
  executor: Db,
  mutation: Extract<ImportUsersMutation, { kind: 'member' }>,
): Promise<boolean> => {
  const normalizedEmail = normalizeEmail(mutation.resource.email);
  if (mutation.authUser.action === 'create') {
    const [existing] = await executor
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(btrim(${user.email})) = ${normalizedEmail}`)
      .limit(1);
    if (existing !== undefined) return false;
    const createdAt = new Date(mutation.resource.createdAt);
    await executor.insert(user).values({
      id: mutation.resource.userId,
      name: mutation.authUser.name,
      email: normalizedEmail,
      emailVerified: mutation.authUser.emailVerified,
      createdAt,
      updatedAt: createdAt,
    });
  } else {
    const [existing] = await executor
      .select({ id: user.id })
      .from(user)
      .where(and(
        eq(user.id, mutation.resource.userId),
        sql`lower(btrim(${user.email})) = ${normalizedEmail}`,
      ))
      .limit(1);
    if (existing === undefined) return false;
  }
  return true;
};

const commitMember = async (
  executor: Db,
  tenantId: string,
  mutation: Extract<ImportUsersMutation, { kind: 'member' }>,
): Promise<boolean> => {
  if (!await ensureAuthUser(executor, mutation)) return false;
  if (mutation.action === 'created') {
    await executor.insert(members).values({
      id: mutation.resource.id,
      tenantId,
      userId: mutation.resource.userId,
      email: mutation.resource.email,
      displayName: mutation.resource.displayName,
      legacyId: mutation.resource.legacyId,
      createdAt: mutation.resource.createdAt,
    });
    return true;
  }
  const [current] = await executor
    .select({ id: members.id, userId: members.userId, email: members.email })
    .from(members)
    .where(and(
      eq(members.tenantId, tenantId),
      eq(members.id, mutation.resource.id),
      isNull(members.deletedAt),
    ))
    .limit(1);
  if (
    current === undefined
    || current.userId !== mutation.resource.userId
    || normalizeEmail(current.email) !== mutation.resource.email
  ) return false;
  if (mutation.action === 'unchanged') return true;
  const updated = await executor
    .update(members)
    .set({
      displayName: mutation.resource.displayName,
      legacyId: mutation.resource.legacyId,
      createdAt: mutation.resource.createdAt,
    })
    .where(and(
      eq(members.tenantId, tenantId),
      eq(members.id, mutation.resource.id),
      isNull(members.deletedAt),
    ))
    .returning({ id: members.id });
  return updated.length === 1;
};

const commitGrant = async (
  executor: Db,
  tenantId: string,
  mutation: Extract<ImportUsersMutation, { kind: 'grant' }>,
): Promise<boolean> => {
  const grant = productGrantSchema.parse(mutation.resource);
  if (mutation.action === 'created') {
    await executor.insert(productGrants).values({ ...grant, tenantId });
  } else {
    const [current] = await executor
      .select({ memberId: productGrants.memberId, productId: productGrants.productId })
      .from(productGrants)
      .where(and(eq(productGrants.tenantId, tenantId), eq(productGrants.id, grant.id)))
      .limit(1);
    if (
      current === undefined
      || current.memberId !== grant.memberId
      || current.productId !== grant.productId
    ) return false;
    if (mutation.action === 'updated') {
      const updated = await executor
        .update(productGrants)
        .set({
          startsAt: grant.startsAt,
          expiresAt: grant.expiresAt,
          legacyId: grant.legacyId,
        })
        .where(and(eq(productGrants.tenantId, tenantId), eq(productGrants.id, grant.id)))
        .returning({ id: productGrants.id });
      if (updated.length !== 1) return false;
    }
  }
  if (mutation.action !== 'unchanged') {
    await appendMemberEvent(executor, memberEventSchema.parse({
      id: `import-grant:${mutation.event.id}`,
      tenantId,
      memberId: grant.memberId,
      type: 'grant',
      payload: {
        grantId: grant.id,
        productId: grant.productId,
        source: grant.source,
        startsAt: grant.startsAt,
        expiresAt: grant.expiresAt,
      },
      occurredAt: mutation.event.at,
    }));
  }
  return true;
};

const commitProgress = async (
  executor: Db,
  tenantId: string,
  mutation: Extract<ImportUsersMutation, { kind: 'progress' }>,
): Promise<boolean> => {
  const progress = memberCourseProgressSchema.parse(mutation.resource);
  if (mutation.action === 'created') {
    await executor.insert(memberCourseProgress).values({
      ...progress,
      tenantId,
      lastViewedLessonId: progress.lastViewedLessonId ?? null,
      lastViewedModuleId: progress.lastViewedModuleId ?? null,
      lastViewedChapterId: progress.lastViewedChapterId ?? null,
    });
    return true;
  }
  const [current] = await executor
    .select({ memberId: memberCourseProgress.memberId, courseId: memberCourseProgress.courseId })
    .from(memberCourseProgress)
    .where(and(
      eq(memberCourseProgress.tenantId, tenantId),
      eq(memberCourseProgress.id, progress.id),
    ))
    .limit(1);
  if (
    current === undefined
    || current.memberId !== progress.memberId
    || current.courseId !== progress.courseId
  ) return false;
  if (mutation.action === 'unchanged') return true;
  const updated = await executor
    .update(memberCourseProgress)
    .set({
      lastViewedLessonId: progress.lastViewedLessonId ?? null,
      lastViewedModuleId: progress.lastViewedModuleId ?? null,
      lastViewedChapterId: progress.lastViewedChapterId ?? null,
      completedLessonIds: progress.completedLessonIds,
      updatedAt: progress.updatedAt,
    })
    .where(and(
      eq(memberCourseProgress.tenantId, tenantId),
      eq(memberCourseProgress.id, progress.id),
    ))
    .returning({ id: memberCourseProgress.id });
  return updated.length === 1;
};

export const createImportUsersRepository = (db: Db): ImportUsersRepository => ({
  findAuthUserByEmail: async (tenantId, email) => {
    const normalizedEmail = normalizeEmail(email);
    const [row] = await db
      .select({
        id: user.id,
        email: user.email,
        credentialId: account.id,
        credentialPassword: account.password,
      })
      .from(user)
      .leftJoin(members, and(eq(members.userId, user.id), eq(members.tenantId, tenantId)))
      .leftJoin(tenantAdmins, and(
        eq(tenantAdmins.userId, user.id),
        eq(tenantAdmins.tenantId, tenantId),
      ))
      .leftJoin(account, and(eq(account.userId, user.id), eq(account.providerId, 'credential')))
      .where(and(
        sql`lower(btrim(${user.email})) = ${normalizedEmail}`,
        or(
          and(isNotNull(members.id), isNull(members.deletedAt)),
          isNotNull(tenantAdmins.id),
        ),
      ))
      .limit(1);
    return row === undefined ? null : {
      id: row.id,
      email: normalizeEmail(row.email),
      credentialPassword: row.credentialPassword,
      hasCredentialAccount: row.credentialId !== null,
    };
  },
  findMemberById: async (tenantId, memberId) => {
    const [row] = await db
      .select()
      .from(members)
      .where(and(
        eq(members.tenantId, tenantId),
        eq(members.id, memberId),
        isNull(members.deletedAt),
      ))
      .limit(1);
    return row === undefined ? null : parseMember(row);
  },
  findMemberByEmail: async (tenantId, email) => {
    const normalizedEmail = normalizeEmail(email);
    const [row] = await db
      .select()
      .from(members)
      .where(and(
        eq(members.tenantId, tenantId),
        sql`lower(btrim(${members.email})) = ${normalizedEmail}`,
        isNull(members.deletedAt),
      ))
      .limit(1);
    return row === undefined ? null : parseMember(row);
  },
  findGrantById: async (tenantId, grantId) => {
    const [row] = await db
      .select()
      .from(productGrants)
      .where(and(eq(productGrants.tenantId, tenantId), eq(productGrants.id, grantId)))
      .limit(1);
    return row === undefined ? null : productGrantSchema.parse(row);
  },
  findGrantByPair: async (tenantId, input) => {
    const [row] = await db
      .select()
      .from(productGrants)
      .where(and(
        eq(productGrants.tenantId, tenantId),
        eq(productGrants.memberId, input.memberId),
        eq(productGrants.productId, input.productId),
      ))
      .limit(1);
    return row === undefined ? null : productGrantSchema.parse(row);
  },
  findProgressById: async (tenantId, progressId) => {
    const [row] = await db
      .select()
      .from(memberCourseProgress)
      .where(and(
        eq(memberCourseProgress.tenantId, tenantId),
        eq(memberCourseProgress.id, progressId),
      ))
      .limit(1);
    return row === undefined ? null : parseProgress(row);
  },
  findProgressByPair: async (tenantId, input) => {
    const [row] = await db
      .select()
      .from(memberCourseProgress)
      .where(and(
        eq(memberCourseProgress.tenantId, tenantId),
        eq(memberCourseProgress.memberId, input.memberId),
        eq(memberCourseProgress.courseId, input.courseId),
      ))
      .limit(1);
    return row === undefined ? null : parseProgress(row);
  },
  commit: async (tenantId, mutation) => {
    try {
      return await db.transaction(async (tx) => {
        const saved = mutation.kind === 'member'
          ? await commitMember(tx, tenantId, mutation)
          : mutation.kind === 'grant'
            ? await commitGrant(tx, tenantId, mutation)
            : await commitProgress(tx, tenantId, mutation);
        if (!saved) return 'conflict';
        await insertAuditEvent(tx, tenantId, mutation);
        return 'saved';
      });
    } catch (cause) {
      if (uniqueViolation(cause)) return 'conflict';
      throw cause;
    }
  },
});
