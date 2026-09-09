import { z } from 'zod';

import { err, ok, validation, type AppError, type Course, type CourseLesson, type CourseModule, type Result } from '#core/domain/index.js';

export const lessonPreviewOptionsSchema = z.object({
  course: z.string().min(1),
  lessons: z.string().transform((value) => value.split(',').map((id) => id.trim()))
    .pipe(z.array(z.string().min(1)).min(1)).optional(),
  firstPerModule: z.boolean().optional(),
  all: z.boolean().optional(),
  none: z.boolean().optional(),
  dryRun: z.boolean().default(false),
}).refine(
  (options) => [options.lessons !== undefined, options.firstPerModule, options.all, options.none]
    .filter(Boolean).length === 1,
  'Choose exactly one of --lessons, --first-per-module, --all, or --none',
);

interface PreviewRow {
  moduleId: string;
  module: string;
  lessonId: string;
  lesson: string;
  currentIsPreview: boolean;
  isPreview: boolean;
}

export const planLessonPreviews = (
  course: Course,
  modules: CourseModule[],
  lessons: CourseLesson[],
  options: z.output<typeof lessonPreviewOptionsSchema>,
): Result<PreviewRow[], AppError> => {
  const rank = new Map(course.moduleOrder.map((id, index) => [id, index]));
  const attached = modules.filter((module) => module.courseIds.includes(course.id)).sort((a, b) => {
    const rankA = rank.get(a.id) ?? Number.POSITIVE_INFINITY;
    const rankB = rank.get(b.id) ?? Number.POSITIVE_INFINITY;
    if (rankA !== rankB) return rankA - rankB;
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
  const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const target = new Set(options.lessons);
  const rows: PreviewRow[] = [];
  for (const module of attached) {
    const ids = module.chapters.flatMap((chapter) => chapter.contents.map((content) => content.lessonId));
    if (options.firstPerModule && ids[0] !== undefined) target.add(ids[0]);
    for (const id of new Set(ids)) {
      const lesson = byId.get(id);
      if (lesson === undefined) return err(validation(`Course references missing lesson ${id}`));
      if (options.all) target.add(id);
      rows.push({ moduleId: module.id, module: module.name, lessonId: id, lesson: lesson.name,
        currentIsPreview: lesson.isPreview, isPreview: false });
    }
  }
  const courseIds = new Set(rows.map((row) => row.lessonId));
  const unknown = [...target].filter((id) => !courseIds.has(id));
  if (unknown.length > 0) return err(validation(`Lessons do not belong to course ${course.id}: ${unknown.join(', ')}`));
  return ok(rows.map((row) => ({ ...row, isPreview: target.has(row.lessonId) })));
};

export const formatLessonPreviews = (rows: PreviewRow[]): string => [
  'Module\tLesson\tCurrent -> new',
  ...rows.map((row) => `${row.module} (${row.moduleId})\t${row.lesson} (${row.lessonId})\t${row.currentIsPreview} -> ${row.isPreview}`),
].join('\n');
