import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stampManifestVersion } from './stamp-manifest-version.js';

const releaseVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

type ImageVersionStamp =
  | { ok: true; outcome: 'stamped' | 'unchanged' }
  | { ok: false; message: string };

export const stampImageVersion = (manifestPath: string, version: string): ImageVersionStamp => {
  if (!releaseVersion.test(version)) {
    return { ok: false, message: `APP_VERSION "${version}" is not a release version such as 0.13.5 or 0.1.0+unknown` };
  }
  const outcome = stampManifestVersion(manifestPath, version);
  return outcome === 'missing-field'
    ? { ok: false, message: 'package.json has no version field' }
    : { ok: true, outcome };
};

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const version = process.argv[2] ?? '';
  const stamped = stampImageVersion(join(import.meta.dirname, '..', 'package.json'), version);
  if (stamped.ok) {
    process.stdout.write(`stamp-image-version: ${version}\n`);
  } else {
    process.stderr.write(`stamp-image-version: ${stamped.message}\n`);
    process.exitCode = 1;
  }
}
