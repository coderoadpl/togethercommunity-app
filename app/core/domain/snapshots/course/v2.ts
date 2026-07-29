import { z } from 'zod';

/**
 * FROZEN snapshot schema for `course` at schemaVersion 2.
 *
 * Adds `moduleOrder` — an explicit ordering of the modules attached to the
 * course, letting staff reorder modules independently of creation time. v1
 * payloads (which predate the field) upcast by defaulting it to an empty array.
 * Standalone literal copy — never import the live course schema; add a v3 file
 * on the next change.
 */
export const courseSnapshotV2Schema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().trim().min(1),
  description: z.string(),
  imageUrl: z.string().url().nullable(),
  moduleOrder: z.array(z.string()),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type CourseSnapshotV2 = z.infer<typeof courseSnapshotV2Schema>;
