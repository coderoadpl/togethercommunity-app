import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

const resultSchema = z.object({
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
});

const cacheDir = mkdtempSync(join(tmpdir(), 'together-lock-lint-'));

try {
  const result = spawnSync(
    'npm',
    [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--dry-run',
      '--json',
      '--legacy-peer-deps',
      '--cache',
      cacheDir,
    ],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exitCode = 1;
  } else {
    const changes = resultSchema.parse(JSON.parse(result.stdout));
    const drift = changes.added + changes.removed + changes.changed;
    if (drift > 0) {
      process.stderr.write(
        `lock-lint: package-lock.json has ${String(drift)} pending change(s); run npm install\n`,
      );
      process.exitCode = 1;
    } else {
      process.stdout.write('lock-lint: OK\n');
    }
  }
} finally {
  rmSync(cacheDir, { recursive: true, force: true });
}
