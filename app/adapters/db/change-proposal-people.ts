import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';

import { notificationSchema, type Notification, type StaffRole } from '#core/domain/index.js';
import type { ChangeProposalOwnerNotice, ChangeProposalOwnerNotifier, ChangeProposalPeopleReader, ChangeProposalWrite } from '#core/server/index.js';

import { boundLockWait, boundStatementTime, busyAfterRollback, changeProposalBounds, type ChangeProposalBoundOptions } from './change-proposal-bounds.js';
import type { Db } from './client.js';
import { effectiveStaffGrantOf } from './repositories.js';
import { notifications, organizationMembers, organizations, tenantAdmins, tenants, user } from './schema.js';

const activeOrganizationOf = (tenantId: string) =>
  and(eq(tenants.id, tenantId), eq(organizations.id, tenants.organizationId), eq(organizations.status, 'active'));

const effectiveRole = (directRole: string | null, organizationRole: string | null): StaffRole | null =>
  effectiveStaffGrantOf(directRole, organizationRole)?.staffRole ?? null;

export const createChangeProposalPeopleReader = (db: Db): ChangeProposalPeopleReader => ({
  read: async (tenantId, userIds) => {
    const rows = await db
      .select({
        userId: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        directRole: tenantAdmins.role,
        organizationRole: organizationMembers.role,
      })
      .from(user)
      .leftJoin(tenantAdmins, and(eq(tenantAdmins.tenantId, tenantId), eq(tenantAdmins.userId, user.id)))
      .leftJoin(tenants, eq(tenants.id, tenantId))
      .leftJoin(organizations, activeOrganizationOf(tenantId))
      .leftJoin(organizationMembers, and(eq(organizationMembers.organizationId, organizations.id), eq(organizationMembers.userId, user.id)))
      .where(and(inArray(user.id, [...userIds]), or(isNotNull(tenantAdmins.role), isNotNull(organizationMembers.role))));
    return rows.flatMap((row) => {
      const staffRole = effectiveRole(row.directRole, row.organizationRole);
      return staffRole === null ? [] : [{ userId: row.userId, email: row.email, emailVerified: row.emailVerified, staffRole }];
    });
  },
});

const effectiveOwners = async (executor: Db, tenantId: string): Promise<string[]> => {
  const direct = await executor
    .select({ userId: tenantAdmins.userId, role: tenantAdmins.role })
    .from(tenantAdmins)
    .where(eq(tenantAdmins.tenantId, tenantId));
  const derived = await executor
    .select({ userId: organizationMembers.userId, role: organizationMembers.role })
    .from(tenants)
    .innerJoin(organizations, activeOrganizationOf(tenantId))
    .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(tenants.id, tenantId));
  const people = [...new Set([...direct, ...derived].map((row) => row.userId))].sort();
  return people.filter((userId) => effectiveRole(
    direct.find((row) => row.userId === userId)?.role ?? null,
    derived.find((row) => row.userId === userId)?.role ?? null,
  ) === 'owner');
};

const SOURCE_KEY_TARGET = [notifications.tenantId, notifications.recipientUserId, notifications.sourceKey];

const insertOrRaise = (executor: Db, tenantId: string, notification: Notification, notice: ChangeProposalOwnerNotice) => {
  const insert = executor.insert(notifications).values({ ...notification, tenantId });
  const sourceKeyIndex = sql`${notifications.sourceKey} is not null`;
  return notice === 'signal'
    ? insert.onConflictDoNothing({ target: SOURCE_KEY_TARGET, where: sourceKeyIndex }).returning()
    : insert.onConflictDoUpdate({
        target: SOURCE_KEY_TARGET,
        targetWhere: sourceKeyIndex,
        set: { id: notification.id, kind: notification.kind, payload: notification.payload, readAt: null, createdAt: notification.createdAt },
        setWhere: sql`${notifications.readAt} is not null`,
      }).returning();
};

const ownerNotice = async (executor: Db, tenantId: string, notification: Notification, notice: ChangeProposalOwnerNotice): Promise<Notification | null> => {
  const { sourceKey } = notification;
  if (sourceKey === null) throw new Error('An owner notification is raised only under a source key');
  const [written] = await insertOrRaise(executor, tenantId, notification, notice);
  if (written !== undefined) return notificationSchema.parse(written);
  const [kept] = await executor
    .select()
    .from(notifications)
    .where(and(
      eq(notifications.tenantId, tenantId),
      eq(notifications.recipientUserId, notification.recipientUserId),
      eq(notifications.sourceKey, sourceKey),
    ));
  return kept === undefined ? null : notificationSchema.parse(kept);
};

export const createChangeProposalOwnerNotifier = (db: Db, options: ChangeProposalBoundOptions = {}): ChangeProposalOwnerNotifier => {
  const bounds = changeProposalBounds(options);
  return {
    deadlineMs: bounds.notificationMs,
    raiseForOwners: (tenantId, build, notice) => busyAfterRollback(() => db.transaction(async (tx): Promise<ChangeProposalWrite<Notification[]>> => {
      await boundLockWait(tx, { lockWaitMs: bounds.notificationMs });
      await boundStatementTime(tx, bounds.notificationMs);
      const raised: Notification[] = [];
      for (const owner of await effectiveOwners(tx, tenantId)) {
        const notification = await ownerNotice(tx, tenantId, build(owner), notice);
        if (notification !== null) raised.push(notification);
      }
      return { kind: 'written', value: raised };
    }), { kind: 'busy' } as const),
  };
};
