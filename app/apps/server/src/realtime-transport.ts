import { createPgRealtimeBus, SERVERLESS_IDLE_CLOSE_MS } from '#adapters/db/realtime-bus.js';
import type { RealtimeNotifyDb } from '#adapters/db/realtime-bus.js';
import { createRealtimeBus } from '#adapters/notifications/in-app.js';
import type { RealtimeBusPort } from '#core/server/index.js';

export interface RealtimeTransportEnv {
  REALTIME_TRANSPORT: 'pg' | 'in-process';
  REALTIME_DATABASE_URL?: string | undefined;
  DATABASE_URL_UNPOOLED?: string | undefined;
  DATABASE_URL: string;
  VERCEL_URL?: string | undefined;
}

export const realtimeListenerUrl = (env: RealtimeTransportEnv): string =>
  env.REALTIME_DATABASE_URL ?? env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;

export const createRealtimeTransport = (input: {
  env: RealtimeTransportEnv;
  db: RealtimeNotifyDb;
  logger: { error(message: string): void; warn(message: string): void };
}): RealtimeBusPort =>
  input.env.REALTIME_TRANSPORT === 'in-process'
    ? createRealtimeBus()
    : createPgRealtimeBus({
        db: input.db,
        connectionString: realtimeListenerUrl(input.env),
        ...(input.env.VERCEL_URL === undefined ? {} : { idleCloseMs: SERVERLESS_IDLE_CLOSE_MS }),
        onError: (error) => {
          input.logger.error(`[realtime] ${error.message}`);
        },
        onWarning: (message) => {
          input.logger.warn(`[realtime] ${message}`);
        },
      });
