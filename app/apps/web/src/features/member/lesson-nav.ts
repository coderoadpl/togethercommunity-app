import type {
  CourseStructureChapter,
  CourseStructureLesson,
  CourseStructureModule,
  CourseStructureWithAccess,
} from '#core/domain/index.js';

export interface LinearLesson {
  lessonId: string;
  name: string;
  locked: boolean;
  unlockable: boolean;
}

export interface LessonNeighbours {
  previous: LinearLesson | null;
  next: LinearLesson | null;
  nextUnlocked: LinearLesson | null;
  lockedSkipped: number;
  firstUnlockableSkipped: LinearLesson | null;
}

export const linearizeCourse = (structure: CourseStructureWithAccess): LinearLesson[] =>
  structure.modules.flatMap((module) =>
    module.chapters.flatMap((chapter) =>
      chapter.lessons.map((lesson) => ({
        lessonId: lesson.lessonId,
        name: lesson.name,
        locked: lesson.accessStatus !== 'fully-accessible',
        unlockable: lesson.unlockProductId !== undefined,
      })),
    ),
  );

export const lessonNeighbours = (
  linear: LinearLesson[],
  lessonId: string,
): LessonNeighbours | null => {
  const index = linear.findIndex((entry) => entry.lessonId === lessonId);
  if (index === -1) return null;
  const ahead = linear.slice(index + 1);
  const unlockedOffset = ahead.findIndex((entry) => !entry.locked);
  const skipped = ahead.slice(0, Math.max(unlockedOffset, 0));
  return {
    previous: linear[index - 1] ?? null,
    next: ahead[0] ?? null,
    nextUnlocked: ahead[unlockedOffset] ?? null,
    lockedSkipped: skipped.length,
    firstUnlockableSkipped: skipped.find((entry) => entry.unlockable) ?? null,
  };
};

export interface LessonLocation {
  courseName: string;
  module: CourseStructureModule | null;
  chapter: CourseStructureChapter | null;
  row: CourseStructureLesson | null;
}

export const locateLesson = (
  structure: CourseStructureWithAccess,
  lessonId: string,
): LessonLocation => {
  for (const module of structure.modules) {
    for (const chapter of module.chapters) {
      const row = chapter.lessons.find((entry) => entry.lessonId === lessonId);
      if (row !== undefined) return { courseName: structure.name, module, chapter, row };
    }
  }
  return { courseName: structure.name, module: null, chapter: null, row: null };
};

export const lessonPath = (courseId: string, lessonId: string): string =>
  `/my/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`;
