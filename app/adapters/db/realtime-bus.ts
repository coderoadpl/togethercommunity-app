import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import pg from 'pg';

import { createScopedSubscribers } from '#core/server/index.js';
import type { RealtimeBusPort, RealtimeEvent, ScopedSubscribers } from '#core/server/index.js';

const CHANNEL_PREFIX = 'together_realtime_';
export const REALTIME_APPLICATION_NAME = 'together-realtime';
const CHANNEL_NAME_LIMIT = 63;
/** `NOTIFY` rejects payloads at 8000 bytes, so oversized events are dropped instead of failing the write. */
const PAYLOAD_LIMIT_BYTES = 7_900;
const RECONNECT_BASE_MS = 500;
const RECONNECT_CAP_MS = 30_000;
const IDLE_CLOSE_MS = 60_000;
/** Every warm serverless instance holds its own direct connection, so idle listeners release fast. */
export const SERVERLESS_IDLE_CLOSE_MS = 10_000;
const POOLED_HOST_MARKER = 'pooler';
const POOLED_PORTS = new Set(['6543', '6432']);

export const isPooledConnectionString = (connectionString: string): boolean => {
  try {
    const url = new URL(connectionString);
    return url.hostname.includes(POOLED_HOST_MARKER) || POOLED_PORTS.has(url.port);
  } catch {
    return false;
  }
};

export const realtimeChannel = (tenantId: string): string =>
  `${CHANNEL_PREFIX}${tenantId.replaceAll(/[^a-zA-Z0-9]/gu, '_')}`.slice(0, CHANNEL_NAME_LIMIT);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

export const parseRealtimeEvent = (payload: string): RealtimeEvent | null => {
  let decoded: unknown = null;
  try {
    decoded = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!isRecord(decoded)) return null;
  const tenantId = text(decoded, 'tenantId');
  const recipientUserId = text(decoded, 'recipientUserId');
  const createdAt = text(decoded, 'createdAt');
  if (tenantId === null || recipientUserId === null || createdAt === null) return null;
  if (decoded['kind'] === 'notification') {
    const notificationId = text(decoded, 'notificationId');
    return notificationId === null
      ? null
      : { kind: 'notification', tenantId, recipientUserId, createdAt, notificationId };
  }
  if (decoded['kind'] === 'dm') {
    const conversationId = text(decoded, 'conversationId');
    return conversationId === null
      ? null
      : { kind: 'dm', tenantId, recipientUserId, createdAt, conversationId };
  }
  return null;
};

export interface PgRealtimeBus extends RealtimeBusPort {
  close(): Promise<void>;
}

export interface RealtimeNotifyDb {
  execute: (query: SQL) => PromiseLike<unknown>;
}

export interface PgRealtimeBusOptions {
  db: RealtimeNotifyDb;
  connectionString: string;
  onError?: (error: Error) => void;
  onWarning?: (message: string) => void;
  idleCloseMs?: number;
}

export const createPgRealtimeBus = (options: PgRealtimeBusOptions): PgRealtimeBus => {
  const channels = new Map<string, ScopedSubscribers>();
  const encoder = new TextEncoder();
  let client: pg.Client | null = null;
  let connecting = false;
  let reconnectDelayMs = RECONNECT_BASE_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  if (isPooledConnectionString(options.connectionString)) {
    options.onWarning?.(
      'listener connection targets a pooled host; LISTEN requires a direct connection',
    );
  }

  const report = (error: unknown): void => {
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
  };

  const dispatch = (channel: string, payload: string | undefined): void => {
    const subscribers = channels.get(channel);
    if (subscribers === undefined || payload === undefined) return;
    const event = parseRealtimeEvent(payload);
    if (event === null) return;
    subscribers.deliver(event);
  };

  const dropConnection = (lost: pg.Client): void => {
    if (client !== lost) return;
    client = null;
    lost.removeAllListeners();
    void lost.end().catch(report);
    scheduleReconnect();
  };

  const scheduleReconnect = (): void => {
    if (reconnectTimer !== null || channels.size === 0) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, reconnectDelayMs);
    reconnectTimer.unref();
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_CAP_MS);
  };

  const connect = async (): Promise<void> => {
    if (client !== null || connecting || channels.size === 0) return;
    connecting = true;
    const next = new pg.Client({
      connectionString: options.connectionString,
      application_name: REALTIME_APPLICATION_NAME,
    });
    next.on('error', (error) => {
      report(error);
      dropConnection(next);
    });
    next.on('end', () => {
      dropConnection(next);
    });
    next.on('notification', (message) => {
      dispatch(message.channel, message.payload);
    });
    try {
      await next.connect();
      if (channels.size === 0) {
        next.removeAllListeners();
        await next.end();
        return;
      }
      client = next;
      reconnectDelayMs = RECONNECT_BASE_MS;
      await Promise.all(
        [...channels.keys()].map((channel) => next.query(`LISTEN ${pg.escapeIdentifier(channel)}`)),
      );
    } catch (error) {
      report(error);
      if (client === next) client = null;
      next.removeAllListeners();
      void next.end().catch(() => undefined);
      scheduleReconnect();
    } finally {
      connecting = false;
    }
  };

  const closeIdleConnection = (): void => {
    if (channels.size > 0) return;
    const current = client;
    client = null;
    if (current === null) return;
    current.removeAllListeners();
    void current.end().catch(report);
  };

  const scheduleIdleClose = (): void => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      closeIdleConnection();
    }, options.idleCloseMs ?? IDLE_CLOSE_MS);
    idleTimer.unref();
  };

  const release = (channel: string, subscribers: ScopedSubscribers): void => {
    if (channels.get(channel) !== subscribers || subscribers.size() > 0) return;
    channels.delete(channel);
    const current = client;
    if (current !== null) {
      void current.query(`UNLISTEN ${pg.escapeIdentifier(channel)}`).catch(report);
    }
    if (channels.size === 0) scheduleIdleClose();
  };

  return {
    close: async () => {
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = null;
      channels.clear();
      const current = client;
      client = null;
      if (current === null) return;
      current.removeAllListeners();
      await current.end();
    },
    publish: (event) => {
      const payload = JSON.stringify(event);
      if (encoder.encode(payload).length > PAYLOAD_LIMIT_BYTES) {
        report(new Error(`realtime payload exceeds ${String(PAYLOAD_LIMIT_BYTES)} bytes`));
        return;
      }
      void Promise.resolve(
        options.db.execute(sql`select pg_notify(${realtimeChannel(event.tenantId)}, ${payload})`),
      ).catch(report);
    },
    subscribe: (scope, listener) => {
      const channel = realtimeChannel(scope.tenantId);
      const existing = channels.get(channel);
      const subscribers = existing ?? createScopedSubscribers();
      if (existing === undefined) channels.set(channel, subscribers);
      const remove = subscribers.add(scope, listener);
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      const current = client;
      if (current === null) void connect();
      else {
        void current.query(`LISTEN ${pg.escapeIdentifier(channel)}`).catch((error: unknown) => {
          report(error);
          dropConnection(current);
        });
      }
      return () => {
        remove();
        release(channel, subscribers);
      };
    },
  };
};
