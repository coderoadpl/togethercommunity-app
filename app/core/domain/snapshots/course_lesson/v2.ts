import { z } from 'zod';

const videoBlockV2Schema = z
  .object({
    type: z.literal('video'),
    storageKey: z.string().min(1),
    streamVideoId: z.string().min(1),
    streamLibraryId: z.string().min(1).optional(),
    streamCollectionId: z.string().min(1).optional(),
  })
  .strict();

const embedBlockV2Schema = z
  .object({
    type: z.literal('embed'),
    embedUrl: z.string().url(),
  })
  .strict();

const documentUrlV2Schema = z
  .string()
  .refine(
    (value) => value.startsWith('/') || z.string().url().safeParse(value).success,
    'Must be an absolute URL or a same-origin path starting with "/"',
  );

const pdfBlockV2Schema = z
  .object({
    type: z.literal('pdf'),
    pdfUrl: documentUrlV2Schema,
    name: z.string().min(1).optional(),
  })
  .strict();

const linkBlockV2Schema = z
  .object({
    type: z.literal('link'),
    url: z.string().url(),
    description: z.string().min(1).optional(),
  })
  .strict();

const htmlBlockV2Schema = z
  .object({
    type: z.literal('html'),
    html: z.string().min(1),
  })
  .strict();

const lessonBlockV2Schema = z.discriminatedUnion('type', [
  videoBlockV2Schema,
  embedBlockV2Schema,
  pdfBlockV2Schema,
  linkBlockV2Schema,
  htmlBlockV2Schema,
]);

/**
 * FROZEN snapshot schema for `course_lesson` at schemaVersion 2. Widens `pdfUrl`
 * to also accept a same-origin root-relative path (self-hosted lesson assets);
 * v1 payloads (absolute URLs only) remain valid, so the upcaster is identity.
 */
export const courseLessonSnapshotV2Schema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().trim().min(1),
  contents: z.array(lessonBlockV2Schema),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type CourseLessonSnapshotV2 = z.infer<typeof courseLessonSnapshotV2Schema>;
