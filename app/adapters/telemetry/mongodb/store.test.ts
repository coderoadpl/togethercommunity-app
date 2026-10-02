import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';

import { telemetryEventSchema } from '#core/domain/telemetry.js';
import type { TelemetryWriter, TelemetryReader, TelemetryStoreProbe, TelemetryErasure, TelemetryStore } from '#core/server/telemetry/ports.js';

import { createMongoTelemetryFactory } from './store.js';

const connectionString = process.env['MONGODB_TEST_URL'];
const tenantId = `telemetry-test-${randomUUID()}`;
const event = (id: string, type: 'opened' | 'clicked' | 'bounced' = 'opened', sendId = 'send') => telemetryEventSchema.parse({
  version: 1, id: `v1:${id}`, tenantId, campaignId: 'campaign', contactId: 'contact', memberId: null,
  sendId, sesMessageId: 'ses', occurredAt: '2026-09-13T10:00:00.000Z', ingestedAt: '2026-09-13T10:00:01.000Z', type,
  bounceClassification: null, complaintType: null, linkId: null, destination: null, trackingPolicyVersion: '1', activityType: null, orderId: null,
});
describe.skipIf(!connectionString)('MongoDB telemetry integration (requires MONGODB_TEST_URL)', () => {
  let store: TelemetryStore;
  beforeAll(() => {
    if (!connectionString) throw new Error('Set MONGODB_TEST_URL to run MongoDB integration tests');
    store = createMongoTelemetryFactory({ localTesting: true }).open(tenantId, connectionString);
  });
  afterAll(async () => {
    if (!store) return;
    try {
      await store.deleteSubject(tenantId, 'contact');
    } finally {
      await store.close(tenantId);
    }
  });
  it('probes round trip and required indexes', async () => {
    const probe: TelemetryStoreProbe = store;
    expect(await probe.probe(tenantId)).toEqual({ ok: true, value: undefined });
    const client = new MongoClient(connectionString ?? '');
    try {
      expect(await client.db().collection('telemetry_probe').countDocuments({ tenantId })).toBe(0);
    } finally {
      await client.close();
    }
  });
  it('deduplicates replay without collapsing repeated engagement', async () => {
    const batch = [event('1'), event('2'), event('3', 'clicked'), event('4', 'opened', 'second'), event('5', 'bounced')];
    const writer: TelemetryWriter = store;
    await writer.appendBatch(tenantId, batch);
    await store.appendBatch(tenantId, batch);
    const reader: TelemetryReader = store;
    expect(await reader.campaignStats(tenantId, ['campaign'])).toEqual([{ campaignId: 'campaign', totalOpens: 3, uniqueOpens: 2, totalClicks: 1, uniqueClicks: 1 }]);
    const first = await store.contactTimeline(tenantId, 'contact', null, 2);
    const second = await store.contactTimeline(tenantId, 'contact', first.nextCursor, 2);
    expect(new Set([...first.events, ...second.events].map((row) => row.id)).size).toBe(4);
    expect((await store.bounceComplaints(tenantId, null, 10)).events).toHaveLength(1);
  });
  it('rejects mismatched tenant inputs', async () => {
    await expect(store.appendBatch('other', [event('6')])).rejects.toThrow('tenant mismatch');
    await expect(store.appendBatch(tenantId, [{ ...event('6'), tenantId: 'other' }])).rejects.toThrow('tenant mismatch');
    await expect(store.contactTimeline('other', 'contact', null, 10)).rejects.toThrow('tenant mismatch');
  });
  it('verifies erasure of events and summaries', async () => {
    const erasure: TelemetryErasure = store;
    await erasure.deleteSubject(tenantId, 'contact');
    expect((await store.contactTimeline(tenantId, 'contact', null, 10)).events).toEqual([]);
    expect((await store.campaignStats(tenantId, ['campaign']))[0]?.totalOpens).toBe(0);
  });
});
