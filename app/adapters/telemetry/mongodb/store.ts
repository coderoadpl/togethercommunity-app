import { randomUUID } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { MongoClient, type Filter } from 'mongodb';

import { err, ok, validation } from '#core/domain/index.js';
import { privateNetworkAddress, privateNetworkHostname } from '#core/domain/network.js';
import { telemetryPageSchema, telemetryCampaignStatsSchema, telemetryEventSchema, type TelemetryEvent } from '#core/domain/telemetry.js';
import type { TelemetryStore, TelemetryStoreFactory } from '#core/server/telemetry/ports.js';

type EventDocument = TelemetryEvent & { _id: string };
const indexes = [
  { key: { tenantId: 1, campaignId: 1, type: 1, sendId: 1 }, name: 'campaign_engagement' },
  { key: { tenantId: 1, contactId: 1, occurredAt: -1, id: -1 }, name: 'contact_timeline' },
  { key: { tenantId: 1, type: 1, occurredAt: -1, id: -1 }, name: 'feedback_timeline' },
] as const;
// Anything outside this list reaches the driver unreviewed, including proxy and topology switches the client options do not override.
const supportedOptions = new Set(['appname', 'authsource', 'readpreference', 'replicaset', 'retrywrites', 'w']);
const localHostnames = ['127.0.0.1', '::1', 'localhost'];
const DNS_TIMEOUT_MS = 5000;

const parseConnectionString = (connectionString: string) => {
  const parts = /^mongodb(?<srv>\+srv)?:\/\/(?<authority>[^/?#]+)(?<path>\/[^?#]*)?(?:\?(?<query>[^#]*))?$/u.exec(connectionString);
  const groups = parts?.groups;
  if (groups === undefined) throw new Error('Telemetry requires a MongoDB connection string');
  const authority = groups['authority'] ?? '';
  const separator = authority.lastIndexOf('@');
  const credentials = separator === -1 ? '' : authority.slice(0, separator);
  const hostnames = authority.slice(separator + 1).split(',').map((entry) => {
    const bracketed = /^\[(?<address>[^\]]+)\](?::\d+)?$/u.exec(entry)?.groups?.['address'];
    return { hostname: bracketed ?? entry.split(':')[0] ?? '', ported: bracketed === undefined ? entry.includes(':') : /\]:\d+$/u.test(entry) };
  });
  const database = (groups['path'] ?? '').slice(1);
  const [username = '', password = ''] = [credentials.slice(0, credentials.indexOf(':')), credentials.slice(credentials.indexOf(':') + 1)];
  if (database === '' || database.includes('/') || ['admin', 'local', 'config'].includes(database)) throw new Error('Telemetry requires a dedicated database');
  if (hostnames.some((host) => host.hostname === '')) throw new Error('Telemetry requires a MongoDB connection string');
  const srv = groups['srv'] !== undefined;
  if (srv && (hostnames.length !== 1 || hostnames[0]?.ported === true)) throw new Error('Telemetry requires a single seed host for a discovery connection string');
  const driverOptions = [...new URLSearchParams(groups['query'] ?? '').keys()].map((key) => key.toLowerCase());
  return { srv, hostnames: hostnames.map((host) => host.hostname), username, password, driverOptions };
};

const withDnsTimeout = async <T>(lookup: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([lookup, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new Error('Telemetry host lookup timed out')); }, DNS_TIMEOUT_MS);
    })]);
  } finally {
    clearTimeout(timer);
  }
};

const assertPublicHosts = async (uri: { srv: boolean; hostnames: string[] }): Promise<void> => {
  const seed = uri.hostnames[0] ?? '';
  const targets = uri.srv ? (await withDnsTimeout(dns.resolveSrv(`_mongodb._tcp.${seed}`))).map((record) => record.name) : uri.hostnames;
  if (targets.length === 0) throw new Error('Telemetry host could not be resolved');
  for (const target of targets) {
    if (privateNetworkHostname(target)) throw new Error('Telemetry rejects private MongoDB hosts');
    const addresses = isIP(target) === 0
      ? (await withDnsTimeout(dns.lookup(target, { all: true }))).map((entry) => entry.address)
      : [target];
    if (addresses.length === 0) throw new Error('Telemetry host could not be resolved');
    if (addresses.some((address) => isIP(address) === 0 || privateNetworkAddress(address))) throw new Error('Telemetry rejects private MongoDB hosts');
  }
};

export const createMongoTelemetryFactory = (options: { localTesting?: boolean } = {}): TelemetryStoreFactory => ({
  open: (boundTenantId, connectionString): TelemetryStore => {
    const uri = parseConnectionString(connectionString);
    const localTesting = options.localTesting === true && uri.hostnames.every((hostname) => localHostnames.includes(hostname));
    if (!localTesting && (uri.username === '' || uri.password === '')) throw new Error('Telemetry requires scoped credentials');
    if (!localTesting && uri.hostnames.some((hostname) => privateNetworkHostname(hostname))) throw new Error('Telemetry rejects private MongoDB hosts');
    if (!localTesting && uri.driverOptions.some((option) => !supportedOptions.has(option))) throw new Error('Telemetry rejects unsupported connection options');
    let resolved: Promise<void> | undefined;
    const client = new MongoClient(connectionString, {
      tls: !localTesting, tlsAllowInvalidCertificates: false, tlsAllowInvalidHostnames: false,
      maxPoolSize: 2, minPoolSize: 0, maxIdleTimeMS: 10000,
      serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000, socketTimeoutMS: 5000,
    });
    const database = client.db();
    const events = database.collection<EventDocument>('events');
    const sends = database.collection<{ _id: string; tenantId: string; contactId: string | null; sendId: string; campaignId: string | null; opened: boolean; clicked: boolean }>('sends');
    const scope = (tenantId: string) => {
      if (tenantId !== boundTenantId) throw new Error('Telemetry tenant mismatch');
      return tenantId;
    };
    const guard = async (tenantId: string) => {
      scope(tenantId);
      if (localTesting) return tenantId;
      resolved ??= assertPublicHosts(uri);
      await resolved;
      return tenantId;
    };
    const page = async (tenantId: string, filter: Filter<EventDocument>, cursor: string | null, limit: number) => {
      await guard(tenantId);
      const size = Math.max(1, Math.min(100, limit));
      let after: Filter<EventDocument> = {};
      if (cursor !== null) {
        const position = telemetryEventSchema.pick({ occurredAt: true, id: true }).parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
        after = { $or: [{ occurredAt: { $lt: position.occurredAt } }, { occurredAt: position.occurredAt, id: { $lt: position.id } }] };
      }
      const rows = await events.find({ $and: [{ tenantId: scope(tenantId) }, filter, after] }).sort({ occurredAt: -1, id: -1 }).limit(size + 1).maxTimeMS(3000).toArray();
      const selected = rows.slice(0, size).map((row) => telemetryEventSchema.parse(row));
      const last = selected.at(-1);
      return telemetryPageSchema.parse({ events: selected, nextCursor: rows.length > size && last !== undefined ? Buffer.from(JSON.stringify({ occurredAt: last.occurredAt, id: last.id })).toString('base64url') : null });
    };
    return {
      appendBatch: async (tenantId, batch) => {
        await guard(tenantId);
        const parsed = batch.map((event) => telemetryEventSchema.parse(event));
        if (parsed.some((event) => event.tenantId !== tenantId)) throw new Error('Telemetry tenant mismatch');
        if (parsed.length === 0) return;
        await events.bulkWrite(parsed.map((event) => ({ updateOne: {
          filter: { _id: JSON.stringify([tenantId, event.id]), tenantId }, update: { $setOnInsert: { ...event, _id: JSON.stringify([tenantId, event.id]) } }, upsert: true,
        } })), { ordered: true });
        for (const event of parsed) {
          if (event.sendId === null) continue;
          await sends.updateOne({ _id: JSON.stringify([tenantId, event.sendId]), tenantId }, {
            $set: { tenantId, sendId: event.sendId, contactId: event.contactId, campaignId: event.campaignId },
            $max: { opened: event.type === 'opened', clicked: event.type === 'clicked' },
          }, { upsert: true });
        }
      },
      campaignStats: async (tenantId, campaignIds) => {
        await guard(tenantId);
        if (campaignIds.length === 0) return [];
        if (campaignIds.length > 100) throw new Error('Too many campaign identifiers');
        const rows = await events.aggregate([
          { $match: { tenantId, campaignId: { $in: campaignIds }, type: { $in: ['opened', 'clicked'] }, sendId: { $ne: null } } },
          { $group: { _id: { campaignId: '$campaignId', sendId: '$sendId' }, opens: { $sum: { $cond: [{ $eq: ['$type', 'opened'] }, 1, 0] } }, clicks: { $sum: { $cond: [{ $eq: ['$type', 'clicked'] }, 1, 0] } } } },
          { $group: { _id: '$_id.campaignId', totalOpens: { $sum: '$opens' }, totalClicks: { $sum: '$clicks' }, uniqueOpens: { $sum: { $cond: [{ $gt: ['$opens', 0] }, 1, 0] } }, uniqueClicks: { $sum: { $cond: [{ $gt: ['$clicks', 0] }, 1, 0] } } } },
          { $project: { _id: 0, campaignId: '$_id', totalOpens: 1, totalClicks: 1, uniqueOpens: 1, uniqueClicks: 1 } },
        ], { maxTimeMS: 3000, allowDiskUse: false }).toArray();
        return campaignIds.map((campaignId) => telemetryCampaignStatsSchema.parse(rows.find((row) => row['campaignId'] === campaignId) ?? { campaignId, totalOpens: 0, totalClicks: 0, uniqueOpens: 0, uniqueClicks: 0 }));
      },
      contactTimeline: (tenantId, contactId, cursor, limit) => page(tenantId, { contactId }, cursor, limit),
      bounceComplaints: (tenantId, cursor, limit) => page(tenantId, { type: { $in: ['bounced', 'complained'] } }, cursor, limit),
      deleteSubject: async (tenantId, contactId) => {
        await guard(tenantId);
        await events.deleteMany({ tenantId, contactId });
        await sends.deleteMany({ tenantId, contactId });
        if (await events.countDocuments({ tenantId, contactId }) !== 0 || await sends.countDocuments({ tenantId, contactId }) !== 0) throw new Error('Telemetry erasure unverified');
      },
      probe: async (tenantId) => {
        const probes = database.collection<{ _id: string; tenantId: string }>('telemetry_probe');
        const id = randomUUID();
        try {
          await guard(tenantId);
          await client.connect();
          await events.createIndexes([...indexes]);
          await sends.createIndex({ tenantId: 1, contactId: 1 });
          await probes.insertOne({ _id: id, tenantId });
          if (await probes.findOne({ _id: id, tenantId }) === null) return err(validation('Telemetry probe failed'));
          if ((await probes.deleteOne({ _id: id, tenantId })).deletedCount !== 1) return err(validation('Telemetry probe failed'));
          const actual = await events.listIndexes().toArray();
          if (indexes.some((index) => !actual.some((entry) => entry.name === index.name && JSON.stringify(entry.key) === JSON.stringify(index.key)))) return err(validation('Telemetry index check failed'));
          return ok(undefined);
        } catch {
          return err(validation('Telemetry probe failed'));
        } finally {
          await probes.deleteOne({ _id: id, tenantId }).catch(() => undefined);
        }
      },
      close: (tenantId) => { scope(tenantId); return client.close(); },
    };
  },
});
