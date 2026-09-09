import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import {
  deploymentDatabaseVerdict,
  unnamedDeploymentSlotWarning,
  type DeploymentDatabaseVerdict,
} from '#core/domain/index.js';
import { deploymentMarkers } from '#adapters/db/reseed-guard.js';
import { seedMarkersPresent } from '#adapters/db/seed-markers.js';

import { deriveVersion } from './derive-version.js';
import { stampManifestVersion } from './stamp-manifest-version.js';
import { stagingSeedCandidate, stagingSeedDecision } from './vercel-build-policy.js';

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

const assertDeploymentDatabase = (): DeploymentDatabaseVerdict => {
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
  return verdict;
};

const seedEmptyStagingDeployment = async (verdict: DeploymentDatabaseVerdict): Promise<void> => {
  const candidate = stagingSeedCandidate(process.env, verdict);
  if (candidate.action === 'skip') {
    if (candidate.reason === 'missing-database-url') {
      process.stdout.write('vercel-build: staging seed skipped because DATABASE_URL is unset\n');
    } else if (candidate.reason === 'database-not-allowed') {
      process.stdout.write('vercel-build: staging seed skipped because the database guard did not allow data writes\n');
    }
    return;
  }

  let markersPresent: boolean;
  try {
    markersPresent = await seedMarkersPresent(candidate.databaseUrl);
  } catch (cause) {
    process.stderr.write(`vercel-build: seed marker probe failed — ${
      cause instanceof Error ? cause.message : String(cause)
    }\n`);
    process.exit(1);
  }
  const decision = stagingSeedDecision(markersPresent);
  if (decision.action === 'skip') {
    process.stdout.write('vercel-build: staging seed skipped because seed markers already exist\n');
    return;
  }
  process.stdout.write('vercel-build: staging seed markers absent, applying deployed seed\n');
  run('pnpm', ['run', 'db:seed']);
};

applyDerivedVersion();
const deploymentVerdict = assertDeploymentDatabase();
run('pnpm', ['run', 'db:migrate']);
await seedEmptyStagingDeployment(deploymentVerdict);
run('pnpm', ['run', 'build:web']);
