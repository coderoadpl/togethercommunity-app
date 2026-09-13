import { describe, expect, it } from 'vitest';

import { normalizeDatabaseConnectionString } from './client.js';

describe('database connection string normalization', () => {
  it.each(['require', 'prefer', 'verify-ca'])(
    'rewrites sslmode=%s to verify-full',
    (sslmode) => {
      expect(normalizeDatabaseConnectionString(
        `postgres://user:pass@example.test/database?application_name=together&sslmode=${sslmode}`,
      )).toBe('postgres://user:pass@example.test/database?application_name=together&sslmode=verify-full');
    },
  );

  it.each([
    'postgres://user:pass@example.test/database',
    'postgres://user:pass@example.test/database?sslmode=verify-full',
    'postgres://user:pass@example.test/database?sslmode=disable',
  ])('leaves %s unchanged', (connectionString) => {
    expect(normalizeDatabaseConnectionString(connectionString)).toBe(connectionString);
  });
});
