import { readFileSync, writeFileSync } from 'node:fs';

const manifestVersionField = /^(\s*"version":\s*")[^"]*(")/m;

export type ManifestVersionStamp = 'stamped' | 'unchanged' | 'missing-field';

export const stampManifestVersion = (
  manifestPath: string,
  version: string,
): ManifestVersionStamp => {
  const manifest = readFileSync(manifestPath, 'utf8');
  if (!manifestVersionField.test(manifest)) return 'missing-field';
  const stamped = manifest.replace(manifestVersionField, `$1${version}$2`);
  if (stamped === manifest) return 'unchanged';
  writeFileSync(manifestPath, stamped);
  return 'stamped';
};
