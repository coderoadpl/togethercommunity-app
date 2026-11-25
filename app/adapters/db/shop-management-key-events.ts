import { and, desc, eq, lt, or } from 'drizzle-orm';

import { shopManagementKeyEventSchema, type ShopManagementKeyEvent } from '#core/domain/index.js';
import type { ShopManagementKeyEventRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { lockSmokeFixture } from './smoke-fixture-lock.js';
import { shopManagementKeyEvents } from './schema.js';

const parseEvent = (event: ShopManagementKeyEvent): ShopManagementKeyEvent => shopManagementKeyEventSchema.parse(event);

export const insertShopManagementKeyEvent = async (
  executor: Db,
  tenantId: string,
  event: ShopManagementKeyEvent,
): Promise<void> => {
  const parsed = parseEvent(event);
  if (parsed.tenantId !== tenantId) throw new Error('Shop management key event belongs to another tenant');
  await executor.insert(shopManagementKeyEvents).values(parsed);
};

export const createShopManagementKeyEventRepository = (db: Db): ShopManagementKeyEventRepository => ({
  record: (tenantId, event) => db.transaction(async (tx) => {
    await lockSmokeFixture(tx, tenantId);
    await insertShopManagementKeyEvent(tx, tenantId, event);
  }),
  list: async (tenantId, query) => {
    const scope = and(
      eq(shopManagementKeyEvents.tenantId, tenantId),
      ...(query.apiKeyId === undefined ? [] : [eq(shopManagementKeyEvents.apiKeyId, query.apiKeyId)]),
    );
    const boundary = query.cursor === undefined
      ? undefined
      : (await db
          .select({ id: shopManagementKeyEvents.id, at: shopManagementKeyEvents.at })
          .from(shopManagementKeyEvents)
          .where(and(scope, eq(shopManagementKeyEvents.id, query.cursor)))
          .limit(1))[0] ?? null;
    if (boundary === null) return { events: [], nextCursor: null };
    const rows = await db
      .select()
      .from(shopManagementKeyEvents)
      .where(and(
        scope,
        ...(boundary === undefined ? [] : [or(
          lt(shopManagementKeyEvents.at, boundary.at),
          and(eq(shopManagementKeyEvents.at, boundary.at), lt(shopManagementKeyEvents.id, boundary.id)),
        )]),
      ))
      .orderBy(desc(shopManagementKeyEvents.at), desc(shopManagementKeyEvents.id))
      .limit(query.limit + 1);
    const events = rows.slice(0, query.limit).map(parseEvent);
    return { events, nextCursor: rows.length > query.limit ? events.at(-1)?.id ?? null : null };
  },
});
