import { describe, expect, it } from 'vitest';

import { err, internal, ok } from '@core/domain/index.js';
import {
  InMemoryEmailEventRepository,
  InMemoryEmailOutboxRepository,
} from '../testing/marketing-fakes.js';
import { dispatchEmailBatch } from './dispatch-email-batch.js';

const NOW = '2026-07-26T10:00:00.000Z';

const setup = async () => {
  const events = new InMemoryEmailEventRepository();
  const emailOutbox = new InMemoryEmailOutboxRepository(events);
  await emailOutbox.enqueue({
    id: 'outbox-1',
    tenantId: 'tenant-1',
    to: 'member@example.test',
    payload: {
      kind: 'reset-password',
      language: 'en',
      actionUrl: 'https://tenant.test/reset',
    },
    now: NOW,
  });
  return {
    events,
    emailOutbox,
    clock: { nowIso: () => NOW },
    logger: { error: () => undefined },
    batchSize: 1,
    attemptsCap: 3,
    backoffBaseMs: 0,
    backoffCapMs: 0,
  };
};

describe('transactional email event lifecycle', () => {
  it('records the exact happy outbox lifecycle', async () => {
    const deps = await setup();
    await dispatchEmailBatch({
      ...deps,
      email: { send: async () => ok({ messageId: 'ses-1' }) },
    });
    expect((await deps.events.listByRef(
      'tenant-1',
      'transactional',
      'outbox-1',
    )).map((event) => event.type))
      .toEqual(['queued', 'claimed', 'rendered', 'accepted']);
  });

  it('records failure, retry, and acceptance in exact order', async () => {
    const deps = await setup();
    let attempt = 0;
    const email = {
      send: async () => {
        attempt += 1;
        return attempt === 1
          ? err(internal('SES unavailable'))
          : ok({ messageId: 'ses-recovered' });
      },
    };
    await dispatchEmailBatch({ ...deps, email });
    await dispatchEmailBatch({ ...deps, email });
    expect((await deps.events.listByRef(
      'tenant-1',
      'transactional',
      'outbox-1',
    )).map((event) => event.type))
      .toEqual([
        'queued',
        'claimed',
        'rendered',
        'failed',
        'retried',
        'claimed',
        'rendered',
        'accepted',
      ]);
  });

  it('records terminal dispatcher failure without acceptance', async () => {
    const deps = await setup();
    await dispatchEmailBatch({
      ...deps,
      attemptsCap: 1,
      email: { send: async () => err(internal('Invalid credentials')) },
    });
    expect((await deps.events.listByRef(
      'tenant-1',
      'transactional',
      'outbox-1',
    )).map((event) => event.type))
      .toEqual(['queued', 'claimed', 'rendered', 'failed']);
  });
});
