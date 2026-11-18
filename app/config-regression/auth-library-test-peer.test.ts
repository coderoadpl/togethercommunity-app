import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const dependencyMapSchema = z.record(z.string(), z.unknown()).optional();

const entrySchema = z.object({
  dependencies: dependencyMapSchema,
  optionalDependencies: dependencyMapSchema,
  peerDependencies: dependencyMapSchema,
  peerDependenciesMeta: dependencyMapSchema,
}).passthrough();

const importerDependenciesSchema = z.record(
  z.string(),
  z.object({ version: z.string() }).passthrough(),
).optional();

const lockfileSchema = z.object({
  importers: z.record(z.string(), z.object({
    dependencies: importerDependenciesSchema,
    devDependencies: importerDependenciesSchema,
    optionalDependencies: importerDependenciesSchema,
  }).passthrough()),
  packages: z.record(z.string(), entrySchema),
  snapshots: z.record(z.string(), entrySchema.nullable()),
});

type LockfileEntry = z.infer<typeof entrySchema>;

const lockfilePath = process.env.AUTH_PEER_LOCKFILE ?? join(import.meta.dirname, '..', 'pnpm-lock.yaml');
const lockfile = lockfileSchema.parse(parse(readFileSync(lockfilePath, 'utf8')));

const isAuthLibrary = (name: string): boolean =>
  name === 'better-auth' || name.startsWith('@better-auth/');

const packageNameOf = (key: string): string => {
  const versionSeparator = key.indexOf('@', key.startsWith('@') ? 1 : 0);
  return versionSeparator === -1 ? key : key.slice(0, versionSeparator);
};

const authEntries = (section: Record<string, LockfileEntry | null>): [string, LockfileEntry | null][] =>
  Object.entries(section).filter(([key]) => isAuthLibrary(packageNameOf(key)));

const vitestFieldsOf = (entry: LockfileEntry | null): string[] =>
  (['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta'] as const)
    .filter((field) => entry?.[field]?.vitest !== undefined);

const carriesVitest = (resolution: string): boolean => resolution.includes('(vitest@');

describe('authentication library test-runner peer', () => {
  it('keeps the authentication library in the lockfile', () => {
    expect(authEntries(lockfile.packages).map(([key]) => packageNameOf(key))).toContain('better-auth');
    expect(authEntries(lockfile.snapshots).map(([key]) => packageNameOf(key))).toContain('better-auth');
  });

  it.each(['packages', 'snapshots'] as const)('declares no vitest on any %s entry', (section) => {
    const offenders = authEntries(lockfile[section]).flatMap(([key, entry]) => [
      ...(carriesVitest(key) ? [`${key}: key suffix`] : []),
      ...vitestFieldsOf(entry).map((field) => `${key}: ${field}`),
    ]);

    expect(offenders).toEqual([]);
  });

  it('resolves every importer dependency on the authentication library without vitest', () => {
    const offenders = Object.entries(lockfile.importers).flatMap(([importer, groups]) =>
      [groups.dependencies, groups.devDependencies, groups.optionalDependencies].flatMap((group) =>
        Object.entries(group ?? {})
          .filter(([name, { version }]) => isAuthLibrary(name) && carriesVitest(version))
          .map(([name]) => `${importer}: ${name}`),
      ),
    );

    expect(offenders).toEqual([]);
  });
});
