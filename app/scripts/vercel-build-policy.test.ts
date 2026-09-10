import { describe, expect, it } from 'vitest';

import {
  isStagingDeployment,
  migrationJournalDecision,
  stagingSeedCandidate,
  stagingSeedDecision,
} from './vercel-build-policy.js';

const allowedVerdict = { decision: 'allowed' } as const;
const warnedVerdict = { decision: 'warned', message: 'missing production fingerprint' } as const;

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
