import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { telemetryEventSchema } from '#core/domain/telemetry.js';
import type { TelemetryWriter, TelemetryReader, TelemetryStoreProbe, TelemetryErasure, TelemetryStore } from '#core/server/telemetry/ports.js';

import { createMongoTelemetryFactory } from './store.js';

let server: MongoMemoryServer;
let store: TelemetryStore;
const event = (id: string, type: 'opened' | 'clicked' | 'bounced' = 'opened', sendId = 'send') => telemetryEventSchema.parse({
  version: 1, id: `v1:${id}`, tenantId: 'tenant', campaignId: 'campaign', contactId: 'contact', memberId: null,
  sendId, sesMessageId: 'ses', occurredAt: '2026-09-13T10:00:00.000Z', ingestedAt: '2026-09-13T10:00:01.000Z', type,
  bounceClassification: null, complaintType: null, linkId: null, destination: null, trackingPolicyVersion: '1', activityType: null, orderId: null,
});
beforeAll(async () => {
  server = await MongoMemoryServer.create({ binary: { version: '8.0.19' }, instance: { ip: '127.0.0.1' } });
  store = createMongoTelemetryFactory({ localTesting: true }).open('tenant', server.getUri('telemetry_test'));
}, 120000);
afterAll(async () => { await store?.close('tenant'); await server?.stop(); });
describe('MongoDB telemetry', () => {
  it('probes round trip and required indexes', async () => { const probe: TelemetryStoreProbe = store; expect(await probe.probe('tenant')).toEqual({ ok: true, value: undefined }); });
  it('deduplicates replay without collapsing repeated engagement', async () => {
    const batch = [event('1'), event('2'), event('3', 'clicked'), event('4', 'opened', 'second'), event('5', 'bounced')];
    const writer: TelemetryWriter = store;
    await writer.appendBatch('tenant', batch);
    await store.appendBatch('tenant', batch);
    const reader: TelemetryReader = store;
    expect(await reader.campaignStats('tenant', ['campaign'])).toEqual([{ campaignId: 'campaign', totalOpens: 3, uniqueOpens: 2, totalClicks: 1, uniqueClicks: 1 }]);
    const first = await store.contactTimeline('tenant', 'contact', null, 2);
    const second = await store.contactTimeline('tenant', 'contact', first.nextCursor, 2);
    expect(new Set([...first.events, ...second.events].map((row) => row.id)).size).toBe(4);
    expect((await store.bounceComplaints('tenant', null, 10)).events).toHaveLength(1);
  });
  it('rejects mismatched tenant inputs', async () => {
    await expect(store.appendBatch('other', [event('6')])).rejects.toThrow('tenant mismatch');
    await expect(store.appendBatch('tenant', [{ ...event('6'), tenantId: 'other' }])).rejects.toThrow('tenant mismatch');
    await expect(store.contactTimeline('other', 'contact', null, 10)).rejects.toThrow('tenant mismatch');
  });
  it('verifies erasure of events and summaries', async () => {
    const erasure: TelemetryErasure = store;
    await erasure.deleteSubject('tenant', 'contact');
    expect((await store.contactTimeline('tenant', 'contact', null, 10)).events).toEqual([]);
    expect((await store.campaignStats('tenant', ['campaign']))[0]?.totalOpens).toBe(0);
  });
});
