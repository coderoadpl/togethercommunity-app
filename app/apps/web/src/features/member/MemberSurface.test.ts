import { describe, expect, it } from 'vitest';

import { getActiveMemberTab } from './MemberSurface.js';

describe('getActiveMemberTab', () => {
  it.each([
    ['/my', 'courses'],
    ['/my/courses', 'courses'],
    ['/my/courses/course-1', 'courses'],
    ['/my/courses/course-1/lessons/lesson-1', 'courses'],
    ['/my/course/product-1', 'courses'],
    ['/my/products', 'products'],
    ['/my/products/product-1', 'products'],
    ['/community', 'community'],
    ['/community/space-1', 'community'],
    ['/account', 'account'],
  ])('marks %s as %s', (pathname, expected) => {
    expect(getActiveMemberTab(pathname)).toBe(expected);
  });

  it('does not treat a product course page as a products route', () => {
    expect(getActiveMemberTab('/my/course/product-1')).not.toBe('products');
  });
});
