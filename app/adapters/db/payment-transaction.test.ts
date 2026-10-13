import { drizzle, NodePgSession, NodePgTransaction } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ok } from '#core/domain/index.js';

import { createPaymentTransactionPort } from './payment-transaction.js';
import * as schema from './schema.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const setup = () => {
  const dialect = new PgDialect();
  const session = new NodePgSession(new pg.Client(), dialect, undefined);
  const tx = new NodePgTransaction<typeof schema, ExtractTablesWithRelations<typeof schema>>(
    dialect,
    session,
    undefined,
  );
  const db = drizzle.mock({ schema });
  vi.spyOn(db, 'transaction').mockImplementation(async (operation) => operation(tx));
  vi.spyOn(tx, 'transaction').mockImplementation(async (operation) => operation(tx));
  return { port: createPaymentTransactionPort(db), tx, db };
};

const queryError = () => new Error('Failed query: select id from tenant_domains', {
  cause: Object.assign(new Error('Connection terminated unexpectedly'), {
    name: 'DatabaseError',
    code: '57P01',
    detail: 'The server closed an idle connection',
    routine: 'ProcessInterrupts',
  }),
});

const expectedChain = JSON.stringify([
  { name: 'Error', message: 'Failed query: select id from tenant_domains' },
  {
    name: 'DatabaseError',
    message: 'Connection terminated unexpectedly',
    code: '57P01',
    routine: 'ProcessInterrupts',
  },
]);

describe('payment transaction error handling', () => {
  it('awaits a rejected enrollment operation and preserves its Postgres cause without an unhandled rejection', async () => {
    const { port } = setup();
    let markOperationStarted: () => void = () => undefined;
    const operationStarted = new Promise<void>((resolve) => {
      markOperationStarted = resolve;
    });
    let rejectFailure: (reason: unknown) => void = () => undefined;
    const failure = new Promise<never>((_resolve, reject) => {
      rejectFailure = reject;
    });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const completed = vi.fn();
      const resultPromise = port.run(async ({ enrollmentTransaction }) => {
        const result = await enrollmentTransaction.run(async () => {
          markOperationStarted();
          return await failure;
        });
        completed();
        return result;
      });
      await operationStarted;
      expect(completed).not.toHaveBeenCalled();

      rejectFailure(queryError());

      await expect(resultPromise).resolves.toEqual({
        ok: false,
        error: {
          code: 'internal',
          message: `Could not complete enrollment savepoint: ${expectedChain}`,
        },
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(completed).toHaveBeenCalledOnce();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('preserves the error chain when the savepoint itself fails', async () => {
    const { port, tx } = setup();
    vi.mocked(tx.transaction).mockRejectedValue(queryError());

    const result = await port.run(async ({ enrollmentTransaction }) =>
      enrollmentTransaction.run(async () => ok(undefined)));

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: `Could not complete enrollment savepoint: ${expectedChain}`,
      },
    });
  });

  it('preserves the error chain when the outer transaction fails', async () => {
    const { port, db } = setup();
    vi.mocked(db.transaction).mockRejectedValue(queryError());

    const result = await port.run(async () => ok(undefined));

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'internal',
        message: `Could not complete payment transaction: ${expectedChain}`,
      },
    });
  });
});
