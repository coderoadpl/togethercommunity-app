import { parse } from 'yaml';
import { z } from 'zod';

const dependencySchema = z.object({
  version: z.string(),
});

const snapshotSchema = z
  .object({
    dependencies: z.record(z.string(), z.string()).optional(),
    optionalDependencies: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const lockfileSchema = z
  .object({
    importers: z.record(
      z.string(),
      z
        .object({
          dependencies: z.record(z.string(), dependencySchema).optional(),
        })
        .passthrough(),
    ),
    packages: z.record(z.string(), z.unknown()),
    snapshots: z.record(z.string(), snapshotSchema),
  })
  .passthrough();

export interface LockfilePackages {
  all: ReadonlySet<string>;
  production: ReadonlySet<string>;
}

export const splitPackageIdentifier = (
  identifier: string,
): { name: string; version: string } | undefined => {
  const separator = identifier.lastIndexOf('@');
  if (separator <= 0) return undefined;
  return {
    name: identifier.slice(0, separator),
    version: identifier.slice(separator + 1),
  };
};

const packageIdentifierFromSnapshot = (snapshot: string): string =>
  snapshot.replace(/\(.+$/, '');

export const lockfilePackages = (raw: string): LockfilePackages => {
  const lockfile = lockfileSchema.parse(parse(raw));
  const all = new Set(Object.keys(lockfile.packages).map(packageIdentifierFromSnapshot));
  const production = new Set<string>();
  const pending = Object.entries(lockfile.importers['.']?.dependencies ?? {}).map(
    ([name, dependency]) => `${name}@${dependency.version}`,
  );
  const visited = new Set<string>();

  for (const requested of pending) {
    const separator = requested.indexOf('@', 1);
    const snapshot =
      lockfile.snapshots[requested] === undefined
        ? requested.slice(separator + 1)
        : requested;
    if (visited.has(snapshot)) continue;
    const metadata = lockfile.snapshots[snapshot];
    if (metadata === undefined) {
      throw new Error(`${requested}: missing snapshot in pnpm-lock.yaml`);
    }
    visited.add(snapshot);
    production.add(packageIdentifierFromSnapshot(snapshot));
    for (const dependencies of [
      metadata.dependencies ?? {},
      metadata.optionalDependencies ?? {},
    ]) {
      for (const [name, version] of Object.entries(dependencies)) {
        const namedSnapshot = `${name}@${version}`;
        pending.push(
          lockfile.snapshots[namedSnapshot] === undefined ? version : namedSnapshot,
        );
      }
    }
  }

  return { all, production };
};
