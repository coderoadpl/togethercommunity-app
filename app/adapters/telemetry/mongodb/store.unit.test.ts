import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { telemetryEventSchema } from '#core/domain/telemetry.js';
import type { TelemetryStore } from '#core/server/telemetry/ports.js';

import { createMongoTelemetryFactory } from './store.js';

const driver = vi.hoisted(() => {
  const cursor = {
    sort: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    maxTimeMS: vi.fn().mockReturnThis(), toArray: vi.fn(),
  };
  return {
    cursor,
    events: { bulkWrite: vi.fn(), aggregate: vi.fn(() => cursor), find: vi.fn(() => cursor) },
    sends: { updateOne: vi.fn() },
    connect: vi.fn(() => { throw new Error('Unit tests must not connect to MongoDB'); }),
  };
});
vi.mock('mongodb', () => ({
  MongoClient: class {
    connect = driver.connect;
    db() {
      return { collection: (name: string) => name === 'events' ? driver.events : driver.sends };
    }
    async close() {}
  },
}));

const event = (id: string, overrides: Record<string, unknown> = {}) => telemetryEventSchema.parse({
  version: 1, id: `v1:${id}`, tenantId: 'tenant', campaignId: 'campaign', contactId: 'contact', memberId: null,
  sendId: 'send', sesMessageId: 'ses', occurredAt: '2026-09-13T10:00:00.000Z', ingestedAt: '2026-09-13T10:00:01.000Z', type: 'opened',
  bounceClassification: null, complaintType: null, linkId: null, destination: null, trackingPolicyVersion: '1', activityType: null, orderId: null,
  ...overrides,
});
let store: TelemetryStore;
beforeEach(() => {
  vi.clearAllMocks();
  driver.cursor.toArray.mockResolvedValue([]);
  store = createMongoTelemetryFactory({ localTesting: true }).open('tenant', 'mongodb://127.0.0.1/telemetry_test');
});
afterEach(async () => {
  expect(driver.connect).not.toHaveBeenCalled();
  await store.close('tenant');
});

describe('MongoDB telemetry planning without a server', () => {
  it('plans replay-safe event inserts without collapsing repeated engagement', async () => {
    const batch = [event('1'), event('2')];
    await store.appendBatch('tenant', batch);
    await store.appendBatch('tenant', batch);
    const operations = batch.map((row) => ({ updateOne: {
      filter: { _id: JSON.stringify(['tenant', row.id]), tenantId: 'tenant' },
      update: { $setOnInsert: { ...row, _id: JSON.stringify(['tenant', row.id]) } }, upsert: true,
    } }));
    expect(driver.events.bulkWrite.mock.calls).toEqual([
      [operations, { ordered: true }], [operations, { ordered: true }],
    ]);
  });

  it('keeps send engagement monotonic and skips events without a send', async () => {
    await store.appendBatch('tenant', [event('1'), event('2', { type: 'clicked' }), event('3', { type: 'bounced' }), event('4', { sendId: null })]);
    expect(driver.sends.updateOne.mock.calls).toEqual([
      { opened: true, clicked: false }, { opened: false, clicked: true }, { opened: false, clicked: false },
    ].map((flags) => [
      { _id: JSON.stringify(['tenant', 'send']), tenantId: 'tenant' },
      { $set: { tenantId: 'tenant', sendId: 'send', contactId: 'contact', campaignId: 'campaign' }, $max: flags },
      { upsert: true },
    ]));
  });

  it('rejects tenant mismatches and invalid events before any write', async () => {
    await expect(store.appendBatch('other', [event('1')])).rejects.toThrow('tenant mismatch');
    await expect(store.appendBatch('tenant', [event('1'), event('2', { tenantId: 'other' })])).rejects.toThrow('tenant mismatch');
    await expect(store.appendBatch('tenant', [{ ...event('1'), id: '' }])).rejects.toThrow();
    await store.appendBatch('tenant', []);
    expect(driver.events.bulkWrite).not.toHaveBeenCalled();
    expect(driver.sends.updateOne).not.toHaveBeenCalled();
  });

  it('aggregates per campaign and send before counting distinct engagement', async () => {
    const stats = { campaignId: 'campaign', totalOpens: 3, totalClicks: 1, uniqueOpens: 2, uniqueClicks: 1 };
    driver.cursor.toArray.mockResolvedValue([{ ...stats, _id: 'discard' }]);
    expect(await store.campaignStats('tenant', ['missing', 'campaign'])).toEqual([
      { campaignId: 'missing', totalOpens: 0, totalClicks: 0, uniqueOpens: 0, uniqueClicks: 0 }, stats,
    ]);
    expect(driver.events.aggregate).toHaveBeenCalledWith([
      { $match: { tenantId: 'tenant', campaignId: { $in: ['missing', 'campaign'] }, type: { $in: ['opened', 'clicked'] }, sendId: { $ne: null } } },
      { $group: { _id: { campaignId: '$campaignId', sendId: '$sendId' }, opens: { $sum: { $cond: [{ $eq: ['$type', 'opened'] }, 1, 0] } }, clicks: { $sum: { $cond: [{ $eq: ['$type', 'clicked'] }, 1, 0] } } } },
      { $group: { _id: '$_id.campaignId', totalOpens: { $sum: '$opens' }, totalClicks: { $sum: '$clicks' }, uniqueOpens: { $sum: { $cond: [{ $gt: ['$opens', 0] }, 1, 0] } }, uniqueClicks: { $sum: { $cond: [{ $gt: ['$clicks', 0] }, 1, 0] } } } },
      { $project: { _id: 0, campaignId: '$_id', totalOpens: 1, totalClicks: 1, uniqueOpens: 1, uniqueClicks: 1 } },
    ], { maxTimeMS: 3000, allowDiskUse: false });
  });

  it('bounds campaign queries and validates aggregate documents', async () => {
    expect(await store.campaignStats('tenant', [])).toEqual([]);
    await expect(store.campaignStats('tenant', Array.from({ length: 101 }, () => 'campaign'))).rejects.toThrow('Too many campaign identifiers');
    await expect(store.campaignStats('other', ['campaign'])).rejects.toThrow('tenant mismatch');
    expect(driver.events.aggregate).not.toHaveBeenCalled();
    driver.cursor.toArray.mockResolvedValue([{ campaignId: 'campaign', totalOpens: 'invalid' }]);
    await expect(store.campaignStats('tenant', ['campaign'])).rejects.toThrow();
  });

  it('maps documents to events and builds a stable keyset cursor', async () => {
    const first = event('3');
    const last = event('2');
    driver.cursor.toArray.mockResolvedValue([first, last, event('1')].map((row) => ({ ...row, _id: row.id, extra: 'discard' })));
    const cursor = Buffer.from(JSON.stringify({ occurredAt: last.occurredAt, id: last.id })).toString('base64url');
    expect(await store.contactTimeline('tenant', 'contact', null, 2)).toEqual({ events: [first, last], nextCursor: cursor });
    expect(driver.events.find).toHaveBeenLastCalledWith({ $and: [{ tenantId: 'tenant' }, { contactId: 'contact' }, {}] });
    expect(driver.cursor.sort).toHaveBeenCalledWith({ occurredAt: -1, id: -1 });
    expect(driver.cursor.limit).toHaveBeenCalledWith(3);
    expect(driver.cursor.maxTimeMS).toHaveBeenCalledWith(3000);
    driver.cursor.toArray.mockResolvedValue([event('1')]);
    expect(await store.contactTimeline('tenant', 'contact', cursor, 2)).toEqual({ events: [event('1')], nextCursor: null });
    expect(driver.events.find).toHaveBeenLastCalledWith({ $and: [{ tenantId: 'tenant' }, { contactId: 'contact' }, {
      $or: [{ occurredAt: { $lt: last.occurredAt } }, { occurredAt: last.occurredAt, id: { $lt: last.id } }],
    }] });
  });

  it('bounds feedback pages and scopes their filter to the tenant', async () => {
    expect(await store.bounceComplaints('tenant', null, 200)).toEqual({ events: [], nextCursor: null });
    expect(driver.events.find).toHaveBeenCalledWith({ $and: [{ tenantId: 'tenant' }, { type: { $in: ['bounced', 'complained'] } }, {}] });
    expect(driver.cursor.limit).toHaveBeenLastCalledWith(101);
    await store.contactTimeline('tenant', 'contact', null, 0);
    expect(driver.cursor.limit).toHaveBeenLastCalledWith(2);
  });

  it('rejects mismatched tenants, invalid cursors and invalid returned documents', async () => {
    await expect(store.contactTimeline('other', 'contact', null, 10)).rejects.toThrow('tenant mismatch');
    await expect(store.contactTimeline('tenant', 'contact', Buffer.from('{}').toString('base64url'), 10)).rejects.toThrow();
    expect(driver.events.find).not.toHaveBeenCalled();
    driver.cursor.toArray.mockResolvedValue([{ ...event('1'), occurredAt: 'invalid' }]);
    await expect(store.contactTimeline('tenant', 'contact', null, 10)).rejects.toThrow();
  });
});
