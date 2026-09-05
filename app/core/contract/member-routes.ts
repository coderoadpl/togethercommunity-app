export const MEMBER_ROUTE_PATHS = {
  courseList: '/my',
  course: '/my/courses/$courseId',
  lesson: '/my/courses/$courseId/lessons/$lessonId',
  communitySpace: '/community/$spaceId',
  communityPost: '/community/$spaceId/posts/$postId',
  communityEvent: '/community/$spaceId/events/$eventId',
  conversation: '/messages/$conversationId',
} as const;

export const coursePath = (courseId: string): string =>
  MEMBER_ROUTE_PATHS.course.replace('$courseId', courseId);

export const lessonPath = (courseId: string, lessonId: string): string =>
  MEMBER_ROUTE_PATHS.lesson.replace('$courseId', courseId).replace('$lessonId', lessonId);

export const communitySpacePath = (spaceId: string): string =>
  MEMBER_ROUTE_PATHS.communitySpace.replace('$spaceId', spaceId);

export const communityPostPath = (spaceId: string, postId: string): string =>
  MEMBER_ROUTE_PATHS.communityPost.replace('$spaceId', spaceId).replace('$postId', postId);

export const communityEventPath = (spaceId: string, eventId: string): string =>
  MEMBER_ROUTE_PATHS.communityEvent.replace('$spaceId', spaceId).replace('$eventId', eventId);

export const conversationPath = (conversationId: string): string =>
  MEMBER_ROUTE_PATHS.conversation.replace('$conversationId', conversationId);
