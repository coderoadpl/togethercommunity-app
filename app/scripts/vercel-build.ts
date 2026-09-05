import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import {
  deploymentDatabaseVerdict,
  isProductionEnvironment,
  resettableEnvironment,
  unnamedDeploymentSlotWarning,
} from '#core/domain/index.js';
import { deploymentMarkers } from '#adapters/db/reseed-guard.js';

import { deriveVersion } from './derive-version.js';
import { stampManifestVersion } from './stamp-manifest-version.js';

const appRoot = join(import.meta.dirname, '..');
const manifestPath = join(appRoot, 'package.json');

const run = (command: string, args: readonly string[]): void => {
  const result = spawnSync(command, [...args], { cwd: appRoot, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

// The manifest is the single version source every surface already reads, so
// the derived number is written into this build's copy of it instead of being
// threaded separately into the server bundle, the browser bundle and the CLI.
// Vercel invokes this script twice per deployment, so a manifest that already
// carries the derived number is a success, not a failure.
const applyDerivedVersion = (): void => {
  const derived = deriveVersion({ repoRoot: appRoot });
  const outcome = stampManifestVersion(manifestPath, derived.version);
  if (outcome === 'missing-field') {
    process.stderr.write('vercel-build: package.json has no version field\n');
    process.exit(1);
  }
  const history = derived.complete ? '' : ' (git history unavailable)';
  const repeat = outcome === 'unchanged' ? ' (already stamped)' : '';
  process.stdout.write(`vercel-build: version ${derived.version}${history}${repeat}\n`);
};

const assertDeploymentDatabase = (): void => {
  const slotWarning = unnamedDeploymentSlotWarning(process.env);
  if (slotWarning !== null) process.stdout.write(`vercel-build: ${slotWarning}\n`);
  if (process.env['DATABASE_URL'] === undefined)
    process.stdout.write('vercel-build: DATABASE_URL is unset, so the guard has no database to compare\n');
  const verdict = deploymentDatabaseVerdict(deploymentMarkers({
    ...process.env,
    DATABASE_URL: process.env['DATABASE_URL'] ?? '',
  }));
  if (verdict.decision === 'refused') {
    process.stderr.write(`vercel-build: refusing to migrate — ${verdict.message}\n`);
    process.exit(1);
  }
  if (verdict.decision === 'warned') process.stdout.write(`vercel-build: ${verdict.message}\n`);
};

const reseedOnDeploy =
  process.env['STAGING_RESEED_ON_DEPLOY'] === 'true'
  && resettableEnvironment(process.env['APP_ENV']) !== null
  && !isProductionEnvironment(process.env);

applyDerivedVersion();
assertDeploymentDatabase();
run('pnpm', ['run', 'db:migrate']);
if (reseedOnDeploy) run('pnpm', ['exec', 'tsx', 'adapters/db/reseed.ts']);
run('pnpm', ['run', 'build']);
