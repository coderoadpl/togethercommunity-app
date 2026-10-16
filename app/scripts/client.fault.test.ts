import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { errorChainEntrySchema } from '#core/domain/index.js';

import { createTrustedOrigins, FAILURE_RETRY_MS } from '../apps/server/src/trusted-origins.js';

import { createDb } from '#adapters/db/client.js';
import { testPoolOf } from '#adapters/db/test-pool.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const configuredOrigins = ['https://app.example.test'];
const customOrigin = 'https://members.example.test';

const isolatedConnectionString = (): string => {
  const url = new URL(baseDatabaseUrl);
  url.searchParams.set('application_name', `together_pool_fault_${crypto.randomUUID()}`);
  return url.toString();
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('node-postgres connection faults', () => {
  it('recovers trusted origins after a real connection timeout and the failure backoff', async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    const pools: ReturnType<typeof testPoolOf>[] = [];

    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('Expected a TCP listening address');
      }
      const failingDb = createDb('node-postgres', `postgres://user:pass@127.0.0.1:${String(address.port)}/db`, {
        connectionTimeoutMillis: 200,
      });
      const failingPool = testPoolOf(failingDb);
      pools.push(failingPool);
      const healthyDb = createDb('node-postgres', isolatedConnectionString());
      const healthyPool = testPoolOf(healthyDb);
      pools.push(healthyPool);

      await expect(failingPool.query('select 1')).rejects.toMatchObject({
        message: 'Connection terminated due to connection timeout',
        cause: { message: 'Connection terminated unexpectedly' },
      });
      let healthy = false;
      let now = 0;
      const logger = { error: vi.fn(), warn: vi.fn() };
      const loadCustomOrigins = vi.fn(async () => {
        await (healthy ? healthyDb : failingDb).execute('select 1');
        return [customOrigin];
      });
      const trustedOrigins = createTrustedOrigins({
        configuredOrigins,
        loadCustomOrigins,
        logger,
        now: () => now,
      });

      expect(await trustedOrigins()).toEqual(configuredOrigins);
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Connection terminated due to connection timeout'));
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('cold=true'));
      healthy = true;
      now += FAILURE_RETRY_MS - 1;
      expect(await trustedOrigins()).toEqual(configuredOrigins);
      expect(loadCustomOrigins).toHaveBeenCalledTimes(1);
      now += 1;
      expect(await trustedOrigins()).toEqual([...configuredOrigins, customOrigin]);
      expect(loadCustomOrigins).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith('[trusted-origins] Domain lookup recovered after 1 failures');
      expect(failingPool.totalCount).toBe(0);
      expect(failingPool.waitingCount).toBe(0);
      expect(healthyPool.waitingCount).toBe(0);
    } finally {
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        ...pools.map((pool) => pool.end()),
        new Promise<void>((resolve, reject) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        }),
      ]);
    }
  });

  it('logs counters for a killed idle client and serves the next query on a new connection', async () => {
    const connectionString = isolatedConnectionString();
    const db = createDb('node-postgres', connectionString);
    const pool = testPoolOf(db);
    const admin = testPoolOf(createDb('node-postgres', baseDatabaseUrl));
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const result = await pool.query<{ pid: unknown }>('select pg_backend_pid() pid');
      const pid = result.rows[0]?.pid;
      if (typeof pid !== 'number') throw new Error('Expected a backend process identifier');
      expect(pool.totalCount).toBe(1);
      expect(pool.idleCount).toBe(1);
      const removed = once(pool, 'error', { signal: AbortSignal.timeout(5_000) });
      const [termination, event] = await Promise.all([
        admin.query('select pg_terminate_backend($1) terminated', [pid]),
        removed,
      ]);
      expect(termination).toMatchObject({ rows: [{ terminated: true }] });
      const error = errorChainEntrySchema.parse(event[0]);
      expect(error.message).toBe('terminating connection due to administrator command');
      expect(logError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('[database-pool] Idle client removed:'));
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('total=0 idle=0 waiting=0'));
      expect(logError).toHaveBeenCalledWith(expect.stringContaining('terminating connection due to administrator command'));
      expect(logError).not.toHaveBeenCalledWith(expect.stringContaining(connectionString));
      const next = await db.execute('select pg_backend_pid() pid, 1 value');
      expect(next).toMatchObject({ rows: [{ pid: expect.any(Number), value: 1 }] });
      expect(next).not.toMatchObject({ rows: [{ pid }] });
      expect(pool.waitingCount).toBe(0);
    } finally {
      await Promise.all([pool.end(), admin.end()]);
    }
  });

  it('times out an exhausted pool and recovers after the held transaction ends', async () => {
    const db = createDb('node-postgres', isolatedConnectionString(), {
      max: 1,
      connectionTimeoutMillis: 200,
    });
    const pool = testPoolOf(db);

    try {
      const client = await pool.connect();
      try {
        await client.query('begin');
        expect(pool.totalCount).toBe(1);
        expect(pool.idleCount).toBe(0);
        await expect(pool.query('select 1')).rejects.toMatchObject({
          message: 'timeout exceeded when trying to connect',
        });
        expect(pool.waitingCount).toBe(0);
      } finally {
        try {
          await client.query('rollback');
        } finally {
          client.release();
        }
      }
      const result = await db.execute('select 1 value');
      expect(result).toMatchObject({ rows: [{ value: 1 }] });
      expect(pool.totalCount).toBe(1);
      expect(pool.idleCount).toBe(1);
      expect(pool.waitingCount).toBe(0);
    } finally {
      await pool.end();
    }
  });
});
