import { describe, expect, it } from 'vitest';

import { deploymentDatabaseVerdict, unnamedDeploymentSlotWarning } from '#core/domain/index.js';

import { assertReseedAllowed, deploymentMarkers, reseedMarkers } from './reseed-guard.js';

const STAGING_FINGERPRINT = '71d7070abde9';
const PRODUCTION_FINGERPRINT = '90b36442b2ea';

const stagingEnv = {
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  DATABASE_URL: 'postgres://user:pass@staging-db.example.test/together',
  PRODUCTION_DATABASE_FINGERPRINT: PRODUCTION_FINGERPRINT,
};

describe('reseed guard', () => {
  it('fingerprints the database host the way the health endpoint does', () => {
    expect(reseedMarkers(stagingEnv).databaseFingerprint).toBe(STAGING_FINGERPRINT);
  });

  it('allows a staging deployment whose database is not the production one', () => {
    expect(() => assertReseedAllowed(reseedMarkers(stagingEnv))).not.toThrow();
  });

  it.each([
    ['an unlabelled deployment', { NODE_ENV: 'production', APP_ENV: undefined }],
    ['an explicit production APP_ENV', { NODE_ENV: 'development', APP_ENV: 'production' }],
  ])('refuses the CLI reseed on %s', (_name, environment) => {
    expect(() => assertReseedAllowed(reseedMarkers({ ...stagingEnv, ...environment })))
      .toThrow(/deployment identity reports production/);
  });

  it('refuses when DATABASE_URL points at the production database', () => {
    expect(() => assertReseedAllowed(reseedMarkers({
      ...stagingEnv,
      DATABASE_URL: 'postgres://user:pass@production-db.example.test/together',
    }))).toThrow(/database fingerprint matches the production database/);
  });

  it('keeps a local development reseed available', () => {
    expect(() => assertReseedAllowed(reseedMarkers({
      DATABASE_URL: 'postgres://together:together@localhost:48912/together',
    }))).not.toThrow();
  });
});

const PRODUCTION_DATABASE_URL = 'postgres://user:pass@production-db.example.test/together';

describe('build-time database target guard', () => {
  it('lets a production deployment migrate the production database', () => {
    expect(deploymentDatabaseVerdict(deploymentMarkers({
      ...stagingEnv,
      APP_ENV: 'production',
      VERCEL_ENV: 'production',
      DATABASE_URL: PRODUCTION_DATABASE_URL,
    }))).toEqual({ decision: 'allowed' });
  });

  it('refuses a preview deployment pointed at the production database', () => {
    expect(deploymentDatabaseVerdict(deploymentMarkers({
      ...stagingEnv,
      APP_ENV: 'preview',
      VERCEL_ENV: 'preview',
      DATABASE_URL: PRODUCTION_DATABASE_URL,
    }))).toEqual({
      decision: 'refused',
      message: 'this deployment is not production but DATABASE_URL is the production database',
    });
  });

  it('refuses a deployment the platform calls preview even when APP_ENV claims production', () => {
    expect(deploymentDatabaseVerdict(deploymentMarkers({
      ...stagingEnv,
      APP_ENV: 'production',
      VERCEL_ENV: 'preview',
      DATABASE_URL: PRODUCTION_DATABASE_URL,
    })).decision).toBe('refused');
  });

  it('lets a preview deployment migrate its own database', () => {
    expect(deploymentDatabaseVerdict(deploymentMarkers({
      ...stagingEnv,
      APP_ENV: 'preview',
      VERCEL_ENV: 'preview',
    }))).toEqual({ decision: 'allowed' });
  });

  it('refuses a Vercel build whose VERCEL_ENV is absent and whose database is the production one', () => {
    expect(deploymentDatabaseVerdict(deploymentMarkers({
      ...stagingEnv,
      APP_ENV: undefined,
      VERCEL: '1',
      DATABASE_URL: PRODUCTION_DATABASE_URL,
    })).decision).toBe('refused');
  });

  it('lets a self-hosted production build with no VERCEL_ENV migrate the production database', () => {
    expect(deploymentDatabaseVerdict(deploymentMarkers({
      ...stagingEnv,
      APP_ENV: 'production',
      DATABASE_URL: PRODUCTION_DATABASE_URL,
    }))).toEqual({ decision: 'allowed' });
  });

  it.each([
    ['a Vercel build', { VERCEL: '1' }, 'treated as non-production'],
    ['a self-hosted build', {}, 'taken from APP_ENV and NODE_ENV alone'],
  ])('warns that the deployment slot is unnamed on %s', (_name, environment, expected) => {
    expect(unnamedDeploymentSlotWarning({ ...stagingEnv, ...environment }))
      .toContain(expected);
  });

  it('stays quiet about the deployment slot when VERCEL_ENV names it', () => {
    expect(unnamedDeploymentSlotWarning({ ...stagingEnv, VERCEL_ENV: 'preview' })).toBeNull();
  });

  it('warns instead of failing when the production fingerprint is not configured yet', () => {
    expect(deploymentDatabaseVerdict(deploymentMarkers({
      ...stagingEnv,
      APP_ENV: 'preview',
      VERCEL_ENV: 'preview',
      PRODUCTION_DATABASE_FINGERPRINT: undefined,
      DATABASE_URL: PRODUCTION_DATABASE_URL,
    }))).toEqual({
      decision: 'warned',
      message: expect.stringContaining('PRODUCTION_DATABASE_FINGERPRINT is unset'),
    });
  });
});
