import { describe, expect, it } from 'vitest';

import { assertReseedAllowed, reseedMarkers } from './reseed-guard.js';

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
