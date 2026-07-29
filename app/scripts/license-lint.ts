import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

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
      license: 'MIT',
      packagePattern: /^rechoir$/,
      reason: 'The installed package manifest identifies 0.6.2 as MIT.',
      versionPattern: /^0\.6\.2$/,
    },
  ],
  [
    '@img/sharp-libvips-*@1.3.2',
    {
      devOnly: true,
      license: 'LGPL-3.0-or-later',
      packagePattern: /^@img\/sharp-libvips-.+$/,
      reason:
        'dev-only Argos upload tooling (sharp/libvips prebuilt); never part of the product bundle; owner-approved Argos evaluation 2026-07-28.',
      versionPattern: /^1\.3\.2$/,
    },
  ],
  [
    '@img/sharp-wasm32@0.35.3',
    {
      devOnly: true,
      license: 'Apache-2.0 AND LGPL-3.0-or-later AND MIT',
      packagePattern: /^@img\/sharp-wasm32$/,
      reason:
        'dev-only Argos upload tooling (sharp/libvips prebuilt); never part of the product bundle; owner-approved Argos evaluation 2026-07-28.',
      versionPattern: /^0\.35\.3$/,
    },
  ],
  [
    '@img/sharp-win32-*@0.35.3',
    {
      devOnly: true,
      license: 'Apache-2.0 AND LGPL-3.0-or-later',
      packagePattern: /^@img\/sharp-win32-(?:arm64|ia32|x64)$/,
      reason:
        'dev-only Argos upload tooling (sharp/libvips prebuilt); never part of the product bundle; owner-approved Argos evaluation 2026-07-28.',
      versionPattern: /^0\.35\.3$/,
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

const splitPackageIdentifier = (
  identifier: string,
): { name: string; version: string } | undefined => {
  const separator = identifier.lastIndexOf('@');
  if (separator <= 0) return undefined;
  return {
    name: identifier.slice(0, separator),
    version: identifier.slice(separator + 1),
  };
};

const lockedPackageIdentifiers = (raw: string): Set<string> => {
  const identifiers = new Set<string>();
  let inPackages = false;
  for (const line of raw.split('\n')) {
    if (line === 'packages:') {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line)) break;
    if (!inPackages) continue;
    const match = /^ {2}(.+):$/.exec(line);
    if (match?.[1] === undefined) continue;
    const quoted = match[1];
    const key =
      quoted.startsWith("'") && quoted.endsWith("'")
        ? quoted.slice(1, -1).replaceAll("''", "'")
        : quoted;
    const identifier = key.replace(/\(.+$/, '');
    if (splitPackageIdentifier(identifier) !== undefined) identifiers.add(identifier);
  }
  return identifiers;
};

const runLicenseReport = (prod: boolean): z.infer<typeof licenseReportSchema> => {
  const args = ['licenses', 'list'];
  if (prod) args.push('--prod');
  args.push('--json');
  const result = spawnSync('pnpm', args, {
    cwd: join(import.meta.dirname, '..'),
    encoding: 'utf8',
  });
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
const lockIdentifiers = lockedPackageIdentifiers(readFileSync(lockPath, 'utf8'));
const allReport = runLicenseReport(false);
const prodReport = runLicenseReport(true);
const productionIdentifiers = new Set(
  Object.values(prodReport).flatMap((packages) =>
    packages.flatMap((pkg) =>
      pkg.versions.map((version) => packageIdentifier(pkg.name, version)),
    ),
  ),
);
const packages = reportPackages(allReport, productionIdentifiers);
const thirdPartyLicenses = readFileSync(thirdPartyPath, 'utf8');
const licenseDocument = readFileSync(licensePath, 'utf8');
const packageJson = packageJsonSchema.parse(JSON.parse(readFileSync(packageJsonPath, 'utf8')));
const problems: string[] = [];
const matchedExceptions = new Set<string>();
const thirdPartyPackages = new Set(
  [...thirdPartyLicenses.matchAll(/^- \[([^\]]+@[^\]]+)\]/gm)].map((match) => match[1]),
);
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
  const exceptionKey = matchingException(pkg);
  if (exceptionKey !== undefined) {
    matchedExceptions.add(exceptionKey);
    continue;
  }
  if (!hasAllowedAlternative(pkg.license)) {
    problems.push(`${identifier}: ${pkg.license}`);
  }
}

for (const identifier of productionIdentifiers) {
  if (!thirdPartyPackages.has(identifier)) {
    problems.push(`${identifier}: missing from THIRD-PARTY-LICENSES.md`);
  }
}

for (const [exceptionKey, exception] of exceptions) {
  if (matchedExceptions.has(exceptionKey)) continue;
  for (const identifier of lockIdentifiers) {
    const parsed = splitPackageIdentifier(identifier);
    if (parsed === undefined) continue;
    const candidate: LicensedPackage = {
      devOnly: !productionIdentifiers.has(identifier),
      license: exception.license ?? '',
      name: parsed.name,
      version: parsed.version,
    };
    if (matchingException(candidate) === exceptionKey) {
      matchedExceptions.add(exceptionKey);
      break;
    }
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
