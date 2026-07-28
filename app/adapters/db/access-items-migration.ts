import type { AccessItem } from '#core/domain/index.js';

export interface LegacyAccessItem {
  courseId: string;
  courseLevelAccess: boolean;
  moduleIds: string[];
  lessonIds: string[];
}

/**
 * The row-level transform the `0008_access_items_union` data migration performs
 * in SQL, expressed once in TypeScript so its correctness is unit-tested. A
 * legacy item degenerates to `null` (dropped) when it grants nothing.
 */
export const migrateLegacyAccessItem = (legacy: LegacyAccessItem): AccessItem | null => {
  if (legacy.courseLevelAccess) return { level: 'course', courseId: legacy.courseId };
  if (legacy.moduleIds.length > 0) {
    return { level: 'modules', courseId: legacy.courseId, moduleIds: legacy.moduleIds };
  }
  if (legacy.lessonIds.length > 0) {
    return { level: 'lessons', courseId: legacy.courseId, lessonIds: legacy.lessonIds };
  }
  return null;
};

export const migrateLegacyAccessItems = (legacy: LegacyAccessItem[]): AccessItem[] =>
  legacy
    .map(migrateLegacyAccessItem)
    .filter((item): item is AccessItem => item !== null);
