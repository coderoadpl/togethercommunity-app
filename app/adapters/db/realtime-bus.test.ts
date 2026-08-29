import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { RealtimeEvent, RealtimeNotificationEvent } from '#core/server/index.js';

import type { Db } from './client.js';
import {
  createPgRealtimeBus,
  isPooledConnectionString,
  parseRealtimeEvent,
  realtimeChannel,
  REALTIME_APPLICATION_NAME,
  type PgRealtimeBus,
} from './realtime-bus.js';
import { createTestDatabase } from './test-database-name.js';

const baseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';

let db: Db;
let testUrl: string;
let closeTestDatabase: () => Promise<void>;
const buses: PgRealtimeBus[] = [];

const bus = (idleCloseMs = 60_000): PgRealtimeBus => {
  const created = createPgRealtimeBus({ db, connectionString: testUrl, idleCloseMs });
  buses.push(created);
  return created;
};

const notificationEvent = (
  overrides: Partial<RealtimeNotificationEvent> = {},
): RealtimeNotificationEvent => ({
  kind: 'notification',
  tenantId: TENANT,
  recipientUserId: 'u1',
  notificationId: 'n1',
  createdAt: '2026-07-15T10:00:00.000Z',
  ...overrides,
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const waitFor = async (ready: () => Promise<boolean> | boolean): Promise<void> => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await sleep(25);
  }
  throw new Error('condition was not met before the timeout');
};

const countOf = (result: unknown): number => {
  if (typeof result !== 'object' || result === null || !('rows' in result) || !Array.isArray(result.rows)) {
    throw new Error('connection count query did not return rows');
  }
  const row: unknown = result.rows[0];
  if (typeof row !== 'object' || row === null || !('value' in row) || typeof row.value !== 'number') {
    throw new Error('connection count query did not return a count');
  }
  return row.value;
};

const listenConnections = async (): Promise<number> =>
  countOf(
    await db.execute(
      sql`select count(*)::int as value from pg_stat_activity
          where datname = current_database() and application_name = ${REALTIME_APPLICATION_NAME}`,
    ),
  );

beforeAll(async () => {
  const testDatabase = await createTestDatabase('together_realtime_bus_test', baseUrl);
  db = testDatabase.db;
  testUrl = testDatabase.url;
  closeTestDatabase = testDatabase.close;
}, 60_000);

afterEach(async () => {
  for (const created of buses.splice(0)) await created.close();
  await waitFor(async () => (await listenConnections()) === 0);
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('realtime channel', () => {
  it('scopes the channel to the tenant and stays a legal identifier', () => {
    const channel = realtimeChannel('7f1c9b0e-1c1a-4a41-9a58-0b9d1f2e3a4b');

    expect(channel).toBe('together_realtime_7f1c9b0e_1c1a_4a41_9a58_0b9d1f2e3a4b');
    expect(realtimeChannel(TENANT)).not.toBe(realtimeChannel(OTHER_TENANT));
    expect(realtimeChannel('x'.repeat(200)).length).toBe(63);
  });
});

describe('realtime payload parsing', () => {
  it('accepts identifier-only events', () => {
    expect(parseRealtimeEvent(JSON.stringify(notificationEvent()))).toEqual(notificationEvent());
  });

  it('rejects malformed payloads', () => {
    expect(parseRealtimeEvent('not json')).toBeNull();
    expect(parseRealtimeEvent('[]')).toBeNull();
    expect(parseRealtimeEvent(JSON.stringify({ kind: 'unknown', tenantId: TENANT }))).toBeNull();
    expect(
      parseRealtimeEvent(
        JSON.stringify({ ...notificationEvent(), notificationId: undefined }),
      ),
    ).toBeNull();
    expect(
      parseRealtimeEvent(JSON.stringify({ ...notificationEvent(), tenantId: 42 })),
    ).toBeNull();
  });
});

describe('pooled connection detection', () => {
  it('recognises pooler hosts and ports and tolerates unparseable strings', () => {
    expect(isPooledConnectionString('postgres://u:p@ep-cool-db-pooler.eu.aws.neon.tech/main')).toBe(true);
    expect(
      isPooledConnectionString('postgres://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres'),
    ).toBe(true);
    expect(isPooledConnectionString('postgres://u:p@pgbouncer.internal:6432/main')).toBe(true);
    expect(isPooledConnectionString('postgres://u:p@ep-cool-db.eu.aws.neon.tech/main')).toBe(false);
    expect(isPooledConnectionString('postgres://u:p@db.internal:5432/main')).toBe(false);
    expect(isPooledConnectionString('not a url')).toBe(false);
  });

  it('warns when the listener is pointed at a pooled host', () => {
    const warnings: string[] = [];
    const created = createPgRealtimeBus({
      db,
      connectionString: 'postgres://u:p@ep-cool-db-pooler.eu.aws.neon.tech/main',
      onWarning: (message) => warnings.push(message),
    });
    buses.push(created);

    expect(warnings).toEqual([
      'listener connection targets a pooled host; LISTEN requires a direct connection',
    ]);
  });
});

describe('postgres realtime bus', () => {
  it('drops an oversized payload instead of attempting the notify', async () => {
    const errors: Error[] = [];
    const created = createPgRealtimeBus({
      db,
      connectionString: testUrl,
      onError: (error) => errors.push(error),
    });
    buses.push(created);

    created.publish(notificationEvent({ notificationId: 'n'.repeat(8_000) }));
    await sleep(50);

    expect(errors.map((error) => error.message)).toEqual([
      'realtime payload exceeds 7900 bytes',
    ]);
  });

  it('delivers events published by another instance to the scoped subscriber', async () => {
    const publisher = bus();
    const subscriber = bus();
    const received: RealtimeEvent[] = [];
    const unsubscribe = subscriber.subscribe({ tenantId: TENANT, recipientUserId: 'u1' }, (event) => {
      received.push(event);
    });
    await waitFor(async () => (await listenConnections()) >= 1);

    publisher.publish(notificationEvent());

    await waitFor(() => received.length === 1);
    expect(received).toEqual([notificationEvent()]);
    unsubscribe();
  });

  it('does not deliver across tenants or recipients', async () => {
    const publisher = bus();
    const subscriber = bus();
    const received: RealtimeEvent[] = [];
    const mine: RealtimeEvent[] = [];
    const unsubscribeOtherRecipient = subscriber.subscribe(
      { tenantId: TENANT, recipientUserId: 'u2' },
      (event) => received.push(event),
    );
    const unsubscribeOtherTenant = subscriber.subscribe(
      { tenantId: OTHER_TENANT, recipientUserId: 'u1' },
      (event) => received.push(event),
    );
    const unsubscribeMine = subscriber.subscribe(
      { tenantId: TENANT, recipientUserId: 'u1' },
      (event) => mine.push(event),
    );
    await waitFor(async () => (await listenConnections()) >= 1);

    publisher.publish(notificationEvent({ notificationId: 'n-scoped' }));

    await waitFor(() => mine.length === 1);
    expect(received).toEqual([]);
    unsubscribeOtherRecipient();
    unsubscribeOtherTenant();
    unsubscribeMine();
  });

  it('stops delivering after unsubscribe and closes the idle connection', async () => {
    const publisher = bus();
    const subscriber = bus(20);
    const received: RealtimeEvent[] = [];
    const unsubscribe = subscriber.subscribe({ tenantId: TENANT, recipientUserId: 'u1' }, (event) => {
      received.push(event);
    });
    await waitFor(async () => (await listenConnections()) >= 1);

    unsubscribe();
    await waitFor(async () => (await listenConnections()) === 0);
    publisher.publish(notificationEvent({ notificationId: 'n-after-unsubscribe' }));
    await sleep(200);

    expect(received).toEqual([]);
  });

  it('reconnects and resumes delivery when the listening connection is dropped', async () => {
    const publisher = bus();
    const subscriber = bus();
    const received: RealtimeEvent[] = [];
    const unsubscribe = subscriber.subscribe({ tenantId: TENANT, recipientUserId: 'u1' }, (event) => {
      received.push(event);
    });
    await waitFor(async () => (await listenConnections()) >= 1);

    await db.execute(
      sql`select pg_terminate_backend(pid) from pg_stat_activity
          where datname = current_database() and application_name = ${REALTIME_APPLICATION_NAME}`,
    );
    await waitFor(async () => (await listenConnections()) === 0);

    await waitFor(async () => {
      publisher.publish(notificationEvent({ notificationId: 'n-after-reconnect' }));
      await sleep(100);
      return received.length > 0;
    });
    expect(received.at(-1)).toEqual(notificationEvent({ notificationId: 'n-after-reconnect' }));
    unsubscribe();
  });
});
