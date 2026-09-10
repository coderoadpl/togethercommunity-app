import {
  isProductionEnvironment,
  resettableEnvironment,
  type DeploymentDatabaseVerdict,
} from '#core/domain/index.js';

export interface VercelBuildPolicyEnv {
  APP_ENV?: string | undefined;
  NODE_ENV?: string | undefined;
  VERCEL_ENV?: string | undefined;
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

export type MigrationJournalDecision =
  | { action: 'allowed' }
  | { action: 'refused'; message: string };

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
