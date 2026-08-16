import { z } from 'zod';

export const courseSnapshotV3Schema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().trim().min(1),
  description: z.string(),
  imageUrl: z.union([z.string().url(), z.string().regex(/^\/\S+$/)]).nullable(),
  moduleOrder: z.array(z.string()),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type CourseSnapshotV3 = z.infer<typeof courseSnapshotV3Schema>;
