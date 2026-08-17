import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { lockfilePackages, splitPackageIdentifier } from './license-lock.js';

const licensePackageSchema = z
  .object({
    license: z.string(),
    name: z.string(),
    versions: z.array(z.string()).min(1),
  })
  .passthrough();

const licenseReportSchema = z.record(z.string(), z.array(licensePackageSchema));
const packageJsonSchema = z.object({ license: z.string().optional() });

interface LicenseException {
  devOnly?: boolean;
  license?: string;
  packagePattern: RegExp;
  reason: string;
  versionPattern: RegExp;
}

interface LicensedPackage {
  devOnly: boolean;
  license: string;
  name: string;
  version: string;
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
]);

const hasAllowedAlternative = (license: string): boolean => {
  if (/\s+(?:AND|WITH)\s+/.test(license)) return false;
  const alternatives = license
    .replaceAll('(', '')
    .replaceAll(')', '')
    .split(/\s+OR\s+/);
  return alternatives.some((alternative) => allowedLicenses.has(alternative.trim()));
};

const packageIdentifier = (name: string, version: string): string => `${name}@${version}`;

const runLicenseReport = (): z.infer<typeof licenseReportSchema> => {
  const result = spawnSync('pnpm', ['licenses', 'list', '--json'], {
    cwd: join(import.meta.dirname, '..'),
    encoding: 'utf8',
  });
  if (result.error !== undefined) {
    process.stderr.write(`license-lint: could not run pnpm: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(1);
  }
  return licenseReportSchema.parse(JSON.parse(result.stdout));
};

const reportPackages = (
  report: z.infer<typeof licenseReportSchema>,
  productionIdentifiers: ReadonlySet<string>,
): LicensedPackage[] =>
  Object.values(report).flatMap((packages) =>
    packages.flatMap((pkg) =>
      pkg.versions.map((version) => {
        const identifier = packageIdentifier(pkg.name, version);
        return {
          devOnly: !productionIdentifiers.has(identifier),
          license: pkg.license,
          name: pkg.name,
          version,
        };
      }),
    ),
  );

const matchingException = (pkg: LicensedPackage): string | undefined => {
  for (const [key, exception] of exceptions) {
    if (!exception.packagePattern.test(pkg.name)) continue;
    if (!exception.versionPattern.test(pkg.version)) continue;
    if (exception.license !== undefined && exception.license !== pkg.license) continue;
    if (exception.devOnly === true && !pkg.devOnly) continue;
    return key;
  }
  return undefined;
};

const rootDir = join(import.meta.dirname, '..');
const lockPath = join(rootDir, 'pnpm-lock.yaml');
const thirdPartyPath = join(rootDir, '..', 'THIRD-PARTY-LICENSES.md');
const licensePath = join(rootDir, '..', 'LICENSE.md');
const packageJsonPath = join(rootDir, 'package.json');
const lockPackages = lockfilePackages(readFileSync(lockPath, 'utf8'));
const lockIdentifiers = lockPackages.all;
const allReport = runLicenseReport();
const productionIdentifiers = lockPackages.production;
const packages = reportPackages(allReport, productionIdentifiers);
const thirdPartyLicenses = readFileSync(thirdPartyPath, 'utf8');
const licenseDocument = readFileSync(licensePath, 'utf8');
const packageJson = packageJsonSchema.parse(JSON.parse(readFileSync(packageJsonPath, 'utf8')));
const problems: string[] = [];
const matchedExceptions = new Set<string>();
const thirdPartyPackages = new Map<string, string>();
for (const match of thirdPartyLicenses.matchAll(
  /^- \[([^\]]+@[^\]]+)\]\([^)]+\) - (.+)$/gm,
)) {
  const identifier = match[1];
  const license = match[2];
  if (identifier !== undefined && license !== undefined) {
    thirdPartyPackages.set(identifier, license);
  }
}
const licenseAbbreviation = /^## Abbreviation\s+(\S+)/m.exec(licenseDocument)?.[1];

if (licenseAbbreviation === undefined) {
  problems.push('LICENSE.md: missing abbreviation');
} else if (packageJson.license !== licenseAbbreviation) {
  problems.push(
    `package.json root license: ${packageJson.license ?? 'missing'} (expected ${licenseAbbreviation})`,
  );
}

for (const pkg of packages) {
  const identifier = packageIdentifier(pkg.name, pkg.version);
  if (!lockIdentifiers.has(identifier)) {
    problems.push(`${identifier}: reported by pnpm but missing from pnpm-lock.yaml`);
    continue;
  }
  const documentedLicense = thirdPartyPackages.get(identifier);
  if (documentedLicense !== undefined && documentedLicense !== pkg.license) {
    problems.push(
      `${identifier}: installed license ${pkg.license} differs from documented ${documentedLicense}`,
    );
  }
}

for (const identifier of lockIdentifiers) {
  const parsed = splitPackageIdentifier(identifier);
  if (parsed === undefined) {
    problems.push(`${identifier}: invalid package identifier in pnpm-lock.yaml`);
    continue;
  }
  const license = thirdPartyPackages.get(identifier);
  if (license === undefined) {
    problems.push(`${identifier}: missing from THIRD-PARTY-LICENSES.md`);
    continue;
  }
  const pkg = {
    devOnly: !productionIdentifiers.has(identifier),
    license,
    name: parsed.name,
    version: parsed.version,
  };
  const exceptionKey = matchingException(pkg);
  if (exceptionKey !== undefined) {
    matchedExceptions.add(exceptionKey);
    continue;
  }
  if (!hasAllowedAlternative(license)) {
    problems.push(`${identifier}: ${license}`);
  }
}

for (const identifier of thirdPartyPackages.keys()) {
  if (!lockIdentifiers.has(identifier)) {
    problems.push(`${identifier}: documented but missing from pnpm-lock.yaml`);
  }
}

for (const exceptionKey of exceptions.keys()) {
  if (!matchedExceptions.has(exceptionKey)) {
    problems.push(`${exceptionKey}: documented exception does not match any locked package`);
  }
}

if (problems.length > 0) {
  process.stderr.write(`license-lint: ${String(problems.length)} issue(s)\n`);
  for (const problem of problems) process.stderr.write(`  ${problem}\n`);
  process.exit(1);
}

process.stdout.write(
  `license-lint: OK — ${String(lockIdentifiers.size)} locked package(s), ${String(exceptions.size)} documented exception(s)\n`,
);
