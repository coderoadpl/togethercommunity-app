import { describe, expect, it } from 'vitest';

import { activeNavEntry, courseContextFromPath, memberHomePath } from './member-nav.js';

describe('activeNavEntry', () => {
  it.each([
    [memberHomePath(), { kind: 'start' }],
    ['/community/space-1', { kind: 'space', spaceId: 'space-1' }],
    ['/community/space-1/posts/post-1', { kind: 'space', spaceId: 'space-1' }],
    ['/my/courses/course-1', { kind: 'course', courseId: 'course-1' }],
    ['/my/courses/course-1/lessons/lesson-1', { kind: 'course', courseId: 'course-1' }],
    ['/my/products', { kind: 'products' }],
    ['/my/products/product-1', { kind: 'products' }],
    ['/account', { kind: 'account' }],
  ])('resolves %s', (pathname, expected) => {
    expect(activeNavEntry(pathname)).toEqual(expected);
  });

  it.each([
    ['/community'],
    ['/my'],
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
    ['/my'],
    ['/my/courses'],
    ['/my/course/product-1'],
    ['/my/products'],
    ['/community/space-1'],
    ['/community/space-1/posts/post-1'],
    ['/account'],
  ])('stays out of course context on %s', (pathname) => {
    expect(courseContextFromPath(pathname)).toBeNull();
  });
});
