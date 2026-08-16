import { describe, expect, it } from 'vitest';

import { activeNavEntry, memberHomePath } from './member-nav.js';

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
