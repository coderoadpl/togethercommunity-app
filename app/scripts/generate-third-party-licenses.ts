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

## Project-level notices

**Foundation files synchronized from
[coderoadpl/agentproofarch](https://github.com/coderoadpl/agentproofarch)** are
included under the MIT license, © 2026 Mateusz Choma. \`FOUNDATION.md\` lists the
synchronized paths: \`app/eslint.config.js\`, \`app/eslint-plugin-together/\`,
\`app/.dependency-cruiser.cjs\`, \`app/tsconfig*.json\`, the \`app/package.json\`
gate scripts, \`app/scripts/doc-lint.ts\`, \`app/scripts/smoke*.ts\`,
\`app/config-regression/\`, \`.github/workflows/\`, and the agent instruction
files. The MIT license requires that its permission notice travel with every
copy, so it is reproduced in full here.

MIT License

Copyright (c) 2026 Mateusz Choma

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

**Bundled fonts (OFL-1.1).** The web client ships five font families installed
as \`@fontsource\` packages and imported in \`app/apps/web/src/main.tsx\`. They are
licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/),
whose copyright notice and license text must accompany every copy of the font
files; each package carries the full license in its \`LICENSE\` file under
\`app/node_modules/@fontsource/\`.

- Fraunces — Copyright 2020 The Fraunces Project Authors
  ([undercasetype/Fraunces](https://github.com/undercasetype/Fraunces))
- Inter — Copyright 2016 The Inter Project Authors
  ([rsms/inter](https://github.com/rsms/inter))
- JetBrains Mono — Copyright 2020 The JetBrains Mono Project Authors
  ([JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono))
- Manrope — Copyright 2019 The Manrope Project Authors
  ([sharanda/manrope](https://github.com/sharanda/manrope))
- Space Grotesk — Copyright 2020 The Space Grotesk Project Authors
  ([floriankarsten/space-grotesk](https://github.com/floriankarsten/space-grotesk))

**sharp / libvips.** The dev-only Argos upload tooling installs sharp's
prebuilt libvips binaries (\`@img/sharp-libvips-*\`, LGPL-3.0-or-later; the
related \`@img/sharp-*\` prebuilds carry the same notice). They are
platform-specific shared libraries installed under \`node_modules\` alongside
sharp and loaded by it at runtime through dynamic linking. The LGPL-3.0
obligations are satisfied by that dynamic linking together with upstream
source availability, documented at
[sharp.pixelplumbing.com](https://sharp.pixelplumbing.com/). libvips is the one
copyleft entry in the dependency policy; the full machine-checked exception
registry — fonts, datasets, permissive MIT variants and these prebuilds — lives
in \`app/scripts/license-lint.ts\`.

**\`app/adapters/invoicing/xsd/\`** holds the official FA(3) schemas published by
the Polish Ministry of Finance (podatki.gov.pl, KSeF FA(3) schema). They are
public administrative documents, redistributed unmodified for validation so
invoices can be checked locally.

## npm dependencies

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
