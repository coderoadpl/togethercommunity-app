import { z } from 'zod';

import { courseSchema } from './course.js';
import { spaceProductSummarySchema, spaceSchema } from './space.js';

const publicNavigationSpaceSchema = spaceSchema.pick({
  id: true,
  slug: true,
  name: true,
  description: true,
  position: true,
}).extend({
  visibility: spaceSchema.shape.visibility.optional(),
  publicReadOnly: z.boolean().optional(),
  products: z.array(spaceProductSummarySchema).optional(),
});

const publicNavigationCourseSchema = courseSchema.pick({
  id: true,
  name: true,
  description: true,
  imageUrl: true,
});

/** Same field set as the member locked-space row, so the sales surface renders unchanged. */
const publicNavigationLockedSpaceSchema = spaceSchema.pick({
  id: true,
  slug: true,
  name: true,
  description: true,
  productIds: true,
}).extend({
  products: z.array(spaceProductSummarySchema).optional(),
});

export const publicNavigationSchema = z.object({
  defaultHomeSpaceId: z.string().min(1).nullable(),
  spaces: z.array(publicNavigationSpaceSchema),
  courses: z.array(publicNavigationCourseSchema),
  lockedSpaces: z.array(publicNavigationLockedSpaceSchema),
});

export type PublicNavigation = z.output<typeof publicNavigationSchema>;
