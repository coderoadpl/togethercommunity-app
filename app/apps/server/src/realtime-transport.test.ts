import { describe, expect, it } from 'vitest';

import { createRealtimeTransport, realtimeListenerUrl } from './realtime-transport.js';
import type { RealtimeTransportEnv } from './realtime-transport.js';

const POOLED = 'postgres://u:p@db.pooler.example.com/main';
const DIRECT = 'postgres://u:p@db.example.com/main';

const env = (overrides: Partial<RealtimeTransportEnv> = {}): RealtimeTransportEnv => ({
  REALTIME_TRANSPORT: 'pg',
  DATABASE_URL: DIRECT,
  ...overrides,
});

const db = { execute: () => Promise.resolve(null) };

const transport = (overrides: Partial<RealtimeTransportEnv> = {}) => {
  const warnings: string[] = [];
  const bus = createRealtimeTransport({
    env: env(overrides),
    db,
    logger: {
      error: () => undefined,
      warn: (message) => warnings.push(message),
    },
  });
  return { bus, warnings };
};

describe('realtime listener url', () => {
  it('prefers the dedicated url, then the unpooled url, then the pooled default', () => {
    expect(
      realtimeListenerUrl(
        env({
          REALTIME_DATABASE_URL: 'postgres://u:p@dedicated/main',
          DATABASE_URL_UNPOOLED: 'postgres://u:p@unpooled/main',
        }),
      ),
    ).toBe('postgres://u:p@dedicated/main');
    expect(
      realtimeListenerUrl(env({ DATABASE_URL_UNPOOLED: 'postgres://u:p@unpooled/main' })),
    ).toBe('postgres://u:p@unpooled/main');
    expect(realtimeListenerUrl(env())).toBe(DIRECT);
  });
});

describe('realtime transport selection', () => {
  it('builds the postgres bus by default and the in-process bus on request', () => {
    expect('close' in transport().bus).toBe(true);
    expect('close' in transport({ REALTIME_TRANSPORT: 'in-process' }).bus).toBe(false);
  });

  it('hands the resolved listener url to the postgres bus', () => {
    expect(transport({ DATABASE_URL: POOLED }).warnings).toHaveLength(1);
    expect(transport({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT }).warnings).toEqual([]);
    expect(
      transport({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: POOLED, REALTIME_DATABASE_URL: DIRECT })
        .warnings,
    ).toEqual([]);
  });
});
