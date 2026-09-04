import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { isProductionEnvironment, resettableEnvironment } from '#core/domain/index.js';

import { deriveVersion } from './derive-version.js';

const appRoot = join(import.meta.dirname, '..');
const manifestPath = join(appRoot, 'package.json');
const manifestVersionField = /^(\s*"version":\s*")[^"]*(")/m;

const run = (command: string, args: readonly string[]): void => {
  const result = spawnSync(command, [...args], { cwd: appRoot, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

// The manifest is the single version source every surface already reads, so
// the derived number is written into this build's copy of it instead of being
// threaded separately into the server bundle, the browser bundle and the CLI.
const applyDerivedVersion = (): void => {
  const derived = deriveVersion({ repoRoot: appRoot });
  const manifest = readFileSync(manifestPath, 'utf8');
  const stamped = manifest.replace(manifestVersionField, `$1${derived.version}$2`);
  if (stamped === manifest) {
    process.stderr.write('vercel-build: package.json has no version field\n');
    process.exit(1);
  }
  writeFileSync(manifestPath, stamped);
  process.stdout.write(
    `vercel-build: version ${derived.version}${derived.complete ? '' : ' (git history unavailable)'}\n`,
  );
};

const reseedOnDeploy =
  process.env['STAGING_RESEED_ON_DEPLOY'] === 'true'
  && resettableEnvironment(process.env['APP_ENV']) !== null
  && !isProductionEnvironment(process.env);

applyDerivedVersion();
run('pnpm', ['run', 'db:migrate']);
if (reseedOnDeploy) run('pnpm', ['exec', 'tsx', 'adapters/db/reseed.ts']);
run('pnpm', ['run', 'build']);
