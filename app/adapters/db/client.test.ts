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
      '[database-pool] Idle client removed: [{"name":"Error","message":"Connection terminated unexpectedly"}] total=0 idle=0 waiting=0',
    );
    await pool.end();
  });

  it('overrides only the supplied pool options', async () => {
    const pool = new pg.Pool();
    const constructPool = vi.spyOn(pg, 'Pool').mockImplementation(function () {
      return pool;
    });

    createDb('node-postgres', 'postgres://user:pass@example.test/database', {
      connectionTimeoutMillis: 200,
      idleTimeoutMillis: 500,
      max: 1,
    });

    expect(constructPool).toHaveBeenCalledWith({
      connectionString: 'postgres://user:pass@example.test/database',
      connectionTimeoutMillis: 200,
      idleTimeoutMillis: 500,
      max: 1,
      keepAlive: true,
      allowExitOnIdle: true,
    });
    await pool.end();
  });

  it('sanitizes nested error parameters and excludes connection details from pool logs', async () => {
    const pool = new pg.Pool();
    vi.spyOn(pg, 'Pool').mockImplementation(function () {
      return pool;
    });
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    createDb('node-postgres', 'postgres://user:private-password@example.test/database');

    pool.emit('error', new Error('Query failed\nparams: private-value', {
      cause: new Error('Connection failed\nparams: private-cause'),
    }));

    expect(logError).toHaveBeenCalledWith(
      '[database-pool] Idle client removed: [{"name":"Error","message":"Query failed"},{"name":"Error","message":"Connection failed"}] total=0 idle=0 waiting=0',
    );
    await pool.end();
  });
});
