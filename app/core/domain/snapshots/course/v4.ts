import { z } from 'zod';

export const courseSnapshotV4Schema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().trim().min(1),
  description: z.string(),
  imageUrl: z.union([z.string().url(), z.string().regex(/^\/\S+$/)]).nullable(),
  moduleOrder: z.array(z.string()),
  publiclyVisible: z.boolean().default(false),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type CourseSnapshotV4 = z.infer<typeof courseSnapshotV4Schema>;
