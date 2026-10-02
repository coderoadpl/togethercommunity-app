import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  beginVercelBuildOnce,
  completeVercelBuildOnce,
  isStagingDeployment,
  migrationJournalDecision,
  readVercelBuildOnceMarker,
  releaseVercelBuildOnce,
  stagingSeedCandidate,
  stagingSeedDecision,
  vercelBuildOncePaths,
} from './vercel-build-policy.js';

const allowedVerdict = { decision: 'allowed' } as const;
const warnedVerdict = { decision: 'warned', message: 'missing production fingerprint' } as const;
const fixturePaths: string[] = [];

afterEach(() => {
  for (const path of fixturePaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

const fixtureDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'together-vercel-build-policy-'));
  fixturePaths.push(directory);
  return directory;
};

const buildFixture = () => {
  const root = fixtureDirectory();
  return {
    outputDirectory: join(root, 'dist/web'),
    manifestPath: join(root, 'package.json'),
  };
};

const artifactEvidence = (
  fixture: ReturnType<typeof buildFixture>,
  derivedVersion: string,
  entryContents: string,
) => ({
  outputDirectory: fixture.outputDirectory,
  manifestPath: fixture.manifestPath,
  entryPath: join(fixture.outputDirectory, 'index.html'),
  entrySha256: createHash('sha256').update(entryContents).digest('hex'),
  derivedVersion,
});

const writeArtifact = (
  fixture: ReturnType<typeof buildFixture>,
  derivedVersion: string,
  entryContents: string,
): void => {
  mkdirSync(fixture.outputDirectory, { recursive: true });
  writeFileSync(fixture.manifestPath, JSON.stringify({ version: derivedVersion }));
  writeFileSync(join(fixture.outputDirectory, 'index.html'), entryContents);
};

describe('vercel build staging seed policy', () => {
  it('recognizes the staging branch preview deployment', () => {
    expect(isStagingDeployment({
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'staging',
    })).toBe(true);
  });

  it('keeps non-staging previews out of the seed path', () => {
    expect(stagingSeedCandidate({
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'feature-x',
      DATABASE_URL: 'postgres://example',
    }, allowedVerdict)).toEqual({ action: 'skip', reason: 'not-staging' });
  });

  it('accepts the existing APP_ENV staging detection', () => {
    expect(stagingSeedCandidate({
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      VERCEL_ENV: 'preview',
      DATABASE_URL: 'postgres://example',
    }, allowedVerdict)).toEqual({ action: 'inspect-markers', databaseUrl: 'postgres://example' });
  });

  it('does not seed production deployments', () => {
    expect(stagingSeedCandidate({
      NODE_ENV: 'production',
      APP_ENV: 'production',
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_REF: 'main',
      DATABASE_URL: 'postgres://example',
    }, allowedVerdict)).toEqual({ action: 'skip', reason: 'not-staging' });
  });

  it('does not classify a production app environment as staging because the branch is named staging', () => {
    expect(stagingSeedCandidate({
      NODE_ENV: 'production',
      APP_ENV: 'production',
      VERCEL_ENV: 'preview',
      VERCEL_GIT_COMMIT_REF: 'staging',
      DATABASE_URL: 'postgres://example',
    }, allowedVerdict)).toEqual({ action: 'skip', reason: 'not-staging' });
  });

  it('does not inspect seed markers unless the deployment database verdict is allowed', () => {
    expect(stagingSeedCandidate({
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      VERCEL_ENV: 'preview',
      DATABASE_URL: 'postgres://example',
    }, warnedVerdict)).toEqual({ action: 'skip', reason: 'database-not-allowed' });
  });

  it('does not inspect seed markers without a database URL', () => {
    expect(stagingSeedCandidate({
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      VERCEL_ENV: 'preview',
      DATABASE_URL: '',
    }, allowedVerdict)).toEqual({ action: 'skip', reason: 'missing-database-url' });
  });

  it('seeds only when the marker probe finds no seed markers', () => {
    expect(stagingSeedDecision(false)).toEqual({ action: 'seed' });
    expect(stagingSeedDecision(true)).toEqual({ action: 'skip', reason: 'markers-present' });
  });

  it('allows an empty database before migrations', () => {
    expect(migrationJournalDecision({ tables: 0, journalRows: 0 })).toEqual({ action: 'allowed' });
  });

  it('allows a database with migration journal rows', () => {
    expect(migrationJournalDecision({ tables: 24, journalRows: 12 })).toEqual({ action: 'allowed' });
  });

  it('refuses a schema-only copy before migrations', () => {
    expect(migrationJournalDecision({ tables: 24, journalRows: 0 })).toEqual({
      action: 'refused',
      message:
        'the database has 24 tables but no migration journal; it looks like a schema-only copy. Recreate it as an empty database (see docs/staging.md).',
    });
  });
});

describe('vercel build once policy', () => {
  it('runs the first deployment invocation and writes a reusable marker', async () => {
    const fixture = buildFixture();
    const decision = await beginVercelBuildOnce({
      env: {
        VERCEL_DEPLOYMENT_ID: 'dpl_first',
        VERCEL_GIT_COMMIT_SHA: 'abc123',
      },
      outputDirectory: fixture.outputDirectory,
      manifestPath: fixture.manifestPath,
      now: () => new Date('2026-09-12T10:00:00.000Z'),
    });

    expect(decision.action).toBe('run');
    if (decision.action !== 'run') throw new Error('expected the first deployment invocation to run');
    expect(decision.lockAcquired).toBe(true);
    fixturePaths.push(decision.paths.stateDirectory);

    writeArtifact(fixture, '0.14.3', '<html>first</html>');
    await completeVercelBuildOnce(decision, fixture.manifestPath, '0.14.3');
    await releaseVercelBuildOnce(decision);

    expect(decision.paths.markerPath).not.toBe(join(fixture.outputDirectory, '.vercel-build.json'));
    const marker = JSON.parse(await readFile(decision.paths.markerPath, 'utf8'));
    expect(marker).toEqual({
      deploymentId: 'dpl_first',
      gitCommitSha: 'abc123',
      timestamp: '2026-09-12T10:00:00.000Z',
      artifact: artifactEvidence(fixture, '0.14.3', '<html>first</html>'),
    });
  });

  it('reuses a marker only when its artifact evidence matches', async () => {
    const fixture = buildFixture();
    writeArtifact(fixture, '0.14.3', '<html>reuse</html>');
    const expected = {
      deploymentId: 'dpl_reuse',
      gitCommitSha: 'def456',
      timestamp: '2026-09-12T10:05:00.000Z',
      artifact: artifactEvidence(fixture, '0.14.3', '<html>reuse</html>'),
    };
    const paths = vercelBuildOncePaths(fixture.outputDirectory, expected);
    mkdirSync(paths.stateDirectory, { recursive: true });
    fixturePaths.push(paths.stateDirectory);
    writeFileSync(paths.markerPath, JSON.stringify(expected));

    const decision = await beginVercelBuildOnce({
      env: {
        VERCEL_DEPLOYMENT_ID: 'dpl_reuse',
        VERCEL_GIT_COMMIT_SHA: 'def456',
      },
      outputDirectory: fixture.outputDirectory,
      manifestPath: fixture.manifestPath,
    });

    expect(decision).toEqual({
      action: 'reuse',
      marker: expected,
    });
  });

  it('runs when the marker survives but the artifact is missing', async () => {
    const fixture = buildFixture();
    const expected = {
      deploymentId: 'dpl_missing_artifact',
      gitCommitSha: 'bad123',
      timestamp: '2026-09-12T10:07:00.000Z',
      artifact: artifactEvidence(fixture, '0.14.3', '<html>missing</html>'),
    };
    const paths = vercelBuildOncePaths(fixture.outputDirectory, expected);
    mkdirSync(paths.stateDirectory, { recursive: true });
    fixturePaths.push(paths.stateDirectory);
    writeFileSync(paths.markerPath, JSON.stringify(expected));

    const decision = await beginVercelBuildOnce({
      env: {
        VERCEL_DEPLOYMENT_ID: 'dpl_missing_artifact',
        VERCEL_GIT_COMMIT_SHA: 'bad123',
      },
      outputDirectory: fixture.outputDirectory,
      manifestPath: fixture.manifestPath,
    });

    expect(decision.action).toBe('run');
    if (decision.action !== 'run') throw new Error('expected missing artifact evidence to run');
    await releaseVercelBuildOnce(decision);
  });

  it('runs when an existing marker belongs to a different commit', async () => {
    const fixture = buildFixture();
    writeArtifact(fixture, '0.14.3', '<html>old</html>');
    const existing = {
      deploymentId: 'dpl_mismatch',
      gitCommitSha: 'old',
      timestamp: '2026-09-12T10:10:00.000Z',
      artifact: artifactEvidence(fixture, '0.14.3', '<html>old</html>'),
    };
    const paths = vercelBuildOncePaths(fixture.outputDirectory, existing);
    mkdirSync(paths.stateDirectory, { recursive: true });
    fixturePaths.push(paths.stateDirectory);
    writeFileSync(paths.markerPath, JSON.stringify(existing));

    const decision = await beginVercelBuildOnce({
      env: {
        VERCEL_DEPLOYMENT_ID: 'dpl_mismatch',
        VERCEL_GIT_COMMIT_SHA: 'new',
      },
      outputDirectory: fixture.outputDirectory,
      manifestPath: fixture.manifestPath,
    });

    expect(decision.action).toBe('run');
    if (decision.action !== 'run') throw new Error('expected a mismatched marker to run');
    expect(decision.lockAcquired).toBe(true);
    await releaseVercelBuildOnce(decision);
  });

  it('waits for a concurrent invocation to publish the marker', async () => {
    const fixture = buildFixture();
    writeArtifact(fixture, '0.14.3', '<html>wait</html>');
    const expected = {
      deploymentId: 'dpl_wait',
      gitCommitSha: 'feed',
      timestamp: '2026-09-12T10:15:00.000Z',
      artifact: artifactEvidence(fixture, '0.14.3', '<html>wait</html>'),
    };
    const paths = vercelBuildOncePaths(fixture.outputDirectory, expected);
    mkdirSync(paths.lockDirectory, { recursive: true });
    fixturePaths.push(paths.stateDirectory);

    let clock = 0;
    const decision = await beginVercelBuildOnce({
      env: {
        VERCEL_DEPLOYMENT_ID: 'dpl_wait',
        VERCEL_GIT_COMMIT_SHA: 'feed',
      },
      outputDirectory: fixture.outputDirectory,
      manifestPath: fixture.manifestPath,
      now: () => new Date(clock),
      pollIntervalMs: 10,
      waitTimeoutMs: 50,
      sleep: async (milliseconds) => {
        clock += milliseconds;
        if (clock >= 20) writeFileSync(paths.markerPath, JSON.stringify(expected));
      },
    });

    expect(decision).toEqual({ action: 'reuse', marker: expected });
  });

  it('reuses when the marker is written and the lock is released between reads', async () => {
    const fixture = buildFixture();
    writeArtifact(fixture, '0.14.3', '<html>race</html>');
    const expected = {
      deploymentId: 'dpl_marker_lock_race',
      gitCommitSha: 'cafe',
      timestamp: '2026-09-12T10:20:00.000Z',
      artifact: artifactEvidence(fixture, '0.14.3', '<html>race</html>'),
    };
    const paths = vercelBuildOncePaths(fixture.outputDirectory, expected);
    mkdirSync(paths.lockDirectory, { recursive: true });
    fixturePaths.push(paths.stateDirectory);

    let reads = 0;
    const decision = await beginVercelBuildOnce({
      env: {
        VERCEL_DEPLOYMENT_ID: 'dpl_marker_lock_race',
        VERCEL_GIT_COMMIT_SHA: 'cafe',
      },
      outputDirectory: fixture.outputDirectory,
      manifestPath: fixture.manifestPath,
      now: () => new Date(0),
      pollIntervalMs: 10,
      waitTimeoutMs: 50,
      readMarker: async (markerPath) => {
        reads += 1;
        if (reads === 2) {
          writeFileSync(markerPath, JSON.stringify(expected));
          rmSync(paths.lockDirectory, { recursive: true, force: true });
          return null;
        }
        return readVercelBuildOnceMarker(markerPath);
      },
    });

    expect(decision).toEqual({ action: 'reuse', marker: expected });
    expect(reads).toBe(3);
  });

  it('lock-disappeared-without-marker-then-fail', async () => {
    const fixture = buildFixture();
    const expected = {
      deploymentId: 'dpl_holder_failed',
      gitCommitSha: 'cafe',
      timestamp: '2026-09-12T10:22:00.000Z',
    };
    const paths = vercelBuildOncePaths(fixture.outputDirectory, expected);
    mkdirSync(paths.lockDirectory, { recursive: true });
    fixturePaths.push(paths.stateDirectory);

    let clock = 0;
    const decision = await beginVercelBuildOnce({
      env: {
        VERCEL_DEPLOYMENT_ID: 'dpl_holder_failed',
        VERCEL_GIT_COMMIT_SHA: 'cafe',
      },
      outputDirectory: fixture.outputDirectory,
      manifestPath: fixture.manifestPath,
      now: () => new Date(clock),
      pollIntervalMs: 10,
      waitTimeoutMs: 50,
      sleep: async (milliseconds) => {
        clock += milliseconds;
        rmSync(paths.lockDirectory, { recursive: true, force: true });
      },
    });

    expect(decision).toEqual({
      action: 'fail',
      message: 'vercel-build: first build invocation ended without publishing an artifact for deployment dpl_holder_failed',
    });
  });

  it('fails when the lock wait times out', async () => {
    const fixture = buildFixture();
    const expected = {
      deploymentId: 'dpl_timeout',
      gitCommitSha: 'cafe',
      timestamp: '2026-09-12T10:20:00.000Z',
    };
    const paths = vercelBuildOncePaths(fixture.outputDirectory, expected);
    mkdirSync(paths.lockDirectory, { recursive: true });
    fixturePaths.push(paths.stateDirectory);

    let clock = 0;
    const decision = await beginVercelBuildOnce({
      env: {
        VERCEL_DEPLOYMENT_ID: 'dpl_timeout',
        VERCEL_GIT_COMMIT_SHA: 'cafe',
      },
      outputDirectory: fixture.outputDirectory,
      manifestPath: fixture.manifestPath,
      now: () => new Date(clock),
      pollIntervalMs: 10,
      waitTimeoutMs: 25,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
    });

    expect(decision).toEqual({
      action: 'fail',
      message: 'vercel-build: timed out waiting for the first build invocation for deployment dpl_timeout',
    });
  });
});
