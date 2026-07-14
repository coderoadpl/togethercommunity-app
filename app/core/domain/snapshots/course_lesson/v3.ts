import { z } from 'zod';

const videoBlockV3Schema = z
  .object({
    type: z.literal('video'),
    storageKey: z.string().min(1),
    streamVideoId: z.string().min(1),
    streamLibraryId: z.string().min(1).optional(),
    streamCollectionId: z.string().min(1).optional(),
  })
  .strict();

const embedBlockV3Schema = z
  .object({
    type: z.literal('embed'),
    embedUrl: z.string().url(),
  })
  .strict();

const documentUrlV3Schema = z
  .string()
  .refine(
    (value) => value.startsWith('/') || z.string().url().safeParse(value).success,
    'Must be an absolute URL or a same-origin path starting with "/"',
  );

const pdfBlockV3Schema = z
  .object({
    type: z.literal('pdf'),
    pdfUrl: documentUrlV3Schema,
    name: z.string().min(1).optional(),
  })
  .strict();

const linkBlockV3Schema = z
  .object({
    type: z.literal('link'),
    url: z.string().url(),
    description: z.string().min(1).optional(),
  })
  .strict();

const htmlBlockV3Schema = z
  .object({
    type: z.literal('html'),
    html: z.string().min(1),
  })
  .strict();

const lessonBlockV3Schema = z.discriminatedUnion('type', [
  videoBlockV3Schema,
  embedBlockV3Schema,
  pdfBlockV3Schema,
  linkBlockV3Schema,
  htmlBlockV3Schema,
]);

/**
 * FROZEN snapshot schema for `course_lesson` at schemaVersion 3. Adds the
 * optional `durationMinutes` metadata; every v2 payload is valid as-is, so
 * the upcaster is identity.
 */
export const courseLessonSnapshotV3Schema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().trim().min(1),
  contents: z.array(lessonBlockV3Schema),
  durationMinutes: z.number().int().positive().optional(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type CourseLessonSnapshotV3 = z.infer<typeof courseLessonSnapshotV3Schema>;
