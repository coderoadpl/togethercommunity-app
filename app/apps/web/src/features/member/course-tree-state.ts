import type { CourseStructureLesson, CourseStructureWithAccess } from '#core/domain/index.js';

const lessonsOf = (structure: CourseStructureWithAccess): CourseStructureLesson[] =>
  structure.modules.flatMap((module) => module.chapters.flatMap((chapter) => chapter.lessons));

export const focusLesson = (
  structure: CourseStructureWithAccess,
  {
    currentLessonId,
    lastViewedLessonId,
  }: { currentLessonId?: string | null | undefined; lastViewedLessonId?: string | null | undefined },
): string | null => {
  const lessons = lessonsOf(structure);
  const known = new Set(lessons.map((lesson) => lesson.lessonId));
  const preferred = [currentLessonId, lastViewedLessonId].find(
    (lessonId) => lessonId !== null && lessonId !== undefined && known.has(lessonId),
  );
  return preferred ?? lessons[0]?.lessonId ?? null;
};

export const branchOfLesson = (
  structure: CourseStructureWithAccess,
  lessonId: string | null,
): ReadonlySet<string> => {
  if (lessonId === null) return new Set();
  for (const module of structure.modules) {
    for (const chapter of module.chapters) {
      if (chapter.lessons.some((lesson) => lesson.lessonId === lessonId)) {
        return new Set([module.id, chapter.id]);
      }
    }
  }
  return new Set();
};
