import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';

import { orderFeedEpoch } from '#adapters/db/order-change-schema.js';
import { createOrderChangeRepository } from '#adapters/db/order-changes.js';
import { tenants } from '#adapters/db/schema.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';

const execute = promisify(execFile);
let database: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  database = await createTestDatabase('together_feed_epoch_cli', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  await database.db.insert(tenants).values({ id: 'workspace', slug: 'workspace', name: 'Example', createdAt: '2026-11-16T12:00:00.000Z' });
}, 60_000);
afterAll(async () => { await database?.close(); });

const storedEpoch = async (): Promise<string | undefined> =>
  (await database.db.select({ epoch: orderFeedEpoch.epoch }).from(orderFeedEpoch))[0]?.epoch;

it('rotates the feed epoch, prints the new one and answers a cursor of the old one with a reset', async () => {
  const before = await storedEpoch();
  const result = await execute(process.execPath, ['--import', 'tsx', 'scripts/rotate-order-feed-epoch.ts'], {
    env: { ...process.env, DATABASE_URL: database.url },
  });
  const { epoch } = z.object({ epoch: z.string().regex(/^[0-9a-f]{32}$/) }).parse(JSON.parse(result.stdout));
  expect(epoch).not.toBe(before);
  expect(await storedEpoch()).toBe(epoch);
  expect(await createOrderChangeRepository(database.db).listOrderChanges('workspace', { after: `${before ?? ''}.5.1`, limit: 10 }))
    .toEqual({ kind: 'reset', cursor: `${epoch}.0.0` });
}, 60_000);
