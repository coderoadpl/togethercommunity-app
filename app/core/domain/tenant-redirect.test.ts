import { describe, expect, it } from 'vitest';

import { normalizeRedirectPath } from './tenant-redirect.js';

describe('normalizeRedirectPath', () => {
  it('lower-cases, collapses repeated slashes and drops the trailing slash', () => {
    expect(normalizeRedirectPath('/Kurs/JavaScript/')).toBe('/kurs/javascript');
    expect(normalizeRedirectPath('/kurs//javascript///wstep')).toBe('/kurs/javascript/wstep');
  });

  it('strips query strings and fragments', () => {
    expect(normalizeRedirectPath('/kurs/javascript?ref=x#section')).toBe('/kurs/javascript');
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
