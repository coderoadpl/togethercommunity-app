import type { MemberNavigationCourse, MemberNavigationSpace } from '#core/domain/index.js';

export interface CourseSpaceNesting {
  spacesByCourse: Map<string, MemberNavigationSpace[]>;
  ungroupedSpaces: MemberNavigationSpace[];
}

export const nestSpacesUnderCourses = (
  spaces: MemberNavigationSpace[],
  courses: MemberNavigationCourse[],
): CourseSpaceNesting => {
  const listedCourseIds = new Set(courses.map((course) => course.courseId));
  const spacesByCourse = new Map<string, MemberNavigationSpace[]>();
  const ungroupedSpaces: MemberNavigationSpace[] = [];

  for (const space of spaces) {
    const matches = space.courseIds.filter((courseId) => listedCourseIds.has(courseId));
    const [courseId] = matches;
    if (matches.length !== 1 || courseId === undefined) {
      ungroupedSpaces.push(space);
      continue;
    }
    spacesByCourse.set(courseId, [...(spacesByCourse.get(courseId) ?? []), space]);
  }

  return { spacesByCourse, ungroupedSpaces };
};

export const spacesForCourse = (
  spaces: MemberNavigationSpace[],
  courseId: string,
): MemberNavigationSpace[] => spaces.filter((space) => space.courseIds.includes(courseId));
