import { z } from 'zod';

import { ERROR_CODES, type AppError } from './errors.js';
import { chapterSchema, lessonBlockSchema } from './course.js';
import { normalizeEmail } from './email.js';
import {
  currencySchema,
  productCoverUrlSchema,
  productSlugSchema,
  productTypeSchema,
} from './product.js';

const IMPORT_DATASET_VERSION = 'together-import/v1';
const IMPORT_WRITE_MAX_RECORDS = 200;
const IMPORT_VALIDATE_MAX_RECORDS = 5_000;

export const importContentKindSchema = z.enum(['course', 'module', 'lesson', 'product']);

export type ImportContentKind = z.output<typeof importContentKindSchema>;

export type ImportUsersKind = 'member' | 'grant' | 'progress';

export const importKindSchema = z.enum([
  'course',
  'module',
  'lesson',
  'product',
  'member',
  'grant',
  'progress',
]);

export type ImportKind = z.output<typeof importKindSchema>;

const importKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/);

const importedRecordFields = {
  importKey: importKeySchema,
  legacyId: z.string().optional(),
  createdAt: z.string().datetime().optional(),
};

const importCourseRecordObjectSchema = z
  .object({
    ...importedRecordFields,
    name: z.string().trim().min(1),
    description: z.string().max(50_000),
    imageUrl: z.string().url().nullable(),
    moduleOrder: z.array(importKeySchema),
  })
  .strict();

const refineCourseRecord = (record: z.output<typeof importCourseRecordObjectSchema>, ctx: z.RefinementCtx): void => {
    if (new Set(record.moduleOrder).size !== record.moduleOrder.length) {
      ctx.addIssue({ code: 'custom', path: ['moduleOrder'], message: 'Module order must contain unique keys' });
    }
};

export const importCourseRecordSchema = importCourseRecordObjectSchema.superRefine(refineCourseRecord);

export type ImportCourseRecord = z.output<typeof importCourseRecordSchema>;

const importChapterContentSchema = chapterSchema.shape.contents.element
  .omit({ lessonId: true })
  .extend({ lessonKey: importKeySchema })
  .strict();

const importChapterSchema = chapterSchema
  .omit({ contents: true })
  .extend({ contents: z.array(importChapterContentSchema) })
  .strict();

const importModuleRecordObjectSchema = z
  .object({
    ...importedRecordFields,
    courseKeys: z.array(importKeySchema),
    title: z.string().trim().min(1),
    prefix: z.string().nullable(),
    chapters: z.array(importChapterSchema),
  })
  .strict();

const refineModuleRecord = (record: z.output<typeof importModuleRecordObjectSchema>, ctx: z.RefinementCtx): void => {
    if (new Set(record.courseKeys).size !== record.courseKeys.length) {
      ctx.addIssue({ code: 'custom', path: ['courseKeys'], message: 'Course keys must be unique' });
    }
    const chapterIds = record.chapters.map((chapter) => chapter.id);
    if (new Set(chapterIds).size !== chapterIds.length) {
      ctx.addIssue({ code: 'custom', path: ['chapters'], message: 'Chapter ids must be unique' });
    }
    const contentIds = record.chapters.flatMap((chapter) => chapter.contents.map((content) => content.id));
    if (new Set(contentIds).size !== contentIds.length) {
      ctx.addIssue({ code: 'custom', path: ['chapters'], message: 'Chapter content ids must be unique' });
    }
};

export const importModuleRecordSchema = importModuleRecordObjectSchema.superRefine(refineModuleRecord);

export type ImportModuleRecord = z.output<typeof importModuleRecordSchema>;

export const importLessonRecordSchema = z
  .object({
    ...importedRecordFields,
    name: z.string().trim().min(1),
    isPreview: z.boolean(),
    durationMinutes: z.number().int().positive().optional(),
    contents: z.array(lessonBlockSchema),
  })
  .strict();

export type ImportLessonRecord = z.output<typeof importLessonRecordSchema>;

const importCourseAccessItemSchema = z
  .object({
    level: z.literal('course'),
    courseKey: importKeySchema,
    excludedModuleKeys: z.array(importKeySchema).optional(),
  })
  .strict();

const importModulesAccessItemSchema = z
  .object({
    level: z.literal('modules'),
    courseKey: importKeySchema,
    moduleKeys: z.array(importKeySchema).min(1),
  })
  .strict();

const importLessonsAccessItemSchema = z
  .object({
    level: z.literal('lessons'),
    courseKey: importKeySchema,
    lessonKeys: z.array(importKeySchema).min(1),
  })
  .strict();

const importAccessItemSchema = z.discriminatedUnion('level', [
  importCourseAccessItemSchema,
  importModulesAccessItemSchema,
  importLessonsAccessItemSchema,
]);

export const importProductRecordSchema = z
  .object({
    ...importedRecordFields,
    type: productTypeSchema,
    slug: productSlugSchema,
    title: z.string().trim().min(1).max(200),
    description: z.string().max(50_000),
    coverUrl: productCoverUrlSchema.nullable(),
    priceCents: z.number().int().nonnegative(),
    currency: currencySchema,
    accessItems: z.array(importAccessItemSchema),
  })
  .strict();

export type ImportProductRecord = z.output<typeof importProductRecordSchema>;

export const importMemberRecordSchema = z
  .object({
    ...importedRecordFields,
    email: z.string().email().transform(normalizeEmail),
    displayName: z.string().trim().min(1).max(200),
  })
  .strict();

export type ImportMemberRecord = z.output<typeof importMemberRecordSchema>;

const importGrantRecordObjectSchema = z
  .object({
    importKey: importKeySchema,
    legacyId: z.string().optional(),
    memberKey: importKeySchema,
    productKey: importKeySchema,
    startsAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
  })
  .strict();

const refineGrantRecord = (
  record: z.output<typeof importGrantRecordObjectSchema>,
  ctx: z.RefinementCtx,
): void => {
  if (record.expiresAt !== null && Date.parse(record.expiresAt) < Date.parse(record.startsAt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'Grant expiry must not be earlier than its start',
    });
  }
};

export const importGrantRecordSchema = importGrantRecordObjectSchema.superRefine(refineGrantRecord);

export type ImportGrantRecord = z.output<typeof importGrantRecordSchema>;

const importProgressRecordObjectSchema = z
  .object({
    importKey: importKeySchema,
    memberKey: importKeySchema,
    courseKey: importKeySchema,
    completedLessonKeys: z.array(importKeySchema),
    lastViewedLessonKey: importKeySchema.optional(),
    lastViewedModuleKey: importKeySchema.optional(),
    lastViewedChapterId: z.string().min(1).optional(),
    updatedAt: z.string().datetime(),
  })
  .strict();

const refineProgressRecord = (
  record: z.output<typeof importProgressRecordObjectSchema>,
  ctx: z.RefinementCtx,
): void => {
  if (new Set(record.completedLessonKeys).size !== record.completedLessonKeys.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['completedLessonKeys'],
      message: 'Completed lesson keys must be unique',
    });
  }
};

export const importProgressRecordSchema = importProgressRecordObjectSchema.superRefine(
  refineProgressRecord,
);

export type ImportProgressRecord = z.output<typeof importProgressRecordSchema>;

const recordSchemas = {
  course: importCourseRecordSchema,
  module: importModuleRecordSchema,
  lesson: importLessonRecordSchema,
  product: importProductRecordSchema,
  member: importMemberRecordSchema,
  grant: importGrantRecordSchema,
  progress: importProgressRecordSchema,
};

export const importRecordSchema = z.discriminatedUnion('kind', [
  importCourseRecordObjectSchema.extend({ kind: z.literal('course') }).strict(),
  importModuleRecordObjectSchema.extend({ kind: z.literal('module') }).strict(),
  importLessonRecordSchema.extend({ kind: z.literal('lesson') }).strict(),
  importProductRecordSchema.extend({ kind: z.literal('product') }).strict(),
  importMemberRecordSchema.extend({ kind: z.literal('member') }).strict(),
  importGrantRecordObjectSchema.extend({ kind: z.literal('grant') }).strict(),
  importProgressRecordObjectSchema.extend({ kind: z.literal('progress') }).strict(),
]).superRefine((record, ctx) => {
  if (record.kind === 'course') refineCourseRecord(record, ctx);
  if (record.kind === 'module') refineModuleRecord(record, ctx);
  if (record.kind === 'grant') refineGrantRecord(record, ctx);
  if (record.kind === 'progress') refineProgressRecord(record, ctx);
});

export type ImportRecord = z.output<typeof importRecordSchema>;

export const importWriteRequestSchema = z
  .object({
    datasetVersion: z.literal(IMPORT_DATASET_VERSION),
    records: z.array(z.unknown()).min(1).max(IMPORT_WRITE_MAX_RECORDS),
  })
  .strict();

export type ImportWriteRequest = z.output<typeof importWriteRequestSchema>;

export const importValidateRequestSchema = z
  .object({
    datasetVersion: z.literal(IMPORT_DATASET_VERSION),
    records: z.array(z.unknown()).min(1).max(IMPORT_VALIDATE_MAX_RECORDS),
  })
  .strict();

export type ImportValidateRequest = z.output<typeof importValidateRequestSchema>;

export const importRecordSchemaFor = (kind: ImportKind) => recordSchemas[kind];

const importRecordErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.unknown().optional(),
});

const importBatchResultSchema = z.discriminatedUnion('action', [
  z.object({ importKey: importKeySchema, action: z.enum(['created', 'updated', 'unchanged']), id: z.string() }),
  z.object({ importKey: z.string(), action: z.literal('error'), error: importRecordErrorSchema }),
]);

export type ImportBatchResult =
  | { importKey: string; action: 'created' | 'updated' | 'unchanged'; id: string }
  | { importKey: string; action: 'error'; error: AppError };

const importBatchSummarySchema = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const importBatchResponseSchema = z.object({
  results: z.array(importBatchResultSchema),
  summary: importBatchSummarySchema,
});

export type ImportBatchResponse = z.output<typeof importBatchResponseSchema>;

const importPlanCountsSchema = z.record(importKindSchema, z.number().int().nonnegative());

export const importValidationResponseSchema = z.object({
  plan: z.object({
    create: importPlanCountsSchema,
    update: importPlanCountsSchema,
    unchanged: importPlanCountsSchema,
  }),
  errors: z.array(z.object({
    index: z.number().int().nonnegative(),
    kind: importKindSchema.optional(),
    importKey: z.string().optional(),
    error: importRecordErrorSchema,
  })),
  warnings: z.array(z.object({
    index: z.number().int().nonnegative(),
    kind: importKindSchema,
    importKey: importKeySchema,
    message: z.string(),
  })),
  valid: z.boolean(),
});

export type ImportValidationResponse = z.output<typeof importValidationResponseSchema>;

export const canonicalImportPayload = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalImportPayload).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(z.record(z.unknown()).parse(value))
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalImportPayload(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return value === undefined ? 'null' : JSON.stringify(value);
};
