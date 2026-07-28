import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

const lockedPackageSchema = z
  .object({
    dev: z.boolean().optional(),
    license: z.string().optional(),
    version: z.string().optional(),
  })
  .passthrough();

const packageLockSchema = z.object({
  packages: z.record(z.string(), lockedPackageSchema),
});

type LockedPackage = z.infer<typeof lockedPackageSchema>;

interface LicenseException {
  devOnly?: boolean;
  license?: string;
  packagePattern: RegExp;
  reason: string;
  versionPattern: RegExp;
}

const allowedLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'Unlicense',
]);

const exceptions = new Map<string, LicenseException>([
  [
    'axe-core@*',
    {
      devOnly: true,
      license: 'MPL-2.0',
      packagePattern: /^axe-core$/,
      reason: 'Dev-only accessibility tooling; owner-approved 2026-07-28.',
      versionPattern: /^.+$/,
    },
  ],
  [
    '@fontsource/*@*',
    {
      license: 'OFL-1.1',
      packagePattern: /^@fontsource\/.+$/,
      reason: 'OFL-1.1 covers bundled font assets rather than application code.',
      versionPattern: /^.+$/,
    },
  ],
  [
    'caniuse-lite@*',
    {
      license: 'CC-BY-4.0',
      packagePattern: /^caniuse-lite$/,
      reason: 'CC-BY-4.0 covers the attributed browser-compatibility dataset.',
      versionPattern: /^.+$/,
    },
  ],
  [
    '@csstools/color-helpers@*',
    {
      license: 'MIT-0',
      packagePattern: /^@csstools\/color-helpers$/,
      reason: 'MIT-0 is a permissive MIT variant without an attribution condition.',
      versionPattern: /^.+$/,
    },
  ],
  [
    '@csstools/css-syntax-patches-for-csstree@*',
    {
      license: 'MIT-0',
      packagePattern: /^@csstools\/css-syntax-patches-for-csstree$/,
      reason: 'MIT-0 is a permissive MIT variant without an attribution condition.',
      versionPattern: /^.+$/,
    },
  ],
  [
    'nodemailer@*',
    {
      license: 'MIT-0',
      packagePattern: /^nodemailer$/,
      reason: 'MIT-0 is a permissive MIT variant without an attribution condition.',
      versionPattern: /^.+$/,
    },
  ],
  [
    'argparse@*',
    {
      devOnly: true,
      license: 'Python-2.0',
      packagePattern: /^argparse$/,
      reason: 'Python-2.0 is a permissive legacy license and the package is dev-only.',
      versionPattern: /^.+$/,
    },
  ],
  [
    'rechoir@0.6.2',
    {
      devOnly: true,
      packagePattern: /^rechoir$/,
      reason: 'The lockfile omits metadata; npm registry metadata identifies 0.6.2 as MIT.',
      versionPattern: /^0\.6\.2$/,
    },
  ],
]);

const packageNameFromPath = (path: string): string | undefined => {
  const marker = 'node_modules/';
  const markerIndex = path.lastIndexOf(marker);
  if (markerIndex === -1) return undefined;
  const tail = path.slice(markerIndex + marker.length);
  const parts = tail.split('/');
  if (parts[0]?.startsWith('@')) {
    if (parts[1] === undefined) return undefined;
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
};

const hasAllowedAlternative = (license: string): boolean => {
  const alternatives = license
    .replaceAll('(', '')
    .replaceAll(')', '')
    .split(/\s+OR\s+/);
  return alternatives.some((alternative) => allowedLicenses.has(alternative.trim()));
};

const matchingException = (
  packageName: string,
  lockedPackage: LockedPackage,
): string | undefined => {
  const version = lockedPackage.version ?? '';
  for (const [key, exception] of exceptions) {
    if (!exception.packagePattern.test(packageName)) continue;
    if (!exception.versionPattern.test(version)) continue;
    if (exception.license !== undefined && exception.license !== lockedPackage.license) continue;
    if (exception.devOnly === true && lockedPackage.dev !== true) continue;
    return key;
  }
  return undefined;
};

const lockPath = join(import.meta.dirname, '..', 'package-lock.json');
const parsed: unknown = JSON.parse(readFileSync(lockPath, 'utf8'));
const lock = packageLockSchema.parse(parsed);
const problems: string[] = [];

for (const [path, lockedPackage] of Object.entries(lock.packages)) {
  if (path === '') continue;
  const packageName = packageNameFromPath(path);
  if (packageName === undefined) {
    problems.push(`${path}: cannot determine package name`);
    continue;
  }
  const license = lockedPackage.license;
  if (license !== undefined && hasAllowedAlternative(license)) continue;
  if (matchingException(packageName, lockedPackage) !== undefined) continue;
  problems.push(
    `${packageName}@${lockedPackage.version ?? 'unknown'}: ${license ?? 'missing license metadata'}`,
  );
}

if (problems.length > 0) {
  process.stderr.write(`license-lint: ${String(problems.length)} issue(s)\n`);
  for (const problem of problems) process.stderr.write(`  ${problem}\n`);
  process.exit(1);
}

process.stdout.write(
  `license-lint: OK — ${String(Object.keys(lock.packages).length - 1)} locked package(s), ${String(exceptions.size)} documented exception(s)\n`,
);
