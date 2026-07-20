import { describe, expect, it } from 'vitest';

import {
  MEMBER_ROUTE_PATHS,
  communityPostPath,
  communitySpacePath,
  lessonPath,
} from './member-routes.js';

describe('member route paths', () => {
  it('pins notification and email destinations to registered SPA routes', () => {
    expect(MEMBER_ROUTE_PATHS).toEqual({
      lesson: '/my/courses/$courseId/lessons/$lessonId',
      communitySpace: '/community/$spaceId',
      communityPost: '/community/$spaceId/posts/$postId',
    });
    expect(lessonPath('course-1', 'lesson-1')).toBe('/my/courses/course-1/lessons/lesson-1');
    expect(communitySpacePath('space-1')).toBe('/community/space-1');
    expect(communityPostPath('space-1', 'post-1')).toBe('/community/space-1/posts/post-1');
  });
});
