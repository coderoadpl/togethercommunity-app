import { describe, expect, it } from 'vitest';

import {
  activeNavEntry,
  anonHomePath,
  courseContextFromPath,
  memberHomePath,
  memberMessagesPath,
  memberSearchPath,
} from './member-nav.js';

describe('activeNavEntry', () => {
  it.each([
    [memberHomePath(), { kind: 'start' }],
    [anonHomePath(), { kind: 'start' }],
    [memberSearchPath(), { kind: 'search' }],
    [memberMessagesPath(), { kind: 'messages' }],
    ['/messages/conversation-1', { kind: 'messages' }],
    ['/community/space-1', { kind: 'space', spaceId: 'space-1' }],
    ['/community/space-1/posts/post-1', { kind: 'space', spaceId: 'space-1' }],
    ['/my/courses/course-1', { kind: 'course', courseId: 'course-1' }],
    ['/my/courses/course-1/lessons/lesson-1', { kind: 'course', courseId: 'course-1' }],
    ['/my/products', { kind: 'products' }],
    ['/my/products/product-1', { kind: 'products' }],
    ['/account', { kind: 'account' }],
    ['/my', { kind: 'start' }],
    ['/community', { kind: 'start' }],
  ])('resolves %s', (pathname, expected) => {
    expect(activeNavEntry(pathname)).toEqual(expected);
  });

  it.each([
    ['/my/course/product-1'],
    ['/my/courses'],
    ['/checkout/product-1'],
  ])('highlights nothing on %s', (pathname) => {
    expect(activeNavEntry(pathname)).toBeNull();
  });

  it('decodes encoded identifiers so they match the navigation payload', () => {
    expect(activeNavEntry('/community/space%201')).toEqual({ kind: 'space', spaceId: 'space 1' });
  });
});

describe('courseContextFromPath', () => {
  it.each([
    ['/my/courses/course-1', { courseId: 'course-1', lessonId: null }],
    ['/my/courses/course-1/lessons/lesson-1', { courseId: 'course-1', lessonId: 'lesson-1' }],
    ['/my/courses/course%201/lessons/lesson%201', { courseId: 'course 1', lessonId: 'lesson 1' }],
    ['/my/courses/course-1/lessons', { courseId: 'course-1', lessonId: null }],
  ])('reads the course context of %s', (pathname, expected) => {
    expect(courseContextFromPath(pathname)).toEqual(expected);
  });

  it.each([
    [memberHomePath()],
    [anonHomePath()],
    [memberSearchPath()],
    ['/my'],
    ['/my/courses'],
    ['/my/course/product-1'],
    ['/my/products'],
    ['/community/space-1'],
    ['/community/space-1/posts/post-1'],
    [memberMessagesPath()],
    ['/account'],
  ])('stays out of course context on %s', (pathname) => {
    expect(courseContextFromPath(pathname)).toBeNull();
  });
});
