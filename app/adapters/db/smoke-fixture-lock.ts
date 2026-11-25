import { sql } from 'drizzle-orm';

import { SMOKE_TENANT_ID } from '#core/domain/index.js';

import type { Db } from './client.js';

export const lockSmokeFixture = async (db: Db, tenantId: string): Promise<void> => {
  if (tenantId === SMOKE_TENANT_ID) await db.execute(sql`select pg_advisory_xact_lock(4820914)`);
};
