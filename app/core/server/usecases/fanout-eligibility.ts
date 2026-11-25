import type { Space } from '#core/domain/index.js';

import type { NotificationFanoutAccess } from '../ports.js';
import { buildAccessLookup, isLessonAccessibleByLookup } from './access.js';
import type { NotificationRecipient } from './community-access.js';
import type { ThreadContextInfo } from './thread-context.js';

export const fanoutRecipient = (access: NotificationFanoutAccess): NotificationRecipient | null => {
  const { member, isStaff } = access;
  if (!isStaff && (member === null || member.bannedAt !== null || member.deletedAt !== null)) return null;
  return {
    email: member?.email ?? null,
    language: member?.language ?? null,
    isStaff,
    memberId: member?.id ?? null,
  };
};

export const fanoutCanAccessSpace = (access: NotificationFanoutAccess, space: Space): boolean =>
  space.visibility === 'members' || access.activeProductIds.some((id) => space.productIds.includes(id));

export interface ThreadReach {
  courseId: string | null;
}

export const fanoutThreadReach = (access: NotificationFanoutAccess, context: ThreadContextInfo): ThreadReach | null => {
  if (context.space !== null) return fanoutCanAccessSpace(access, context.space) ? { courseId: null } : null;
  const lookup = buildAccessLookup(access.accessItems);
  const opened = context.lessonLocations.find((location) => isLessonAccessibleByLookup(lookup, location));
  return opened === undefined ? null : { courseId: opened.courseId };
};
