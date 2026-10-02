import {
  isProductionEnvironment,
  resettableEnvironment,
  type DeploymentDatabaseVerdict,
} from '#core/domain/index.js';

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface VercelBuildPolicyEnv {
  APP_ENV?: string | undefined;
  NODE_ENV?: string | undefined;
  VERCEL_ENV?: string | undefined;
  VERCEL_DEPLOYMENT_ID?: string | undefined;
  VERCEL_GIT_COMMIT_SHA?: string | undefined;
  VERCEL_GIT_COMMIT_REF?: string | undefined;
  DATABASE_URL?: string | undefined;
}

export type StagingSeedCandidate =
  | { action: 'inspect-markers'; databaseUrl: string }
  | { action: 'skip'; reason: 'not-staging' | 'missing-database-url' | 'database-not-allowed' };

export type StagingSeedDecision =
  | { action: 'seed' }
  | { action: 'skip'; reason: 'markers-present' };

export interface MigrationJournalState {
  tables: number;
  journalRows: number;
}

export interface VercelBuildOnceMarker {
  deploymentId: string;
  gitCommitSha: string;
  timestamp: string;
  artifact: {
    outputDirectory: string;
    manifestPath: string;
    entryPath: string;
    entrySha256: string;
    derivedVersion: string;
  };
}

type VercelBuildOnceAttempt = Omit<VercelBuildOnceMarker, 'artifact'>;

export interface VercelBuildOncePaths {
  outputDirectory: string;
  stateDirectory: string;
  markerPath: string;
  lockDirectory: string;
}

export type VercelBuildOnceDecision =
  | { action: 'run-local' }
  | { action: 'reuse'; marker: VercelBuildOnceMarker }
  | { action: 'fail'; message: string }
  | {
      action: 'run';
      lockAcquired: boolean;
      marker: VercelBuildOnceAttempt;
      paths: VercelBuildOncePaths;
    };

export type MigrationJournalDecision =
  | { action: 'allowed' }
  | { action: 'refused'; message: string };

export interface VercelBuildOnceOptions {
  env: VercelBuildPolicyEnv;
  outputDirectory: string;
  manifestPath: string;
  now?: () => Date;
  readMarker?: (markerPath: string) => Promise<VercelBuildOnceMarker | null>;
  sleep?: (milliseconds: number) => Promise<void>;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
}

const markerFileName = '.vercel-build.json';
const defaultWaitTimeoutMs = 20 * 60 * 1000;
const defaultPollIntervalMs = 1000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isErrorCode = (cause: unknown, code: string): boolean =>
  isRecord(cause) && cause['code'] === code;

const defaultSleep = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

const safePathSegment = (value: string): string => value.replace(/[^A-Za-z0-9._-]/g, '_');

const vercelBuildOnceMarker = (
  env: VercelBuildPolicyEnv,
  now: () => Date,
): VercelBuildOnceAttempt | null => {
  if (env.VERCEL_DEPLOYMENT_ID === undefined || env.VERCEL_DEPLOYMENT_ID === '') return null;
  return {
    deploymentId: env.VERCEL_DEPLOYMENT_ID,
    gitCommitSha: env.VERCEL_GIT_COMMIT_SHA ?? '',
    timestamp: now().toISOString(),
  };
};

export const vercelBuildOncePaths = (
  outputDirectory: string,
  marker: VercelBuildOnceAttempt,
): VercelBuildOncePaths => {
  const key = safePathSegment(marker.deploymentId);
  const stateDirectory = join(tmpdir(), 'together-vercel-build-once', key);
  return {
    outputDirectory,
    stateDirectory,
    markerPath: join(stateDirectory, markerFileName),
    lockDirectory: join(stateDirectory, 'lock'),
  };
};

const parseVercelBuildOnceMarker = (value: unknown): VercelBuildOnceMarker | null => {
  if (!isRecord(value)) return null;
  const deploymentId = value['deploymentId'];
  const gitCommitSha = value['gitCommitSha'];
  const timestamp = value['timestamp'];
  const artifact = value['artifact'];
  if (typeof deploymentId !== 'string') return null;
  if (typeof gitCommitSha !== 'string') return null;
  if (typeof timestamp !== 'string') return null;
  if (!isRecord(artifact)) return null;
  const outputDirectory = artifact['outputDirectory'];
  const manifestPath = artifact['manifestPath'];
  const entryPath = artifact['entryPath'];
  const entrySha256 = artifact['entrySha256'];
  const derivedVersion = artifact['derivedVersion'];
  if (typeof outputDirectory !== 'string') return null;
  if (typeof manifestPath !== 'string') return null;
  if (typeof entryPath !== 'string') return null;
  if (typeof entrySha256 !== 'string') return null;
  if (typeof derivedVersion !== 'string') return null;
  return {
    deploymentId,
    gitCommitSha,
    timestamp,
    artifact: { outputDirectory, manifestPath, entryPath, entrySha256, derivedVersion },
  };
};

export const vercelBuildOnceMarkerMatches = (
  expected: VercelBuildOnceAttempt,
  actual: VercelBuildOnceMarker | null,
): actual is VercelBuildOnceMarker =>
  actual !== null
  && actual.deploymentId === expected.deploymentId
  && actual.gitCommitSha === expected.gitCommitSha;

export const readVercelBuildOnceMarker = async (
  markerPath: string,
): Promise<VercelBuildOnceMarker | null> => {
  let contents: string;
  try {
    contents = await readFile(markerPath, 'utf8');
  } catch (cause) {
    if (isErrorCode(cause, 'ENOENT')) return null;
    throw cause;
  }
  try {
    return parseVercelBuildOnceMarker(JSON.parse(contents));
  } catch {
    return null;
  }
};

const vercelBuildOnceArtifactMatches = async (
  marker: VercelBuildOnceMarker,
  paths: VercelBuildOncePaths,
  manifestPath: string,
): Promise<boolean> => {
  const entryPath = join(paths.outputDirectory, 'index.html');
  if (marker.artifact.outputDirectory !== paths.outputDirectory) return false;
  if (marker.artifact.manifestPath !== manifestPath) return false;
  if (marker.artifact.entryPath !== entryPath) return false;
  try {
    const [entry, manifestContents] = await Promise.all([
      readFile(entryPath),
      readFile(manifestPath, 'utf8'),
    ]);
    const manifest = JSON.parse(manifestContents);
    if (!isRecord(manifest) || manifest['version'] !== marker.artifact.derivedVersion) return false;
    return createHash('sha256').update(entry).digest('hex') === marker.artifact.entrySha256;
  } catch {
    return false;
  }
};

const reusableVercelBuildOnceMarker = async (
  expected: VercelBuildOnceAttempt,
  actual: VercelBuildOnceMarker | null,
  paths: VercelBuildOncePaths,
  manifestPath: string,
): Promise<VercelBuildOnceMarker | null> =>
  vercelBuildOnceMarkerMatches(expected, actual)
  && await vercelBuildOnceArtifactMatches(actual, paths, manifestPath)
    ? actual
    : null;

const acquireVercelBuildOnceLock = async (paths: VercelBuildOncePaths): Promise<boolean> => {
  await mkdir(paths.outputDirectory, { recursive: true });
  await mkdir(paths.stateDirectory, { recursive: true });
  try {
    await mkdir(paths.lockDirectory);
    return true;
  } catch (cause) {
    if (isErrorCode(cause, 'EEXIST')) return false;
    throw cause;
  }
};

const vercelBuildOnceLockExists = async (paths: VercelBuildOncePaths): Promise<boolean> => {
  try {
    await access(paths.lockDirectory, constants.F_OK);
    return true;
  } catch (cause) {
    if (isErrorCode(cause, 'ENOENT')) return false;
    throw cause;
  }
};

type VercelBuildOnceWaitResult =
  | { status: 'completed'; marker: VercelBuildOnceMarker }
  | { status: 'holder-failed' }
  | { status: 'timed-out' };

const waitForVercelBuildOnceMarker = async (
  expected: VercelBuildOnceAttempt,
  paths: VercelBuildOncePaths,
  manifestPath: string,
  readMarker: (markerPath: string) => Promise<VercelBuildOnceMarker | null>,
  now: () => Date,
  sleep: (milliseconds: number) => Promise<void>,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<VercelBuildOnceWaitResult> => {
  const deadline = now().getTime() + timeoutMs;
  while (now().getTime() < deadline) {
    const existing = await reusableVercelBuildOnceMarker(
      expected,
      await readMarker(paths.markerPath),
      paths,
      manifestPath,
    );
    if (existing !== null) return { status: 'completed', marker: existing };
    if (!await vercelBuildOnceLockExists(paths)) {
      const completed = await reusableVercelBuildOnceMarker(
        expected,
        await readMarker(paths.markerPath),
        paths,
        manifestPath,
      );
      return completed === null
        ? { status: 'holder-failed' }
        : { status: 'completed', marker: completed };
    }
    const remaining = deadline - now().getTime();
    await sleep(Math.min(pollIntervalMs, remaining));
  }
  const existing = await reusableVercelBuildOnceMarker(
    expected,
    await readMarker(paths.markerPath),
    paths,
    manifestPath,
  );
  return existing !== null
    ? { status: 'completed', marker: existing }
    : { status: 'timed-out' };
};

export const beginVercelBuildOnce = async (
  options: VercelBuildOnceOptions,
): Promise<VercelBuildOnceDecision> => {
  const now = options.now ?? (() => new Date());
  const marker = vercelBuildOnceMarker(options.env, now);
  if (marker === null) return { action: 'run-local' };

  const paths = vercelBuildOncePaths(options.outputDirectory, marker);
  const readMarker = options.readMarker ?? readVercelBuildOnceMarker;
  const existing = await reusableVercelBuildOnceMarker(
    marker,
    await readMarker(paths.markerPath),
    paths,
    options.manifestPath,
  );
  if (existing !== null) return { action: 'reuse', marker: existing };

  const lockAcquired = await acquireVercelBuildOnceLock(paths);
  if (lockAcquired) {
    const completed = await reusableVercelBuildOnceMarker(
      marker,
      await readMarker(paths.markerPath),
      paths,
      options.manifestPath,
    );
    if (completed !== null) {
      await rm(paths.lockDirectory, { recursive: true, force: true });
      return { action: 'reuse', marker: completed };
    }
    await rm(paths.markerPath, { force: true });
    return { action: 'run', lockAcquired: true, marker, paths };
  }

  const waitResult = await waitForVercelBuildOnceMarker(
    marker,
    paths,
    options.manifestPath,
    readMarker,
    now,
    options.sleep ?? defaultSleep,
    options.waitTimeoutMs ?? defaultWaitTimeoutMs,
    options.pollIntervalMs ?? defaultPollIntervalMs,
  );
  if (waitResult.status === 'completed') return { action: 'reuse', marker: waitResult.marker };
  if (waitResult.status === 'holder-failed') {
    return {
      action: 'fail',
      message: `vercel-build: first build invocation ended without publishing an artifact for deployment ${marker.deploymentId}`,
    };
  }
  return {
    action: 'fail',
    message: `vercel-build: timed out waiting for the first build invocation for deployment ${marker.deploymentId}`,
  };
};

export const completeVercelBuildOnce = async (
  decision: Extract<VercelBuildOnceDecision, { action: 'run' }>,
  manifestPath: string,
  derivedVersion: string,
): Promise<void> => {
  const entryPath = join(decision.paths.outputDirectory, 'index.html');
  const entry = await readFile(entryPath);
  const marker: VercelBuildOnceMarker = {
    ...decision.marker,
    artifact: {
      outputDirectory: decision.paths.outputDirectory,
      manifestPath,
      entryPath,
      entrySha256: createHash('sha256').update(entry).digest('hex'),
      derivedVersion,
    },
  };
  await mkdir(dirname(decision.paths.markerPath), { recursive: true });
  const temporaryPath = join(dirname(decision.paths.markerPath), `${markerFileName}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`);
  await rename(temporaryPath, decision.paths.markerPath);
};

export const releaseVercelBuildOnce = async (
  decision: Extract<VercelBuildOnceDecision, { action: 'run' }>,
): Promise<void> => {
  if (!decision.lockAcquired) return;
  try {
    await access(decision.paths.lockDirectory, constants.F_OK);
  } catch (cause) {
    if (isErrorCode(cause, 'ENOENT')) return;
    throw cause;
  }
  await rm(decision.paths.lockDirectory, { recursive: true, force: true });
};

export const isStagingDeployment = (env: VercelBuildPolicyEnv): boolean => {
  if (isProductionEnvironment(env)) return false;
  if (env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'staging') return true;
  return resettableEnvironment(env.APP_ENV) === 'staging' && env.VERCEL_ENV !== 'production';
};

export const stagingSeedCandidate = (
  env: VercelBuildPolicyEnv,
  verdict: DeploymentDatabaseVerdict,
): StagingSeedCandidate => {
  if (!isStagingDeployment(env)) return { action: 'skip', reason: 'not-staging' };
  if (verdict.decision !== 'allowed') return { action: 'skip', reason: 'database-not-allowed' };
  return env.DATABASE_URL === undefined || env.DATABASE_URL === ''
    ? { action: 'skip', reason: 'missing-database-url' }
    : { action: 'inspect-markers', databaseUrl: env.DATABASE_URL };
};

export const stagingSeedDecision = (markersPresent: boolean): StagingSeedDecision =>
  markersPresent ? { action: 'skip', reason: 'markers-present' } : { action: 'seed' };

export const migrationJournalDecision = (
  state: MigrationJournalState,
): MigrationJournalDecision =>
  state.tables > 0 && state.journalRows === 0
    ? {
        action: 'refused',
        message:
          `the database has ${state.tables} tables but no migration journal; it looks like a schema-only copy. Recreate it as an empty database (see docs/staging.md).`,
      }
    : { action: 'allowed' };
