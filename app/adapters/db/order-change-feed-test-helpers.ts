import { eq, sql } from 'drizzle-orm';

import type { Db } from './client.js';
import { orderChanges } from './order-change-schema.js';

const SETTLE_DEADLINE_MS = 15_000;
const SETTLE_POLL_MS = 25;

// The feed hides changes newer than the oldest open transaction on the whole server, so another test database's open transaction can hold a just-committed change back.
export const waitForSettledOrderChanges = async (db: Db, tenantId: string): Promise<void> => {
  const deadline = Date.now() + SETTLE_DEADLINE_MS;
  for (;;) {
    const [row] = await db
      .select({ settled: sql<boolean>`coalesce(bool_and(${orderChanges.xactId} < pg_snapshot_xmin(pg_current_snapshot())), true)` })
      .from(orderChanges)
      .where(eq(orderChanges.tenantId, tenantId));
    if (row?.settled === true) return;
    if (Date.now() >= deadline) throw new Error(`The order changes of ${tenantId} did not settle within ${String(SETTLE_DEADLINE_MS)} ms`);
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
};
