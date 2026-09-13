import type { TelemetryCheckpoint } from '#core/server/telemetry/ports.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

import { TELEMETRY_LIMITS, telemetryEventSchema } from '#core/domain/telemetry.js';

import type { Db } from './client.js';
import { createTestDatabase } from './test-database-name.js';
import { appendTelemetry, createTelemetryOutbox, createTelemetrySettingsRepository, eraseTelemetrySubject } from './telemetry-outbox.js';
import { telemetryAccounting, telemetryOutbox } from './telemetry-schema.js';

let db: Db;
let close: (() => Promise<void>) | undefined;
const at = '2026-09-13T10:00:00.000Z';
const event = (id: string, tenantId = 'tenant') => telemetryEventSchema.parse({ version: 1, id: `v1:${id}`, tenantId,
  campaignId: 'campaign', contactId: 'contact', memberId: null, sendId: 'send', sesMessageId: null,
  occurredAt: at, ingestedAt: at, type: 'opened', bounceClassification: null, complaintType: null,
  linkId: null, destination: null, trackingPolicyVersion: '1', activityType: null, orderId: null });
const connect = async (tenantId: string) => createTelemetrySettingsRepository(db).save(tenantId, { provider: 'mongodb', region: 'EU', connectedAt: at, lastProbeAt: at, lastProbeResult: 'ok', egressMode: 'unknown' });
beforeAll(async () => { const database = await createTestDatabase('together_telemetry', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together'); db = database.db; close = database.close; });
afterAll(async () => { await close?.(); });
describe('transactional telemetry outbox', () => {
  it('ignores disconnected tenants and rolls back with the operational transaction', async () => {
    await db.transaction((tx) => appendTelemetry(tx, event('disconnected')));
    expect(await createTelemetryOutbox(db).pending('tenant', at, 100)).toEqual([]);
    await connect('tenant');
    await expect(db.transaction(async (tx) => { await appendTelemetry(tx, event('rolled-back')); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect((await createTelemetryOutbox(db).status('tenant', at)).pendingBytes).toBe(0);
  });
  it('accounts concurrent admission, acknowledges idempotently and honors retry order', async () => {
    await Promise.all([1, 2, 3].map((id) => db.transaction((tx) => appendTelemetry(tx, event(String(id))))));
    await db.transaction((tx) => appendTelemetry(tx, event('1')));
    const outbox = createTelemetryOutbox(db);
    const batch = await outbox.pending('tenant', at, 100);
    expect(batch).toHaveLength(3);
    const last = batch.at(-1);
    if (last === undefined) throw new Error('Missing batch');
    await outbox.retry('tenant', last.sequence, '2026-09-13T11:00:00.000Z');
    expect(await outbox.pending('tenant', at, 100)).toEqual([]);
    const checkpoint: TelemetryCheckpoint = outbox;
    await checkpoint.acknowledge('tenant', last.sequence, at);
    await outbox.acknowledge('tenant', last.sequence, at);
    expect((await outbox.status('tenant', at)).pendingBytes).toBe(0);
  });
  it('coalesces hard-cap drops in one bounded ledger row', async () => {
    await db.update(telemetryAccounting).set({ pendingBytes: TELEMETRY_LIMITS.tenantBytes }).where(eq(telemetryAccounting.tenantId, 'tenant'));
    await Promise.all([4, 5].map((id) => db.transaction((tx) => appendTelemetry(tx, event(String(id))))));
    expect(await createTelemetryOutbox(db).status('tenant', at)).toMatchObject({ pendingBytes: TELEMETRY_LIMITS.tenantBytes, gapCount: 2, admissionPaused: true });
    const [size] = await db.select({ bytes: sql<number>`pg_column_size(${telemetryAccounting})` }).from(telemetryAccounting);
    expect(size?.bytes).toBeLessThan(TELEMETRY_LIMITS.gapLedgerBytes);
    expect(await db.select().from(telemetryOutbox)).toEqual([]);
  });
  it('applies the global cap across tenants', async () => {
    await connect('second');
    await db.update(telemetryAccounting).set({ pendingBytes: TELEMETRY_LIMITS.globalBytes }).where(eq(telemetryAccounting.tenantId, 'tenant'));
    await db.transaction((tx) => appendTelemetry(tx, event('global', 'second')));
    expect(await createTelemetryOutbox(db).status('second', at)).toMatchObject({ pendingBytes: 0, gapCount: 1, admissionPaused: true });
  });
  it('keeps the headroom above the admission threshold for late feedback', async () => {
    await db.update(telemetryAccounting).set({ pendingBytes: 0 }).where(eq(telemetryAccounting.tenantId, 'second'));
    await db.update(telemetryAccounting).set({ pendingBytes: TELEMETRY_LIMITS.tenantAdmissionBytes }).where(eq(telemetryAccounting.tenantId, 'tenant'));
    await db.transaction((tx) => appendTelemetry(tx, event('paused-open')));
    expect(await createTelemetryOutbox(db).pending('tenant', at, 100)).toEqual([]);
    await db.transaction((tx) => appendTelemetry(tx, { ...event('late-bounce'), type: 'bounced' }));
    expect((await createTelemetryOutbox(db).pending('tenant', at, 100)).map((row) => row.event.type)).toEqual(['bounced']);
  });
  it('releases pending rows and their reservation on disconnect', async () => {
    const outbox = createTelemetryOutbox(db);
    await outbox.discard('tenant');
    expect(await outbox.pending('tenant', at, 100)).toEqual([]);
    expect(await outbox.status('tenant', at)).toMatchObject({ pendingBytes: 0, admissionPaused: false });
  });
  it('drops queued rows for an erased subject', async () => {
    await db.transaction((tx) => appendTelemetry(tx, event('erased')));
    expect((await createTelemetryOutbox(db).status('tenant', at)).pendingBytes).toBeGreaterThan(0);
    await db.transaction((tx) => eraseTelemetrySubject(tx, 'tenant', { contactIds: ['contact'], memberIds: [] }));
    expect(await createTelemetryOutbox(db).pending('tenant', at, 100)).toEqual([]);
    expect((await createTelemetryOutbox(db).status('tenant', at)).pendingBytes).toBe(0);
  });
});
