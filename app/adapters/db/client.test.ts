import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDb, normalizeDatabaseConnectionString } from './client.js';

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe('node-postgres connection pool', () => {
  it('configures idle connection expiry, keepalive and connection limits', async () => {
    const pool = new pg.Pool();
    const constructPool = vi.spyOn(pg, 'Pool').mockImplementation(function () {
      return pool;
    });

    createDb('node-postgres', 'postgres://user:pass@example.test/database?sslmode=require');

    expect(constructPool).toHaveBeenCalledWith({
      connectionString: 'postgres://user:pass@example.test/database?sslmode=verify-full',
      idleTimeoutMillis: 30_000,
      keepAlive: true,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
    await pool.end();
  });

  it('handles and logs idle-client errors without throwing', async () => {
    const pool = new pg.Pool();
    vi.spyOn(pg, 'Pool').mockImplementation(function () {
      return pool;
    });
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    createDb('node-postgres', 'postgres://user:pass@example.test/database');

    expect(() => pool.emit('error', new Error('Connection terminated unexpectedly'))).not.toThrow();

    expect(logError).toHaveBeenCalledWith(
      '[database-pool] Idle client removed:',
      'Connection terminated unexpectedly',
    );
    await pool.end();
  });
});
