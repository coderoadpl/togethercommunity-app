export const MEMBER_ROUTE_PATHS = {
  lesson: '/my/courses/$courseId/lessons/$lessonId',
  communitySpace: '/community/$spaceId',
  communityPost: '/community/$spaceId/posts/$postId',
  conversation: '/messages/$conversationId',
} as const;

export const lessonPath = (courseId: string, lessonId: string): string =>
  MEMBER_ROUTE_PATHS.lesson.replace('$courseId', courseId).replace('$lessonId', lessonId);

export const communitySpacePath = (spaceId: string): string =>
  MEMBER_ROUTE_PATHS.communitySpace.replace('$spaceId', spaceId);

export const communityPostPath = (spaceId: string, postId: string): string =>
  MEMBER_ROUTE_PATHS.communityPost.replace('$spaceId', spaceId).replace('$postId', postId);

export const conversationPath = (conversationId: string): string =>
  MEMBER_ROUTE_PATHS.conversation.replace('$conversationId', conversationId);
