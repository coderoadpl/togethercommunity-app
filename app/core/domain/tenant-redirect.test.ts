import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MEMBER_ROUTE_PATHS } from './member-routes.js';
import { isReservedRedirectPath, normalizeRedirectPath } from './tenant-redirect.js';

const spaRoutePaths = (): string[] => {
  const source = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'main.tsx'), 'utf8');
  const literals = [...source.matchAll(/path: '([^']+)'/g)].map(([, path]) => path ?? '');
  return [...literals, ...Object.values(MEMBER_ROUTE_PATHS)].filter((path) => path.startsWith('/'));
};

describe('normalizeRedirectPath', () => {
  it('lower-cases, collapses repeated slashes and drops the trailing slash', () => {
    expect(normalizeRedirectPath('/Course/JavaScript/')).toBe('/course/javascript');
    expect(normalizeRedirectPath('/course//javascript///wstep')).toBe('/course/javascript/wstep');
  });

  it('strips query strings and fragments', () => {
    expect(normalizeRedirectPath('/course/javascript?ref=x#section')).toBe('/course/javascript');
  });

  it('normalizes an empty or root-only path to /', () => {
    expect(normalizeRedirectPath('/')).toBe('/');
    expect(normalizeRedirectPath('')).toBe('/');
  });

  it('normalizes a pathological run of slashes well under 50 ms', () => {
    const start = performance.now();
    const result = normalizeRedirectPath('/'.repeat(10_000));
    const elapsed = performance.now() - start;

    expect(result).toBe('/');
    expect(elapsed).toBeLessThan(50);
  });
});

describe('isReservedRedirectPath', () => {
  it('reserves the workspace root however it is written', () => {
    for (const path of ['/', '', '///', '#anchor', '?ref=x']) {
      expect(isReservedRedirectPath(path)).toBe(true);
    }
  });

  it('reserves a platform root with everything below it and nothing else', () => {
    expect(isReservedRedirectPath('/panel')).toBe(true);
    expect(isReservedRedirectPath('/My/courses/course-js')).toBe(true);
    expect(isReservedRedirectPath('/paneller')).toBe(false);
    expect(isReservedRedirectPath('/course/javascript')).toBe(false);
  });

  it('reserves every top-level path the single-page app routes itself', () => {
    const paths = spaRoutePaths();

    expect(paths.length).toBeGreaterThan(15);
    expect(paths.filter((path) => !isReservedRedirectPath(path))).toEqual([]);
  });
});
