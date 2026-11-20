import { sql } from 'drizzle-orm';

import type { Db } from './client.js';
import { deadlockDetected, lockNotAvailable, queryCanceled } from './pg-errors.js';

export interface ChangeProposalBounds {
  lockWaitMs: number;
  dryRunStatementMs: number;
  approvalStatementMs: number;
}

export const CHANGE_PROPOSAL_BOUNDS: ChangeProposalBounds = {
  lockWaitMs: 5_000,
  dryRunStatementMs: 2_000,
  approvalStatementMs: 5_000,
};

export const milliseconds = (value: number): string => `${String(value)}ms`;

export const boundLockWait = async (executor: Db, bounds: ChangeProposalBounds): Promise<void> => {
  await executor.execute(sql`select set_config('lock_timeout', ${milliseconds(bounds.lockWaitMs)}, true)`);
};

export const boundStatementTime = async (executor: Db, statementMs: number): Promise<void> => {
  await executor.execute(sql`select set_config('statement_timeout', ${milliseconds(statementMs)}, true)`);
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
