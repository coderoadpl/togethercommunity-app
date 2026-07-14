import { describe, expect, it } from 'vitest';

import type { Course, CourseModule } from '@core/domain/index.js';

import { modulesForCourse } from './access.js';

const course = (moduleOrder: string[]): Course => ({
  id: 'c1',
  tenantId: 't1',
  name: 'Course',
  description: '',
  imageUrl: null,
  moduleOrder,
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

const module = (id: string, createdAt: string, courseIds: string[] = ['c1']): CourseModule => ({
  id,
  tenantId: 't1',
  courseIds,
  title: id,
  prefix: null,
  name: id,
  chapters: [],
  legacyId: null,
  createdAt,
});

describe('modulesForCourse ordering', () => {
  it('orders attached modules by the course module order', () => {
    const modules = [
      module('m1', '2026-01-01T00:00:00.000Z'),
      module('m2', '2026-01-02T00:00:00.000Z'),
      module('m3', '2026-01-03T00:00:00.000Z'),
    ];
    const ordered = modulesForCourse(course(['m3', 'm1', 'm2']), modules);
    expect(ordered.map((item) => item.id)).toEqual(['m3', 'm1', 'm2']);
  });

  it('places modules missing from the order last, by creation time', () => {
    const modules = [
      module('m1', '2026-01-03T00:00:00.000Z'),
      module('m2', '2026-01-01T00:00:00.000Z'),
      module('m3', '2026-01-02T00:00:00.000Z'),
    ];
    const ordered = modulesForCourse(course(['m1']), modules);
    expect(ordered.map((item) => item.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('excludes modules not attached to the course', () => {
    const modules = [module('m1', '2026-01-01T00:00:00.000Z'), module('m2', '2026-01-02T00:00:00.000Z', ['other'])];
    const ordered = modulesForCourse(course([]), modules);
    expect(ordered.map((item) => item.id)).toEqual(['m1']);
  });
});
