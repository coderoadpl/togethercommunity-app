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
    streamLibraryId: z.string().min(1).optional(),
    streamCollectionId: z.string().min(1).optional(),
  })
  .strict();

const embedLessonBlockSchema = z
  .object({
    type: z.literal('embed'),
    embedUrl: z.string().url(),
  })
  .strict();

/** An absolute URL, or a same-origin root-relative path (e.g. an asset our own server hosts). */
const documentUrlSchema = z
  .string()
  .refine(
    (value) => value.startsWith('/') || z.string().url().safeParse(value).success,
    'Must be an absolute URL or a same-origin path starting with "/"',
  );

const pdfLessonBlockSchema = z
  .object({
    type: z.literal('pdf'),
    pdfUrl: documentUrlSchema,
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
  moduleOrder: z.array(z.string()),
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

export const accessStatusSchema = z.enum([
  'not-accessible',
  'partially-accessible',
  'fully-accessible',
]);

export type AccessStatus = z.infer<typeof accessStatusSchema>;

export const completionStatusSchema = z.enum([
  'not-completed',
  'partially-completed',
  'fully-completed',
]);

export type CompletionStatus = z.infer<typeof completionStatusSchema>;

export const courseStructureLessonSchema = z.object({
  contentId: z.string(),
  lessonId: z.string(),
  name: z.string(),
  accessStatus: accessStatusSchema,
  completionStatus: completionStatusSchema,
});

export type CourseStructureLesson = z.infer<typeof courseStructureLessonSchema>;

export const courseStructureChapterSchema = z.object({
  id: z.string(),
  name: z.string(),
  accessStatus: accessStatusSchema,
  completionStatus: completionStatusSchema,
  lessons: z.array(courseStructureLessonSchema),
});

export type CourseStructureChapter = z.infer<typeof courseStructureChapterSchema>;

export const courseStructureModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  accessStatus: accessStatusSchema,
  completionStatus: completionStatusSchema,
  chapters: z.array(courseStructureChapterSchema),
});

export type CourseStructureModule = z.infer<typeof courseStructureModuleSchema>;

export const courseStructureWithAccessSchema = z.object({
  courseId: z.string(),
  name: z.string(),
  accessStatus: accessStatusSchema,
  completionStatus: completionStatusSchema,
  modules: z.array(courseStructureModuleSchema),
});

export type CourseStructureWithAccess = z.infer<typeof courseStructureWithAccessSchema>;

export const nextLessonSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .nullable();

export type NextLesson = z.infer<typeof nextLessonSchema>;

export const progressViewSchema = z.object({
  courseId: z.string(),
  completedLessonIds: z.array(z.string()),
  lastViewedLessonId: z.string().optional(),
  lastViewedModuleId: z.string().optional(),
  lastViewedChapterId: z.string().optional(),
});

export type ProgressView = z.infer<typeof progressViewSchema>;

export const courseIdInputSchema = z.object({
  courseId: z.string().min(1),
});

export type CourseIdInput = z.input<typeof courseIdInputSchema>;

export const lessonIdInputSchema = z.object({
  lessonId: z.string().min(1),
});

export type LessonIdInput = z.input<typeof lessonIdInputSchema>;

export const updateLastViewedInputSchema = z.object({
  courseId: z.string().min(1),
  lessonId: z.string().min(1).optional(),
  moduleId: z.string().min(1).optional(),
  chapterId: z.string().min(1).optional(),
});

export type UpdateLastViewedInput = z.input<typeof updateLastViewedInputSchema>;

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
  moduleOrder: z.array(z.string().min(1)).optional(),
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

export const detachModuleFromCourseInputSchema = z.object({
  courseId: z.string().min(1),
  moduleId: z.string().min(1),
});

export type DetachModuleFromCourseInput = z.input<typeof detachModuleFromCourseInputSchema>;

export const deleteCourseLessonInputSchema = z.object({
  id: z.string().min(1),
});

export type DeleteCourseLessonInput = z.input<typeof deleteCourseLessonInputSchema>;

export const lessonReferenceChapterSchema = z.object({
  moduleId: z.string(),
  moduleName: z.string(),
  chapterId: z.string(),
  chapterName: z.string(),
  contentId: z.string(),
  contentName: z.string(),
});

export type LessonReferenceChapter = z.infer<typeof lessonReferenceChapterSchema>;

export const lessonReferenceProductSchema = z.object({
  productId: z.string(),
  productTitle: z.string(),
});

export type LessonReferenceProduct = z.infer<typeof lessonReferenceProductSchema>;

export const lessonReferencesSchema = z.object({
  lessonId: z.string(),
  lessonName: z.string(),
  chapters: z.array(lessonReferenceChapterSchema),
  products: z.array(lessonReferenceProductSchema),
  progressCount: z.number().int().nonnegative(),
});

export type LessonReferences = z.infer<typeof lessonReferencesSchema>;
