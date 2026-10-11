import { and, asc, eq, inArray } from 'drizzle-orm';

import type { Db } from './client.js';
import { courses } from './schema.js';

export const lockActiveCourses = async (
  tx: Db,
  tenantId: string,
  courseIds: string[],
): Promise<boolean> => {
  const ids = [...new Set(courseIds)];
  if (ids.length === 0) return true;
  const rows = await tx.select({ id: courses.id, archivedAt: courses.archivedAt }).from(courses)
    .where(and(eq(courses.tenantId, tenantId), inArray(courses.id, ids)))
    .orderBy(asc(courses.id)).for('update');
  return rows.every((course) => course.archivedAt === null);
};
