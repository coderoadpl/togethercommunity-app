import type { CourseStructureWithAccess } from '#core/domain/index.js';

export interface LinearLesson {
  lessonId: string;
  name: string;
  locked: boolean;
}

export interface LessonNeighbours {
  previous: LinearLesson | null;
  next: LinearLesson | null;
  nextUnlocked: LinearLesson | null;
}

export const linearizeCourse = (structure: CourseStructureWithAccess): LinearLesson[] =>
  structure.modules.flatMap((module) =>
    module.chapters.flatMap((chapter) =>
      chapter.lessons.map((lesson) => ({
        lessonId: lesson.lessonId,
        name: lesson.name,
        locked: lesson.accessStatus !== 'fully-accessible',
      })),
    ),
  );

export const lessonNeighbours = (
  linear: LinearLesson[],
  lessonId: string,
): LessonNeighbours | null => {
  const index = linear.findIndex((entry) => entry.lessonId === lessonId);
  if (index === -1) return null;
  return {
    previous: linear[index - 1] ?? null,
    next: linear[index + 1] ?? null,
    nextUnlocked: linear.slice(index + 1).find((entry) => !entry.locked) ?? null,
  };
};

export const lessonPath = (courseId: string, lessonId: string): string =>
  `/my/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`;
