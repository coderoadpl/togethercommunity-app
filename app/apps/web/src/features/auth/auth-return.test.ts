import { describe, expect, it } from 'vitest';

import {
  loginCallbackUrl,
  loginPathWithReturnTo,
  pathWithSearch,
  returnToFromSearch,
  safeReturnTo,
} from '../../lib/auth-return.js';

describe('auth return routing', () => {
  it('builds the login guard target with the original path and query encoded', () => {
    expect(loginPathWithReturnTo('/my/courses/course-1/lessons/lesson-1?thread=t1')).toBe(
      '/login?returnTo=%2Fmy%2Fcourses%2Fcourse-1%2Flessons%2Flesson-1%3Fthread%3Dt1',
    );
    expect(pathWithSearch({ pathname: '/my/courses/course-1/lessons/lesson-1', searchStr: '?thread=t1' })).toBe(
      '/my/courses/course-1/lessons/lesson-1?thread=t1',
    );
  });

  it.each([
    'https://evil.example/my',
    'http://evil.example/my',
    '//evil.example/my',
    '/\\evil.example/my',
    'my/courses/course-1',
    '',
  ])('rejects unsafe returnTo value %s', (value) => {
    expect(safeReturnTo(value)).toBeNull();
    expect(loginPathWithReturnTo(value)).toBe('/login');
  });

  it('reads only safe path-only returnTo values from login search', () => {
    expect(returnToFromSearch('?returnTo=%2Fmy%2Fcourses%2Fc1%3Fthread%3Dt1')).toBe('/my/courses/c1?thread=t1');
    expect(returnToFromSearch('?returnTo=https%3A%2F%2Fevil.example%2Fmy')).toBeNull();
    expect(returnToFromSearch('?returnTo=%2F%2Fevil.example%2Fmy')).toBeNull();
  });

  it('adds the safe returnTo to the post-verification callback URL', () => {
    expect(loginCallbackUrl('/my/courses/c1?thread=t1')).toBe(
      'http://localhost:3000/login?verification=verified&returnTo=%2Fmy%2Fcourses%2Fc1%3Fthread%3Dt1',
    );
  });
});
