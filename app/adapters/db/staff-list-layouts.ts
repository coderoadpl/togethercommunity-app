import { and, eq, sql } from 'drizzle-orm';

import { listLayoutSchema } from '#core/domain/index.js';
import type { ListLayoutRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { staffListLayouts } from './staff-list-layout-schema.js';

const keyOf = (tenantId: string, userId: string, listId: string) => and(
  eq(staffListLayouts.tenantId, tenantId),
  eq(staffListLayouts.userId, userId),
  eq(staffListLayouts.listId, listId),
);

export const createStaffListLayoutRepository = (db: Db): ListLayoutRepository => ({
  get: async (tenantId, userId, listId) => {
    const [row] = await db.select({ layout: staffListLayouts.layout }).from(staffListLayouts).where(keyOf(tenantId, userId, listId));
    if (row === undefined) return null;
    const parsed = listLayoutSchema.safeParse(row.layout);
    return parsed.success ? parsed.data : null;
  },
  put: async (tenantId, userId, listId, layout) => {
    await db.insert(staffListLayouts)
      .values({ tenantId, userId, listId, layout })
      .onConflictDoUpdate({
        target: [staffListLayouts.tenantId, staffListLayouts.userId, staffListLayouts.listId],
        set: { layout, updatedAt: sql`now()` },
      });
  },
  delete: async (tenantId, userId, listId) => {
    await db.delete(staffListLayouts).where(keyOf(tenantId, userId, listId));
  },
});
