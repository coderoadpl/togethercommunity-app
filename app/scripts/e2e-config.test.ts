import { describe, expect, it } from 'vitest';

import { assertSafeE2eDatabaseReset, resolveE2eDatabaseUrl } from './e2e-config.js';

describe('resolveE2eDatabaseUrl', () => {
  it('prefers the CI e2e database URL', () => {
    expect(
      resolveE2eDatabaseUrl({
        E2E_DATABASE_URL: 'postgres://ci/e2e',
        DATABASE_URL: 'postgres://ci/check',
      }),
    ).toBe('postgres://ci/e2e');
  });

  it('uses DATABASE_URL outside the e2e matrix', () => {
    expect(resolveE2eDatabaseUrl({ DATABASE_URL: 'postgres://local/database' })).toBe(
      'postgres://local/database',
    );
  });

  it('uses the development Postgres default when no URL is configured', () => {
    expect(resolveE2eDatabaseUrl({})).toBe(
      'postgres://together:together@localhost:48912/together',
    );
  });
});

describe('assertSafeE2eDatabaseReset', () => {
  it('allows the current CI service target and an e2e database name', () => {
    expect(() =>
      assertSafeE2eDatabaseReset(
        'postgres://together:together@localhost:5432/together',
        'together_auth_e2e_123',
        {},
      ),
    ).not.toThrow();
  });

  it('allows smoke and quickstart test database names on a local host', () => {
    expect(() =>
      assertSafeE2eDatabaseReset(
        'postgres://together:together@localhost:5432/together',
        'together_smoke_test_123',
        {},
      ),
    ).not.toThrow();
    expect(() =>
      assertSafeE2eDatabaseReset(
        'postgres://together:together@localhost:5432/together',
        'together_quickstart_test_123',
        {},
      ),
    ).not.toThrow();
  });

  it('refuses a non-e2e database name', () => {
    expect(() =>
      assertSafeE2eDatabaseReset(
        'postgres://together:together@localhost:5432/together',
        'together',
        {},
      ),
    ).toThrow('the target database name must include "e2e" or "test"');
  });

  it('refuses an invalid database URL', () => {
    expect(() =>
      assertSafeE2eDatabaseReset('not a database URL', 'together_auth_e2e_123', {}),
    ).toThrow('the resolved database URL is invalid');
  });

  it('refuses the Postgres service host without an explicit opt-in', () => {
    expect(() =>
      assertSafeE2eDatabaseReset(
        'postgres://together:together@postgres:5432/together',
        'together_e2e_member_shell',
        {},
      ),
    ).toThrow(
      'set E2E_ALLOW_REMOTE_DATABASE_RESET=true only for a disposable CI database server',
    );
  });

  it('refuses a remote host without an explicit opt-in', () => {
    expect(() =>
      assertSafeE2eDatabaseReset(
        'postgres://user:pass@db.example.test:5432/together',
        'together_auth_e2e_123',
        {},
      ),
    ).toThrow('set E2E_ALLOW_REMOTE_DATABASE_RESET=true only for a disposable CI database server');
  });

  it('allows a remote host with an explicit opt-in and an e2e database name', () => {
    expect(() =>
      assertSafeE2eDatabaseReset(
        'postgres://user:pass@db.example.test:5432/together',
        'together_auth_e2e_123',
        { E2E_ALLOW_REMOTE_DATABASE_RESET: 'true' },
      ),
    ).not.toThrow();
  });
});
