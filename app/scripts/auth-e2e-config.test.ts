import { describe, expect, it } from 'vitest';

import { resolveAuthE2eDatabaseUrl } from './auth-e2e-config.js';

describe('resolveAuthE2eDatabaseUrl', () => {
  it('prefers the CI e2e database URL', () => {
    expect(
      resolveAuthE2eDatabaseUrl({
        E2E_DATABASE_URL: 'postgres://ci/e2e',
        DATABASE_URL: 'postgres://ci/check',
      }),
    ).toBe('postgres://ci/e2e');
  });

  it('uses DATABASE_URL outside the e2e matrix', () => {
    expect(resolveAuthE2eDatabaseUrl({ DATABASE_URL: 'postgres://local/database' })).toBe(
      'postgres://local/database',
    );
  });

  it('uses the development Postgres default when no URL is configured', () => {
    expect(resolveAuthE2eDatabaseUrl({})).toBe(
      'postgres://together:together@localhost:48912/together',
    );
  });
});
