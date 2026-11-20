import { sql } from 'drizzle-orm';

import type { Db } from './client.js';
import { lockNotAvailable } from './pg-errors.js';

const ADVISORY_LOCK_WAIT = '5s';

export const boundedAdvisoryLock = async (executor: Db, name: string, lockWaitAfter: string | null = null): Promise<boolean> => {
  await executor.execute(sql`select set_config('lock_timeout', ${ADVISORY_LOCK_WAIT}, true)`);
  try {
    await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${name}, 0))`);
  } catch (cause) {
    if (lockNotAvailable(cause)) return false;
    throw cause;
  }
  await executor.execute(lockWaitAfter === null
    ? sql`set local lock_timeout to default`
    : sql`select set_config('lock_timeout', ${lockWaitAfter}, true)`);
  return true;
};
