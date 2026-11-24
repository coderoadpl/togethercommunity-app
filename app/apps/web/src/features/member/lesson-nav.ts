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
  const open = linear.findIndex((entry) => entry.lessonId === lessonId && !entry.locked);
  const index = open === -1 ? linear.findIndex((entry) => entry.lessonId === lessonId) : open;
  if (index === -1) return null;
  const other = (entry: LinearLesson): boolean => entry.lessonId !== lessonId;
  const ahead = linear.slice(index + 1).filter(other);
  const unlockedOffset = ahead.findIndex((entry) => !entry.locked);
  const skipped = ahead.slice(0, Math.max(unlockedOffset, 0));
  return {
    previous: linear.slice(0, index).findLast(other) ?? null,
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
  let firstLocked: LessonLocation | null = null;
  for (const module of structure.modules) {
    for (const chapter of module.chapters) {
      for (const row of chapter.lessons) {
        if (row.lessonId !== lessonId) continue;
        const location = { courseName: structure.name, module, chapter, row };
        if (row.accessStatus === 'fully-accessible') return location;
        firstLocked ??= location;
      }
    }
  }
  return firstLocked ?? { courseName: structure.name, module: null, chapter: null, row: null };
};

export const lessonPath = (courseId: string, lessonId: string): string =>
  `/my/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`;
