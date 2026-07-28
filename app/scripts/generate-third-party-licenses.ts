import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

const licensePackageSchema = z
  .object({
    homepage: z.string().optional(),
    license: z.string(),
    name: z.string(),
    versions: z.array(z.string()).min(1),
  })
  .passthrough();

const licenseReportSchema = z.record(z.string(), z.array(licensePackageSchema));

const rootDir = join(import.meta.dirname, '..');
const result = spawnSync('pnpm', ['licenses', 'list', '--json'], {
  cwd: rootDir,
  encoding: 'utf8',
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(1);
}

const report = licenseReportSchema.parse(JSON.parse(result.stdout));
const packages = new Map<string, { homepage: string; license: string }>();

for (const licensePackages of Object.values(report)) {
  for (const pkg of licensePackages) {
    for (const version of pkg.versions) {
      const identifier = `${pkg.name}@${version}`;
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

const header = `# Third-party licenses

This list covers both production and development dependencies installed from
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
