import { describe, expect, it } from 'vitest';

import { accessItemSchema } from '#core/domain/index.js';

import {
  migrateLegacyAccessItem,
  migrateLegacyAccessItems,
  type LegacyAccessItem,
} from './access-items-migration.js';

const legacy = (over: Partial<LegacyAccessItem>): LegacyAccessItem => ({
  courseId: 'c1',
  courseLevelAccess: false,
  moduleIds: [],
  lessonIds: [],
  ...over,
});

describe('migrateLegacyAccessItem', () => {
  it('maps course-level access to the course union member', () => {
    expect(migrateLegacyAccessItem(legacy({ courseLevelAccess: true }))).toEqual({
      level: 'course',
      courseId: 'c1',
    });
  });

  it('maps a course-level item with module/lesson ids to a plain course grant', () => {
    expect(
      migrateLegacyAccessItem(
        legacy({ courseLevelAccess: true, moduleIds: ['m1'], lessonIds: ['l1'] }),
      ),
    ).toEqual({ level: 'course', courseId: 'c1' });
  });

  it('maps a nonempty moduleIds item to the modules union member', () => {
    expect(migrateLegacyAccessItem(legacy({ moduleIds: ['m1', 'm2'] }))).toEqual({
      level: 'modules',
      courseId: 'c1',
      moduleIds: ['m1', 'm2'],
    });
  });

  it('maps a nonempty lessonIds item to the lessons union member', () => {
    expect(migrateLegacyAccessItem(legacy({ lessonIds: ['l1'] }))).toEqual({
      level: 'lessons',
      courseId: 'c1',
      lessonIds: ['l1'],
    });
  });

  it('prefers modules over lessons when both are present', () => {
    expect(migrateLegacyAccessItem(legacy({ moduleIds: ['m1'], lessonIds: ['l1'] }))).toEqual({
      level: 'modules',
      courseId: 'c1',
      moduleIds: ['m1'],
    });
  });

  it('drops a degenerate item that grants nothing', () => {
    expect(migrateLegacyAccessItem(legacy({}))).toBeNull();
  });

  it('produces items that satisfy the new union schema', () => {
    const items = migrateLegacyAccessItems([
      legacy({ courseLevelAccess: true }),
      legacy({ courseId: 'c2', moduleIds: ['m1'] }),
      legacy({ courseId: 'c3', lessonIds: ['l1'] }),
      legacy({ courseId: 'c4' }),
    ]);
    expect(items).toHaveLength(3);
    for (const item of items) expect(() => accessItemSchema.parse(item)).not.toThrow();
  });
});
