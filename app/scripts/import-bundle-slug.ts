import { ImportFailure } from '#adapters/db/importer.js';

const SAFE_BUNDLE_SLUG = /^[a-z0-9-]+$/;

/** Rejects any bundle slug that could escape the bundle directory once path-joined. */
export const assertSafeBundleSlug = (bundleSlug: string): string => {
  if (!SAFE_BUNDLE_SLUG.test(bundleSlug)) {
    throw new ImportFailure(
      `Unsafe bundle slug "${bundleSlug}"; only lowercase letters, digits and hyphens are allowed`,
    );
  }
  return bundleSlug;
};
