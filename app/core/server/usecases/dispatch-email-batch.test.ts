import { describe, expect, it } from 'vitest';

import { err, internal, ok } from '@core/domain/index.js';
import {
  InMemoryEmailEventRepository,
  InMemoryEmailOutboxRepository,
  InMemorySchedulerRunRepository,
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
    ids: { nextId: (() => { let next = 0; return () => `run-id-${String(++next)}`; })() },
    runs: new InMemorySchedulerRunRepository(),
    trigger: 'manual' as const,
  };
};

describe('transactional email event lifecycle', () => {
  it('attributes the claimed budget to each tenant in a shared batch', async () => {
    const deps = await setup();
    await deps.emailOutbox.enqueue({
      id: 'outbox-2',
      tenantId: 'tenant-1',
      to: 'second@example.test',
      payload: {
        kind: 'reset-password',
        language: 'en',
        actionUrl: 'https://tenant.test/reset',
      },
      now: NOW,
    });
    await deps.emailOutbox.enqueue({
      id: 'outbox-3',
      tenantId: 'tenant-2',
      to: 'other@example.test',
      payload: {
        kind: 'reset-password',
        language: 'en',
        actionUrl: 'https://other.test/reset',
      },
      now: NOW,
    });

    await dispatchEmailBatch({
      ...deps,
      batchSize: 3,
      email: { send: async () => ok({ messageId: 'ses-1' }) },
    });

    const [run] = (await deps.runs.listPage({ limit: 10 })).runs;
    const detail = await deps.runs.getWithTenants(run?.id ?? '');
    expect(detail?.tenants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tenantId: 'tenant-1',
        batchSize: 2,
        budgetComputed: 2,
        budgetUsed: 2,
      }),
      expect.objectContaining({
        tenantId: 'tenant-2',
        batchSize: 1,
        budgetComputed: 1,
        budgetUsed: 1,
      }),
    ]));
  });

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
    const page = await deps.runs.listForTenant('tenant-1', { limit: 10 });
    const runs = page.items.map((item) => item.run);
    const runId = runs[0]?.id ?? '';
    expect(await deps.runs.getWithTenants(runId)).toMatchObject({
      run: {
        kind: 'outbox_dispatch',
        trigger: 'manual',
        status: 'completed',
        totals: { sendsAttempted: 1, sent: 1, failed: 0 },
      },
      tenants: [{
        tenantId: 'tenant-1',
        batchSize: 1,
        sent: 1,
        failed: 0,
        budgetComputed: 1,
        budgetUsed: 1,
      }],
    });
    expect(await deps.events.listByRef('tenant-1', 'transactional', 'outbox-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'accepted', meta: expect.objectContaining({ runId }) }),
      ]),
    );
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
