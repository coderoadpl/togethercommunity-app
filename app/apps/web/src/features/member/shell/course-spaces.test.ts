import { describe, expect, it } from 'vitest';

import type { MemberNavigationCourse, MemberNavigationSpace } from '#core/domain/index.js';

import { nestSpacesUnderCourses, spacesForCourse } from './course-spaces.js';

const space = (id: string, courseIds: string[]): MemberNavigationSpace => ({
  id,
  slug: id,
  name: `Space ${id}`,
  visibility: courseIds.length > 0 ? 'product' : 'members',
  position: 0,
  isFollowing: false,
  unread: false,
  courseIds,
});

const course = (courseId: string): MemberNavigationCourse => ({
  courseId,
  courseName: `Course ${courseId}`,
  completedLessonCount: 0,
  accessibleLessonCount: 3,
  lastActivityAt: null,
});

const courses = [course('c1'), course('c2')];

describe('nestSpacesUnderCourses', () => {
  it('nests a space that matches exactly one course and drops it from the flat list', () => {
    const nested = space('s1', ['c1']);
    const result = nestSpacesUnderCourses([nested], courses);

    expect(result.spacesByCourse.get('c1')).toEqual([nested]);
    expect(result.ungroupedSpaces).toEqual([]);
  });

  it('nests every space that matches the same course', () => {
    const first = space('s1', ['c1']);
    const second = space('s2', ['c1']);
    const result = nestSpacesUnderCourses([first, second], courses);

    expect(result.spacesByCourse.get('c1')).toEqual([first, second]);
    expect(result.ungroupedSpaces).toEqual([]);
  });

  it('keeps a space shared by several courses in the flat list', () => {
    const shared = space('s1', ['c1', 'c2']);
    const result = nestSpacesUnderCourses([shared], courses);

    expect(result.spacesByCourse.size).toBe(0);
    expect(result.ungroupedSpaces).toEqual([shared]);
  });

  it('keeps a space without any course association in the flat list', () => {
    const open = space('s1', []);
    const result = nestSpacesUnderCourses([open], courses);

    expect(result.spacesByCourse.size).toBe(0);
    expect(result.ungroupedSpaces).toEqual([open]);
  });

  it('ignores associations with courses the navigation does not list', () => {
    const hidden = space('s1', ['c9']);
    const halfHidden = space('s2', ['c1', 'c9']);
    const result = nestSpacesUnderCourses([hidden, halfHidden], courses);

    expect(result.ungroupedSpaces).toEqual([hidden]);
    expect(result.spacesByCourse.get('c1')).toEqual([halfHidden]);
  });
});

describe('spacesForCourse', () => {
  it('returns a shared space for each of its courses', () => {
    const shared = space('s1', ['c1', 'c2']);
    const own = space('s2', ['c2']);

    expect(spacesForCourse([shared, own], 'c1')).toEqual([shared]);
    expect(spacesForCourse([shared, own], 'c2')).toEqual([shared, own]);
  });

  it('returns nothing for a course without a space', () => {
    expect(spacesForCourse([space('s1', ['c1'])], 'c2')).toEqual([]);
  });
});
