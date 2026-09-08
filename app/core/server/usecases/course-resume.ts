import type { CourseResume, CourseStructureWithAccess } from '#core/domain/index.js';

export const resolveCourseResume = (
  structure: CourseStructureWithAccess,
  lastViewedLessonId: string | undefined,
): CourseResume => {
  const lessons = structure.modules.flatMap((module) =>
    module.chapters.flatMap((chapter) => chapter.lessons),
  ).filter((lesson) => lesson.accessStatus === 'fully-accessible');
  const firstIncomplete = lessons.find((lesson) => lesson.completionStatus !== 'fully-completed');
  const lastIndex = lessons.findIndex((lesson) => lesson.lessonId === lastViewedLessonId);
  const last = lessons[lastIndex];
  const target = last !== undefined && last.completionStatus !== 'fully-completed'
    ? last
    : lessons.slice(lastIndex + 1).find((lesson) => lesson.completionStatus !== 'fully-completed')
      ?? firstIncomplete ?? last ?? lessons[0];
  return {
    target: target === undefined ? null : { id: target.lessonId, name: target.name },
    firstIncomplete: firstIncomplete === undefined
      ? null : { id: firstIncomplete.lessonId, name: firstIncomplete.name },
    isReview: target !== undefined && firstIncomplete === undefined,
  };
};
