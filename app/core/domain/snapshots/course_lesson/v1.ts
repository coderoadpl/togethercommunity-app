import { z } from 'zod';

const videoBlockV1Schema = z
  .object({
    type: z.literal('video'),
    storageKey: z.string().min(1),
    streamVideoId: z.string().min(1),
    streamLibraryId: z.string().min(1).optional(),
    streamCollectionId: z.string().min(1).optional(),
  })
  .strict();

const embedBlockV1Schema = z
  .object({
    type: z.literal('embed'),
    embedUrl: z.string().url(),
  })
  .strict();

const pdfBlockV1Schema = z
  .object({
    type: z.literal('pdf'),
    pdfUrl: z.string().url(),
    name: z.string().min(1).optional(),
  })
  .strict();

const linkBlockV1Schema = z
  .object({
    type: z.literal('link'),
    url: z.string().url(),
    description: z.string().min(1).optional(),
  })
  .strict();

const htmlBlockV1Schema = z
  .object({
    type: z.literal('html'),
    html: z.string().min(1),
  })
  .strict();

const lessonBlockV1Schema = z.discriminatedUnion('type', [
  videoBlockV1Schema,
  embedBlockV1Schema,
  pdfBlockV1Schema,
  linkBlockV1Schema,
  htmlBlockV1Schema,
]);

/**
 * FROZEN snapshot schema for `course_lesson` at schemaVersion 1. Standalone
 * literal copy — never import the live lesson schema; add a v2 file on change.
 */
export const courseLessonSnapshotV1Schema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().trim().min(1),
  contents: z.array(lessonBlockV1Schema),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type CourseLessonSnapshotV1 = z.infer<typeof courseLessonSnapshotV1Schema>;
