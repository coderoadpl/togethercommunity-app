import { z } from 'zod';

const videoBlockV4Schema = z
  .object({
    type: z.literal('video'),
    storageKey: z.string().min(1),
    streamVideoId: z.string().min(1),
    streamLibraryId: z.string().min(1).optional(),
    streamCollectionId: z.string().min(1).optional(),
  })
  .strict();

const embedBlockV4Schema = z
  .object({
    type: z.literal('embed'),
    embedUrl: z.string().url(),
  })
  .strict();

const documentUrlV4Schema = z
  .string()
  .refine(
    (value) => value.startsWith('/') || z.string().url().safeParse(value).success,
    'Must be an absolute URL or a same-origin path starting with "/"',
  );

const pdfBlockV4Schema = z
  .object({
    type: z.literal('pdf'),
    pdfUrl: documentUrlV4Schema,
    name: z.string().min(1).optional(),
  })
  .strict();

const linkBlockV4Schema = z
  .object({
    type: z.literal('link'),
    url: z.string().url(),
    description: z.string().min(1).optional(),
  })
  .strict();

const htmlBlockV4Schema = z
  .object({
    type: z.literal('html'),
    html: z.string().min(1),
  })
  .strict();

const lessonBlockV4Schema = z.discriminatedUnion('type', [
  videoBlockV4Schema,
  embedBlockV4Schema,
  pdfBlockV4Schema,
  linkBlockV4Schema,
  htmlBlockV4Schema,
]);

/**
 * FROZEN snapshot schema for `course_lesson` at schemaVersion 4. Adds
 * `isPreview`, which opens a lesson to anonymous playback without a grant; v3
 * payloads predate the flag and upcast to `false`.
 * Standalone literal copy — never import the live lesson schema; add a v5 file
 * on the next change.
 */
export const courseLessonSnapshotV4Schema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().trim().min(1),
  isPreview: z.boolean().default(false),
  contents: z.array(lessonBlockV4Schema),
  durationMinutes: z.number().int().positive().optional(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type CourseLessonSnapshotV4 = z.infer<typeof courseLessonSnapshotV4Schema>;
