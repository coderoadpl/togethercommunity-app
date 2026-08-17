export interface CourseLessonCounts {
  completedLessonCount: number;
  accessibleLessonCount: number;
}

export const coursePercent = (counts: CourseLessonCounts): number =>
  counts.accessibleLessonCount === 0
    ? 0
    : Math.round((100 * counts.completedLessonCount) / counts.accessibleLessonCount);

export const isCourseDone = (counts: CourseLessonCounts): boolean =>
  counts.completedLessonCount > 0
  && counts.completedLessonCount === counts.accessibleLessonCount;
