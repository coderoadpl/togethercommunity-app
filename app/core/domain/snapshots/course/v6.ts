import { z } from 'zod';

export const courseSnapshotV6Schema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().trim().min(1),
  description: z.string(),
  imageUrl: z.union([z.string().url(), z.string().regex(/^\/\S+$/)]).nullable(),
  salesUrl: z.string().trim().url().regex(/^https:\/\//iu, 'Sales URL must use HTTPS').nullable().optional(),
  moduleOrder: z.array(z.string()),
  publiclyVisible: z.boolean().default(false),
  archivedAt: z.string().datetime().nullable().optional(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type CourseSnapshotV6 = z.infer<typeof courseSnapshotV6Schema>;
