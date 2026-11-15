import type {
  NotificationFanoutBatchRepository,
  NotificationRepository,
  ProductGrantRepository,
  TenantAccessReader,
  ThreadSubscriptionRepository,
} from '../ports.js';

export const fakeFanoutBatches = (deps: () => {
  tenantAccess: TenantAccessReader;
  grants: ProductGrantRepository;
  notifications: NotificationRepository;
  threadSubscriptions: ThreadSubscriptionRepository;
}): NotificationFanoutBatchRepository => ({
  listAccessForUsers: async (tenantId, userIds, now) => {
    const { tenantAccess, grants } = deps();
    const directStaffIds = new Set((await tenantAccess.listStaffForTenant(tenantId)).map((staff) => staff.userId));
    return Promise.all(userIds.map(async (userId) => {
      const member = await tenantAccess.findMember(tenantId, userId);
      const active = member === null ? [] : await grants.listActiveForMember(tenantId, member.id, now);
      const products = member === null ? [] : await grants.listGrantedProducts(tenantId, member.id);
      const activeProductIds = active.map((grant) => grant.productId);
      return {
        userId, member, isStaff: directStaffIds.has(userId), activeProductIds,
        accessItems: products.filter((product) => activeProductIds.includes(product.id)).flatMap((product) => product.accessItems),
      };
    }));
  },
  listStaffPage: async (tenantId, input) => (await deps().tenantAccess.listStaffForTenant(tenantId))
    .filter((staff) => input.afterUserId === null || staff.userId > input.afterUserId)
    .sort((left, right) => left.userId.localeCompare(right.userId)).slice(0, input.limit),
  subscribeStaff: async (tenantId, input) => {
    for (const userId of input.userIds) {
      const existing = await deps().threadSubscriptions.listForUser(tenantId, { userId, rootPostIds: [input.rootPostId] });
      if (existing.length === 0) await deps().threadSubscriptions.upsert(tenantId, { userId, rootPostId: input.rootPostId, createdAt: input.createdAt });
    }
  },
  listNotificationsForSource: async (tenantId, sourceKey, userIds) => {
    const rows = await Promise.all(userIds.map(async (userId) => {
      const page = await deps().notifications.listForRecipient(tenantId, { recipientUserId: userId, limit: 1000 });
      return page.notifications.filter((row) => row.tenantId === tenantId && row.recipientUserId === userId && row.sourceKey === sourceKey);
    }));
    return rows.flat();
  },
});
