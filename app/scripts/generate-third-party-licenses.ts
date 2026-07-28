import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod';

import { lockfilePackages, splitPackageIdentifier } from './license-lock.js';

const licensePackageSchema = z
  .object({
    homepage: z.string().optional(),
    license: z.string(),
    name: z.string(),
    versions: z.array(z.string()).min(1),
  })
  .passthrough();

const licenseReportSchema = z.record(z.string(), z.array(licensePackageSchema));
const manifestSchema = z.object({
  homepage: z.string().optional(),
  license: z.string(),
});
const execFileAsync = promisify(execFile);
const rootDir = join(import.meta.dirname, '..');
const lockPackages = lockfilePackages(
  readFileSync(join(rootDir, 'pnpm-lock.yaml'), 'utf8'),
);
const { stdout: reportOutput } = await execFileAsync(
  'pnpm',
  ['licenses', 'list', '--json'],
  { cwd: rootDir, encoding: 'utf8' },
);
const report = licenseReportSchema.parse(JSON.parse(reportOutput));
const packages = new Map<string, { homepage: string; license: string }>();

for (const licensePackages of Object.values(report)) {
  for (const pkg of licensePackages) {
    for (const version of pkg.versions) {
      const identifier = `${pkg.name}@${version}`;
      if (!lockPackages.all.has(identifier)) continue;
      const homepage =
        pkg.homepage ?? `https://www.npmjs.com/package/${pkg.name}/v/${version}`;
      const previous = packages.get(identifier);
      if (previous !== undefined && previous.license !== pkg.license) {
        throw new Error(
          `${identifier}: conflicting licenses ${previous.license} and ${pkg.license}`,
        );
      }
      packages.set(identifier, { homepage, license: pkg.license });
    }
  }
}

const queue = [...lockPackages.all].filter((identifier) => !packages.has(identifier));

await Promise.all(
  Array.from({ length: Math.min(12, queue.length) }, async () => {
    for (;;) {
      const identifier = queue.pop();
      if (identifier === undefined) return;
      const parsed = splitPackageIdentifier(identifier);
      if (parsed === undefined) throw new Error(`${identifier}: invalid package identifier`);
      const { stdout } = await execFileAsync(
        'pnpm',
        ['view', identifier, 'license', 'homepage', '--json'],
        { cwd: rootDir, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      );
      const manifest = manifestSchema.parse(JSON.parse(stdout));
      packages.set(identifier, {
        homepage:
          manifest.homepage ??
          `https://www.npmjs.com/package/${parsed.name}/v/${parsed.version}`,
        license: manifest.license,
      });
    }
  }),
);

const header = `# Third-party licenses

This list covers every production and development dependency recorded in
\`app/pnpm-lock.yaml\`. From \`app/\`, regenerate it with
\`pnpm run licenses:generate\`.

Apache-2.0 §4(d) requires distributors of derivative works to preserve
applicable attribution notices from dependency \`NOTICE\` files. When
distributing Together, review installed Apache-2.0 dependencies and reproduce
their applicable notices in the distribution.

`;

const lines = [...packages.entries()]
  .sort(([left], [right]) => left.localeCompare(right, 'en'))
  .map(
    ([identifier, metadata]) =>
      `- [${identifier}](${metadata.homepage}) - ${metadata.license}`,
  );
const output = `${header}${lines.join('\n')}\n`;
const outputPath = join(rootDir, '..', 'THIRD-PARTY-LICENSES.md');
writeFileSync(outputPath, output);
process.stdout.write(`licenses: generated ${String(lines.length)} package entries\n`);
