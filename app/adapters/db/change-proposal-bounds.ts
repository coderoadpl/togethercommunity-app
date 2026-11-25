import { sql } from 'drizzle-orm';

import { boundedAdvisoryLock, lockWaitMs } from './bounded-advisory-lock.js';
import type { Db } from './client.js';
import { deadlockDetected, lockNotAvailable, queryCanceled } from './pg-errors.js';

export interface ChangeProposalBounds {
  lockWaitMs: number;
  dryRunStatementMs: number;
  approvalStatementMs: number;
  notificationMs: number;
}

export type ChangeProposalBoundOptions = Partial<ChangeProposalBounds>;

const DEFAULT_DRY_RUN_STATEMENT_MS = 2_000;

const DEFAULT_APPROVAL_STATEMENT_MS = 5_000;

// The owner notification is a few indexed statements of milliseconds each, awaited by the key's 202 after its proposal
// committed: half a second is far above its normal time and keeps a held notification row from delaying the answer.
const DEFAULT_NOTIFICATION_MS = 500;

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
  notificationMs: statementMs(options.notificationMs ?? DEFAULT_NOTIFICATION_MS),
});

const milliseconds = (value: number): string => `${String(value)}ms`;

export const boundLockWait = async (executor: Db, bounds: Pick<ChangeProposalBounds, 'lockWaitMs'>): Promise<void> => {
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

/** Every proposal insert and every quarantined image release of a workspace queues here, so a release never misses a proposal being stored. */
export const lockWorkspaceProposals = (executor: Db, tenantId: string, bounds: Pick<ChangeProposalBounds, 'lockWaitMs'>): Promise<boolean> =>
  boundedAdvisoryLock(executor, `change-proposals:${tenantId}`, { lockWaitMs: bounds.lockWaitMs, lockWaitAfterMs: bounds.lockWaitMs });
