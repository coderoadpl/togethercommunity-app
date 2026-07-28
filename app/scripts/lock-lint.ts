import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const result = spawnSync(
  'pnpm',
  ['install', '--frozen-lockfile', '--lockfile-only'],
  { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' },
);

if (result.error !== undefined) {
  process.stderr.write(`lock-lint: could not run pnpm: ${result.error.message}\n`);
  process.exit(1);
}

if (result.status !== 0) {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(1);
}

process.stdout.write('lock-lint: OK\n');
