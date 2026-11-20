import { sql } from 'drizzle-orm';

import { lockWaitMs } from './bounded-advisory-lock.js';
import type { Db } from './client.js';
import { deadlockDetected, lockNotAvailable, queryCanceled } from './pg-errors.js';

export interface ChangeProposalBounds {
  lockWaitMs: number;
  dryRunStatementMs: number;
  approvalStatementMs: number;
}

export type ChangeProposalBoundOptions = Partial<ChangeProposalBounds>;

const DEFAULT_DRY_RUN_STATEMENT_MS = 2_000;

const DEFAULT_APPROVAL_STATEMENT_MS = 5_000;

const POSTGRES_MAX_STATEMENT_TIMEOUT_MS = 2_147_483_647;

const statementMs = (value: number): number => {
  if (!Number.isInteger(value) || value < 1 || value > POSTGRES_MAX_STATEMENT_TIMEOUT_MS) {
    throw new Error('The statement time bound must be a positive whole number of milliseconds');
  }
  return value;
};

export const changeProposalBounds = (options: ChangeProposalBoundOptions = {}): ChangeProposalBounds => ({
  lockWaitMs: lockWaitMs(options.lockWaitMs),
  dryRunStatementMs: statementMs(options.dryRunStatementMs ?? DEFAULT_DRY_RUN_STATEMENT_MS),
  approvalStatementMs: statementMs(options.approvalStatementMs ?? DEFAULT_APPROVAL_STATEMENT_MS),
});

const milliseconds = (value: number): string => `${String(value)}ms`;

export const boundLockWait = async (executor: Db, bounds: ChangeProposalBounds): Promise<void> => {
  await executor.execute(sql`select set_config('lock_timeout', ${milliseconds(bounds.lockWaitMs)}, true)`);
};

export const boundStatementTime = async (executor: Db, statementTimeMs: number): Promise<void> => {
  await executor.execute(sql`select set_config('statement_timeout', ${milliseconds(statementTimeMs)}, true)`);
};

export const ranOutOfTime = (cause: unknown): boolean =>
  lockNotAvailable(cause) || deadlockDetected(cause) || queryCanceled(cause);

export const busyAfterRollback = async <T, B>(work: () => Promise<T>, busy: B): Promise<T | B> => {
  try {
    return await work();
  } catch (cause) {
    if (ranOutOfTime(cause)) return busy;
    throw cause;
  }
};
