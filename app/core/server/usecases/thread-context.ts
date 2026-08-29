import type { Post } from '#core/domain/index.js';

import type {
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  DiscussionLinkPort,
  ProductGrantRepository,
  SpaceRepository,
} from '../ports.js';
import { isLessonAccessibleByLookup, locateLesson } from './access.js';
import { spaceVisibleToMemberScope } from './community-access.js';
import { resolveMemberAccessLookup } from './entitlements.js';

export interface ThreadContextDeps {
  spaces: SpaceRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  links: DiscussionLinkPort;
}

export interface ThreadContextInfo {
  courseId: string | null;
  contextName: string;
  contextUrl: string;
}

export const threadContextInfo = async (
  tenantId: string,
  post: Post,
  deps: ThreadContextDeps,
  tenantSlug: string | null,
): Promise<ThreadContextInfo> => {
  if (post.contextKind === 'space') {
    const space = await deps.spaces.findById(tenantId, post.contextId);
    return {
      courseId: null,
      contextName: space?.name ?? '',
      contextUrl: deps.links.spaceUrl({
        tenantSlug,
        spaceId: post.contextId,
        rootPostId: post.rootPostId,
      }),
    };
  }
  const [courses, modules, lesson] = await Promise.all([
    deps.courses.list(tenantId),
    deps.modules.list(tenantId),
    deps.lessons.findById(tenantId, post.contextId),
  ]);
  const location = locateLesson(post.contextId, courses, modules);
  const courseId = location?.course.id ?? null;
  return {
    courseId,
    contextName: lesson?.name ?? '',
    contextUrl: deps.links.lessonDiscussionUrl({ tenantSlug, courseId, lessonId: post.contextId }),
  };
};

export interface ThreadContextAccessDeps {
  spaces: SpaceRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  grants: ProductGrantRepository;
  clock: Clock;
}

export const subscriberCanAccessContext = async (
  tenantId: string,
  memberId: string,
  post: Post,
  deps: ThreadContextAccessDeps,
): Promise<boolean> => {
  if (post.contextKind === 'space') {
    const space = await deps.spaces.findById(tenantId, post.contextId);
    return space !== null && (await spaceVisibleToMemberScope({ tenantId, memberId }, space, deps));
  }
  const [courses, modules] = await Promise.all([deps.courses.list(tenantId), deps.modules.list(tenantId)]);
  const location = locateLesson(post.contextId, courses, modules);
  if (!location) return false;
  const lookup = await resolveMemberAccessLookup({ tenantId, memberId }, deps);
  return isLessonAccessibleByLookup(lookup, {
    courseId: location.course.id,
    moduleId: location.moduleId,
    lessonId: post.contextId,
  });
};
