import { z } from 'zod';

const computeName = (prefix: string | null, title: string): string =>
  prefix && prefix.trim().length > 0 ? `${prefix} - ${title}` : title;

const chapterContentV1Schema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    lessonId: z.string().min(1),
  })
  .strict();

const chapterV1Schema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    contents: z.array(chapterContentV1Schema),
  })
  .strict();

/**
 * FROZEN snapshot schema for `course_module` at schemaVersion 1. Standalone
 * literal copy — never import the live module schema; add a v2 file on change.
 */
export const courseModuleSnapshotV1Schema = z
  .object({
    id: z.string(),
    tenantId: z.string(),
    courseIds: z.array(z.string()),
    title: z.string().trim().min(1),
    prefix: z.string().nullable(),
    name: z.string().trim().min(1),
    chapters: z.array(chapterV1Schema),
    legacyId: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .refine((module) => module.name === computeName(module.prefix, module.title), {
    message: 'Module name must be computed from prefix and title',
    path: ['name'],
  });

export type CourseModuleSnapshotV1 = z.infer<typeof courseModuleSnapshotV1Schema>;
