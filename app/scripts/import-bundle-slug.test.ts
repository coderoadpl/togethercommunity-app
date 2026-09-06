import { describe, expect, it } from 'vitest';

import { ImportFailure } from '#adapters/db/importer.js';

import { assertSafeBundleSlug } from './import-bundle-slug.js';

describe('assertSafeBundleSlug', () => {
  it('accepts lowercase letters, digits and hyphens', () => {
    expect(assertSafeBundleSlug('acme')).toBe('acme');
    expect(assertSafeBundleSlug('studio-demo')).toBe('studio-demo');
    expect(assertSafeBundleSlug('tenant-42')).toBe('tenant-42');
  });

  it('rejects path-traversal and separator characters', () => {
    for (const slug of ['../etc', 'a/b', '..', 'a\\b', 'tenant/../secret']) {
      expect(() => assertSafeBundleSlug(slug)).toThrow(ImportFailure);
    }
  });

  it('rejects uppercase, whitespace and empty slugs', () => {
    for (const slug of ['Acme', 'a b', '', 'tenant.slug', 'tȩnant']) {
      expect(() => assertSafeBundleSlug(slug)).toThrow(ImportFailure);
    }
  });
});
