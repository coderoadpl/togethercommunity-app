import { sql } from 'drizzle-orm';

import type { Db } from './client.js';
import { lockNotAvailable } from './pg-errors.js';

const DEFAULT_LOCK_WAIT_MS = 5_000;

const POSTGRES_MAX_LOCK_TIMEOUT_MS = 2_147_483_647;

export const lockWaitMs = (value: number = DEFAULT_LOCK_WAIT_MS): number => {
  if (!Number.isInteger(value) || value < 1 || value > POSTGRES_MAX_LOCK_TIMEOUT_MS) {
    throw new Error('The lock wait must be a positive whole number of milliseconds');
  }
  return value;
};

const lockTimeout = (milliseconds: number): string => `${String(milliseconds)}ms`;

export const boundedAdvisoryLock = async (
  executor: Db,
  name: string,
  waits: { lockWaitMs: number; lockWaitAfterMs: number | null },
): Promise<boolean> => {
  await executor.execute(sql`select set_config('lock_timeout', ${lockTimeout(waits.lockWaitMs)}, true)`);
  try {
    await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${name}, 0))`);
  } catch (cause) {
    if (lockNotAvailable(cause)) return false;
    throw cause;
  }
  await executor.execute(waits.lockWaitAfterMs === null
    ? sql`set local lock_timeout to default`
    : sql`select set_config('lock_timeout', ${lockTimeout(waits.lockWaitAfterMs)}, true)`);
  return true;
};
