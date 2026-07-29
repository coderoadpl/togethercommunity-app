import { z } from 'zod';

/**
 * FROZEN snapshot schema for `course` at schemaVersion 1.
 *
 * This is a standalone literal copy of the course entity shape as it existed at
 * v1. It must NEVER import the live `courseSchema` nor change when that schema
 * evolves — historical payloads are validated against the shape they were
 * written under. When the live entity changes, add a v2 file, do not edit this.
 */
export const courseSnapshotV1Schema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().trim().min(1),
  description: z.string(),
  imageUrl: z.string().url().nullable(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type CourseSnapshotV1 = z.infer<typeof courseSnapshotV1Schema>;
