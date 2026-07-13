import { z } from 'zod';

const requiredNameSchema = z.string().trim().min(1);

export const chapterContentSchema = z
  .object({
    id: z.string().min(1),
    name: requiredNameSchema,
    lessonId: z.string().min(1),
  })
  .strict();

export type ChapterContent = z.infer<typeof chapterContentSchema>;

export const chapterSchema = z
  .object({
    id: z.string().min(1),
    name: requiredNameSchema,
    contents: z.array(chapterContentSchema),
  })
  .strict();

export type Chapter = z.infer<typeof chapterSchema>;

const videoLessonBlockSchema = z
  .object({
    type: z.literal('video'),
    storageKey: z.string().min(1),
    streamVideoId: z.string().min(1),
    streamCollectionId: z.string().min(1).optional(),
  })
  .strict();

const embedLessonBlockSchema = z
  .object({
    type: z.literal('embed'),
    embedUrl: z.string().url(),
  })
  .strict();

const pdfLessonBlockSchema = z
  .object({
    type: z.literal('pdf'),
    pdfUrl: z.string().url(),
    name: z.string().min(1).optional(),
  })
  .strict();

const linkLessonBlockSchema = z
  .object({
    type: z.literal('link'),
    url: z.string().url(),
    description: z.string().min(1).optional(),
  })
  .strict();

const htmlLessonBlockSchema = z
  .object({
    type: z.literal('html'),
    html: z.string().min(1),
  })
  .strict();

export const lessonBlockSchema = z.discriminatedUnion('type', [
  videoLessonBlockSchema,
  embedLessonBlockSchema,
  pdfLessonBlockSchema,
  linkLessonBlockSchema,
  htmlLessonBlockSchema,
]);

export type LessonBlock = z.infer<typeof lessonBlockSchema>;

export const courseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: requiredNameSchema,
  description: z.string(),
  imageUrl: z.string().url().nullable(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type Course = z.infer<typeof courseSchema>;

export const computeCourseModuleName = (prefix: string | null, title: string): string =>
  prefix && prefix.trim().length > 0 ? `${prefix} - ${title}` : title;

export const courseModuleSchema = z
  .object({
    id: z.string(),
    tenantId: z.string(),
    courseIds: z.array(z.string()),
    title: requiredNameSchema,
    prefix: z.string().nullable(),
    name: requiredNameSchema,
    chapters: z.array(chapterSchema),
    legacyId: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .refine((module) => module.name === computeCourseModuleName(module.prefix, module.title), {
    message: 'Module name must be computed from prefix and title',
    path: ['name'],
  });

export type CourseModule = z.infer<typeof courseModuleSchema>;

export const courseLessonSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: requiredNameSchema,
  contents: z.array(lessonBlockSchema),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type CourseLesson = z.infer<typeof courseLessonSchema>;

export const memberCourseProgressSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  memberId: z.string(),
  courseId: z.string(),
  lastViewedLessonId: z.string().optional(),
  lastViewedModuleId: z.string().optional(),
  lastViewedChapterId: z.string().optional(),
  completedLessonIds: z.array(z.string()),
  updatedAt: z.string().datetime(),
});

export type MemberCourseProgress = z.infer<typeof memberCourseProgressSchema>;

export const newCourseSchema = z.object({
  name: requiredNameSchema,
  description: z.string().default(''),
  imageUrl: z.string().url().nullable().default(null),
  legacyId: z.string().nullable().default(null),
});

export type NewCourseInput = z.input<typeof newCourseSchema>;

export const updateCourseInputSchema = z.object({
  id: z.string().min(1),
  name: requiredNameSchema.optional(),
  description: z.string().optional(),
  imageUrl: z.string().url().nullable().optional(),
});

export type UpdateCourseInput = z.input<typeof updateCourseInputSchema>;

export const newCourseModuleSchema = z.object({
  courseIds: z.array(z.string().min(1)).default([]),
  title: requiredNameSchema,
  prefix: z.string().nullable().default(null),
  chapters: z.array(chapterSchema).default([]),
  legacyId: z.string().nullable().default(null),
});

export type NewCourseModuleInput = z.input<typeof newCourseModuleSchema>;

export const updateCourseModuleInputSchema = z.object({
  id: z.string().min(1),
  title: requiredNameSchema.optional(),
  prefix: z.string().nullable().optional(),
  chapters: z.array(chapterSchema).optional(),
});

export type UpdateCourseModuleInput = z.input<typeof updateCourseModuleInputSchema>;

export const newCourseLessonSchema = z.object({
  name: requiredNameSchema,
  contents: z.array(lessonBlockSchema).default([]),
  legacyId: z.string().nullable().default(null),
});

export type NewCourseLessonInput = z.input<typeof newCourseLessonSchema>;

export const updateCourseLessonInputSchema = z.object({
  id: z.string().min(1),
  name: requiredNameSchema.optional(),
  contents: z.array(lessonBlockSchema).optional(),
});

export type UpdateCourseLessonInput = z.input<typeof updateCourseLessonInputSchema>;

export const attachModuleToCourseInputSchema = z.object({
  courseId: z.string().min(1),
  moduleId: z.string().min(1),
});

export type AttachModuleToCourseInput = z.input<typeof attachModuleToCourseInputSchema>;
