import { z } from 'zod';

import { spaceSchema } from './space.js';

const memberNavigationSpaceSchema = spaceSchema
  .pick({ id: true, slug: true, name: true, visibility: true, position: true })
  .extend({ isFollowing: z.boolean() });

const memberNavigationCourseSchema = z.object({
  courseId: z.string().min(1),
  courseName: z.string(),
  completedLessonCount: z.number().int().nonnegative(),
  accessibleLessonCount: z.number().int().nonnegative(),
  lastViewedLessonId: z.string().min(1).optional(),
  lastActivityAt: z.string().datetime().nullable(),
});

export type MemberNavigationCourse = z.output<typeof memberNavigationCourseSchema>;

/** A gated space the member is not entitled to: enough to advertise it, no feed access implied. */
const memberNavigationLockedSpaceSchema = spaceSchema.pick({
  id: true,
  slug: true,
  name: true,
  description: true,
  productIds: true,
});

export const memberNavigationSchema = z.object({
  spaces: z.array(memberNavigationSpaceSchema),
  courses: z.array(memberNavigationCourseSchema),
  lockedSpaces: z.array(memberNavigationLockedSpaceSchema),
});

export type MemberNavigation = z.output<typeof memberNavigationSchema>;
