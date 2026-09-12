import {
  isProductionEnvironment,
  resettableEnvironment,
  type DeploymentDatabaseVerdict,
} from '#core/domain/index.js';

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
}

export interface VercelBuildOncePaths {
  outputDirectory: string;
  markerPath: string;
  lockDirectory: string;
}

export type VercelBuildOnceDecision =
  | { action: 'run-local' }
  | { action: 'reuse'; marker: VercelBuildOnceMarker }
  | {
      action: 'run';
      lockAcquired: boolean;
      marker: VercelBuildOnceMarker;
      paths: VercelBuildOncePaths;
    };

export type MigrationJournalDecision =
  | { action: 'allowed' }
  | { action: 'refused'; message: string };

export interface VercelBuildOnceOptions {
  env: VercelBuildPolicyEnv;
  outputDirectory: string;
  now?: () => Date;
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
): VercelBuildOnceMarker | null => {
  if (env.VERCEL_DEPLOYMENT_ID === undefined || env.VERCEL_DEPLOYMENT_ID === '') return null;
  return {
    deploymentId: env.VERCEL_DEPLOYMENT_ID,
    gitCommitSha: env.VERCEL_GIT_COMMIT_SHA ?? '',
    timestamp: now().toISOString(),
  };
};

export const vercelBuildOncePaths = (
  outputDirectory: string,
  marker: VercelBuildOnceMarker,
): VercelBuildOncePaths => {
  const key = safePathSegment(`${marker.deploymentId}-${marker.gitCommitSha}`);
  return {
    outputDirectory,
    markerPath: join(outputDirectory, markerFileName),
    lockDirectory: join(tmpdir(), `together-vercel-build-${key}.lock`),
  };
};

const parseVercelBuildOnceMarker = (value: unknown): VercelBuildOnceMarker | null => {
  if (!isRecord(value)) return null;
  const deploymentId = value['deploymentId'];
  const gitCommitSha = value['gitCommitSha'];
  const timestamp = value['timestamp'];
  if (typeof deploymentId !== 'string') return null;
  if (typeof gitCommitSha !== 'string') return null;
  if (typeof timestamp !== 'string') return null;
  return { deploymentId, gitCommitSha, timestamp };
};

export const vercelBuildOnceMarkerMatches = (
  expected: VercelBuildOnceMarker,
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

const acquireVercelBuildOnceLock = async (paths: VercelBuildOncePaths): Promise<boolean> => {
  await mkdir(paths.outputDirectory, { recursive: true });
  try {
    await mkdir(paths.lockDirectory);
    return true;
  } catch (cause) {
    if (isErrorCode(cause, 'EEXIST')) return false;
    throw cause;
  }
};

const waitForVercelBuildOnceMarker = async (
  expected: VercelBuildOnceMarker,
  paths: VercelBuildOncePaths,
  now: () => Date,
  sleep: (milliseconds: number) => Promise<void>,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<VercelBuildOnceMarker | null> => {
  const deadline = now().getTime() + timeoutMs;
  while (now().getTime() < deadline) {
    const existing = await readVercelBuildOnceMarker(paths.markerPath);
    if (vercelBuildOnceMarkerMatches(expected, existing)) return existing;
    const remaining = deadline - now().getTime();
    await sleep(Math.min(pollIntervalMs, remaining));
  }
  const existing = await readVercelBuildOnceMarker(paths.markerPath);
  return vercelBuildOnceMarkerMatches(expected, existing) ? existing : null;
};

export const beginVercelBuildOnce = async (
  options: VercelBuildOnceOptions,
): Promise<VercelBuildOnceDecision> => {
  const now = options.now ?? (() => new Date());
  const marker = vercelBuildOnceMarker(options.env, now);
  if (marker === null) return { action: 'run-local' };

  const paths = vercelBuildOncePaths(options.outputDirectory, marker);
  const existing = await readVercelBuildOnceMarker(paths.markerPath);
  if (vercelBuildOnceMarkerMatches(marker, existing)) return { action: 'reuse', marker: existing };

  const lockAcquired = await acquireVercelBuildOnceLock(paths);
  if (lockAcquired) return { action: 'run', lockAcquired: true, marker, paths };

  const completed = await waitForVercelBuildOnceMarker(
    marker,
    paths,
    now,
    options.sleep ?? defaultSleep,
    options.waitTimeoutMs ?? defaultWaitTimeoutMs,
    options.pollIntervalMs ?? defaultPollIntervalMs,
  );
  return completed === null
    ? { action: 'run', lockAcquired: false, marker, paths }
    : { action: 'reuse', marker: completed };
};

export const completeVercelBuildOnce = async (
  decision: Extract<VercelBuildOnceDecision, { action: 'run' }>,
): Promise<void> => {
  await mkdir(decision.paths.outputDirectory, { recursive: true });
  const temporaryPath = join(decision.paths.outputDirectory, `${markerFileName}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(decision.marker, null, 2)}\n`);
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
