import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';

import { createEmailHmac } from '#adapters/crypto/email-hmac.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { emailEvents, emailOutbox, erasedMemberImports, members, tenants } from '#adapters/db/schema.js';

const execute = promisify(execFile);
const key = Buffer.alloc(32, 7).toString('base64');
const now = '2026-11-01T12:00:00.000Z';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  database = await createTestDatabase('together_email_repair_cli', 'postgres://together:together@localhost:48912/postgres');
  const db = database.db;
  await db.insert(tenants).values({ id: 'repair', slug: 'repair', name: 'Example', createdAt: now });
  await db.insert(members).values({ id: 'member', tenantId: 'repair', userId: 'deleted:member', email: 'deleted-member@anonymized.invalid', deletedAt: now, createdAt: now });
  await db.insert(erasedMemberImports).values({ memberId: 'member', tenantId: 'repair', emailHmac: createEmailHmac(key).compute('repair', 'private@example.test'), erasedAt: now });
  await db.insert(emailOutbox).values({ id: 'outbox', tenantId: 'repair', kind: 'verify-email', to: 'private@example.test', payload: {}, status: 'sent', nextAttemptAt: now, createdAt: now });
  await db.insert(emailEvents).values({ id: 'event', tenantId: 'repair', mailKind: 'transactional', refId: 'outbox', type: 'complained', occurredAt: now, createdAt: now,
    meta: { rawProviderPayload: { complaint: { timestamp: now, complaintFeedbackType: 'abuse', complainedRecipients: [{ emailAddress: 'private@example.test', displayName: 'Private Person' }] } } } });
}, 60000);
afterAll(async () => { await database?.close(); });

const run = async (apply: boolean) => {
  const result = await execute(process.execPath, ['--import', 'tsx', 'scripts/repair-erased-email-events.ts', '--tenant', 'repair', ...(apply ? ['--apply'] : [])], {
    env: { ...process.env, DATABASE_URL: database.url, SECRETS_MASTER_KEY: key },
  });
  return z.object({ tenantId: z.string(), mode: z.string(), matched: z.record(z.number()), changed: z.record(z.number()), unlinked: z.number() }).parse(JSON.parse(result.stdout));
};

it('runs dry by default and applies only when requested on a disposable local database', async () => {
  expect(await run(false)).toEqual({ tenantId: 'repair', mode: 'dry-run', matched: { complained: 1 }, changed: { complained: 1 }, unlinked: 0 });
  expect(JSON.stringify(await database.db.select().from(emailEvents))).toContain('Private Person');
  expect(await run(true)).toMatchObject({ mode: 'apply', changed: { complained: 1 } });
  const row = (await database.db.select().from(emailEvents)).find((event) => event.id === 'event');
  expect(row?.meta).toEqual({ rawProviderPayload: { complaint: { timestamp: now, complaintFeedbackType: 'abuse' } } });
  expect(await run(true)).toMatchObject({ mode: 'apply', changed: {} });
}, 60000);
