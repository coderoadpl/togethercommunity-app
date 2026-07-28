import { describe, expect, it } from 'vitest';

import { ImportFailure } from '#adapters/db/importer.js';

import { assertSafeBundleSlug } from './import-bundle-slug.js';

describe('assertSafeBundleSlug', () => {
  it('accepts lowercase letters, digits and hyphens', () => {
    expect(assertSafeBundleSlug('coderoad')).toBe('coderoad');
    expect(assertSafeBundleSlug('akademia-samouka')).toBe('akademia-samouka');
    expect(assertSafeBundleSlug('tenant-42')).toBe('tenant-42');
  });

  it('rejects path-traversal and separator characters', () => {
    for (const slug of ['../etc', 'a/b', '..', 'a\\b', 'tenant/../secret']) {
      expect(() => assertSafeBundleSlug(slug)).toThrow(ImportFailure);
    }
  });

  it('rejects uppercase, whitespace and empty slugs', () => {
    for (const slug of ['CodeRoad', 'a b', '', 'tenant.slug', 'tȩnant']) {
      expect(() => assertSafeBundleSlug(slug)).toThrow(ImportFailure);
    }
  });
});
