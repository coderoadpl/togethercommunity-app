import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';

import { memberSchema, notificationSchema, productSchema, staffRoleSchema } from '#core/domain/index.js';
import type { NotificationFanoutBatchRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { members, notifications, productGrants, products, tenantAdmins, threadSubscriptions, user } from './schema.js';

const staffRecipientSchema = memberSchema.pick({ userId: true, email: true, language: true }).required({ language: true });

export const createNotificationFanoutBatchRepository = (db: Db): NotificationFanoutBatchRepository => ({
  listAccessForUsers: async (tenantId, userIds, now) => {
    if (userIds.length === 0) return [];
    const [memberRows, staffRows, grantRows] = await Promise.all([
      db.select().from(members).where(and(eq(members.tenantId, tenantId), inArray(members.userId, userIds))),
      db.select({ userId: tenantAdmins.userId }).from(tenantAdmins).where(and(
        eq(tenantAdmins.tenantId, tenantId), inArray(tenantAdmins.userId, userIds),
        inArray(tenantAdmins.role, staffRoleSchema.options),
      )),
      db.select({ userId: members.userId, productId: productGrants.productId, product: products })
        .from(members)
        .innerJoin(productGrants, and(eq(productGrants.tenantId, tenantId), eq(productGrants.memberId, members.id)))
        .leftJoin(products, and(eq(products.tenantId, tenantId), eq(products.id, productGrants.productId)))
        .where(and(
          eq(members.tenantId, tenantId), inArray(members.userId, userIds),
          eq(productGrants.mode, 'live'),
          sql`${productGrants.startsAt}::timestamptz <= ${now}::timestamptz`,
          sql`(${productGrants.expiresAt} is null or ${productGrants.expiresAt}::timestamptz >= ${now}::timestamptz)`,
        )),
    ]);
    const byUserId = new Map(memberRows.map((row) => [row.userId, memberSchema.parse(row)]));
    const staffIds = new Set(staffRows.map((row) => memberSchema.shape.userId.parse(row.userId)));
    const grantsByUser = new Map<string, typeof grantRows>();
    for (const row of grantRows) {
      const existing = grantsByUser.get(row.userId) ?? [];
      existing.push(row);
      grantsByUser.set(row.userId, existing);
    }
    return userIds.map((userId) => {
      const grants = grantsByUser.get(userId) ?? [];
      return {
        userId,
        member: byUserId.get(userId) ?? null,
        isStaff: staffIds.has(userId),
        activeProductIds: grants.map((row) => productSchema.shape.id.parse(row.productId)),
        accessItems: grants.flatMap((row) => row.product === null ? [] : productSchema.parse(row.product).accessItems),
      };
    });
  },
  listStaffPage: async (tenantId, input) => {
    const rows = await db.select({ userId: tenantAdmins.userId, email: user.email, language: members.language })
      .from(tenantAdmins)
      .innerJoin(user, eq(user.id, tenantAdmins.userId))
      .leftJoin(members, and(eq(members.tenantId, tenantId), eq(members.userId, tenantAdmins.userId), isNull(members.deletedAt)))
      .where(and(
        eq(tenantAdmins.tenantId, tenantId), inArray(tenantAdmins.role, staffRoleSchema.options),
        ...(input.afterUserId === null ? [] : [gt(tenantAdmins.userId, input.afterUserId)]),
      ))
      .orderBy(asc(tenantAdmins.userId)).limit(input.limit);
    return rows.map((row) => staffRecipientSchema.parse(row));
  },
  subscribeStaff: async (tenantId, input) => {
    if (input.userIds.length === 0) return;
    await db.insert(threadSubscriptions).values(input.userIds.map((userId) => ({
      tenantId, userId, rootPostId: input.rootPostId, createdAt: input.createdAt, mutedAt: null,
    }))).onConflictDoNothing({ target: [threadSubscriptions.tenantId, threadSubscriptions.userId, threadSubscriptions.rootPostId] });
  },
  listNotificationsForSource: async (tenantId, sourceKey, userIds) => {
    if (userIds.length === 0) return [];
    const rows = await db.select().from(notifications).where(and(
      eq(notifications.tenantId, tenantId), eq(notifications.sourceKey, sourceKey),
      inArray(notifications.recipientUserId, userIds),
    )).orderBy(asc(notifications.recipientUserId));
    return rows.map((row) => notificationSchema.parse(row));
  },
});
