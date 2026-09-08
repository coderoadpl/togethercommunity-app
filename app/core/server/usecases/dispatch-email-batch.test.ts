import { describe, expect, it, vi } from 'vitest';

import { err, internal, ok, SMOKE_TENANT_ID, type EmailOutboxPayload } from '#core/domain/index.js';
import type { EmailIntegrationTransportResolver, EmailPort, PlatformTransactionalPool } from '../ports.js';
import {
  InMemoryEmailEventRepository,
  InMemoryEmailOutboxRepository,
  InMemorySchedulerRunRepository,
} from '../testing/marketing-fakes.js';
import { dispatchEmailBatch } from './dispatch-email-batch.js';
import { createLayeredTransactionalEmailSender } from './layered-transactional-email.js';

const NOW = '2026-07-26T10:00:00.000Z';

const defaultPayload: EmailOutboxPayload = {
  kind: 'reset-password',
  language: 'en',
  actionUrl: 'https://tenant.test/reset',
};

const setup = async ({
  payload = defaultPayload,
  tenantTransportRequired = false,
  tenantId = 'tenant-1',
}: {
  payload?: EmailOutboxPayload;
  tenantTransportRequired?: boolean;
  tenantId?: string;
} = {}) => {
  const events = new InMemoryEmailEventRepository();
  const emailOutbox = new InMemoryEmailOutboxRepository(events);
  await emailOutbox.enqueue({
    id: 'outbox-1',
    tenantId,
    to: 'member@example.test',
    payload,
    tenantTransportRequired,
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

const authUrl = 'https://auth.example.test/verify?token=global-auth-bearer';
const authPayloads = [
  { kind: 'welcome-sign-in', language: 'en', tenantName: 'Example', actionUrl: authUrl },
  { kind: 'reset-password', language: 'en', actionUrl: authUrl },
  { kind: 'verify-email', language: 'en', actionUrl: authUrl },
  { kind: 'magic-link', language: 'en', tenantName: 'Example', url: authUrl },
] as const satisfies readonly EmailOutboxPayload[];

const transportSetup = (configured: 'ses' | 'smtp' | 'resend' | null, smokeTenantSink?: EmailPort) => {
  const attackerSend = vi.fn<EmailPort['send']>(async () => ok({ messageId: 'attacker-message' }));
  const platformSend = vi.fn<EmailPort['send']>(async () => ok({ messageId: 'platform-message' }));
  const attacker: EmailPort = {
    send: attackerSend,
    healthcheck: async () => ok({ healthy: true }),
    test: async () => ok({ code: 'email.available', message: 'Email is available.' }),
  };
  const resolve = vi.fn<EmailIntegrationTransportResolver['resolve']>(async (_tenantId, transport) =>
    transport === configured ? attacker : null);
  const reserve = vi.fn<PlatformTransactionalPool['reserve']>(async () => true);
  const settle = vi.fn<PlatformTransactionalPool['settle']>(async () => undefined);
  const recordCapExemptSend = vi.fn<PlatformTransactionalPool['recordCapExemptSend']>(async () => undefined);
  const email = createLayeredTransactionalEmailSender({
    transports: { resolve },
    platform: { ...attacker, send: platformSend },
    pool: { usage: async () => ({ sent: 0, reserved: 0 }), reserve, settle, recordCapExemptSend },
    platformLimit: 1000,
    ...(smokeTenantSink === undefined ? {} : { smokeTenantSink }),
  });
  return { email, attackerSend, platformSend, resolve, reserve, settle, recordCapExemptSend };
};

describe('auth outbox transport isolation', () => {
  it.each(authPayloads.flatMap((payload) =>
    (['ses', 'smtp', 'resend', null] as const).flatMap((transport) =>
      [false, true].map((tenantTransportRequired) => ({
        kind: payload.kind, payload, transport, tenantTransportRequired,
      })))))(
    'sends $kind through the platform despite attacker $transport and tenantTransportRequired=$tenantTransportRequired',
    async ({ payload, transport, tenantTransportRequired }) => {
      const deps = await setup({ payload, tenantTransportRequired });
      const sending = transportSetup(transport);

      expect(await dispatchEmailBatch({ ...deps, email: sending.email }))
        .toEqual(ok({ attemptsMade: 1, sentCount: 1, failedCount: 0 }));

      expect(sending.platformSend).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        tenantId: 'tenant-1',
        to: 'member@example.test',
        text: expect.stringContaining(authUrl),
      }));
      expect(sending.attackerSend).not.toHaveBeenCalled();
      expect(sending.resolve).not.toHaveBeenCalled();
      expect(sending.recordCapExemptSend).toHaveBeenCalledExactlyOnceWith('tenant-1');
      expect(sending.reserve).not.toHaveBeenCalled();
      expect(sending.settle).not.toHaveBeenCalled();
      expect(deps.emailOutbox.items[0]).toMatchObject({
        tenantId: 'tenant-1', status: 'sent', transport: 'platform',
      });
      expect(await deps.events.listByRef('tenant-1', 'transactional', 'outbox-1'))
        .toEqual(expect.arrayContaining([expect.objectContaining({
          type: 'accepted', meta: expect.objectContaining({ transport: 'platform' }),
        })]));
    },
  );

  it('retries a platform failure without exposing the auth bearer to tenant SMTP', async () => {
    const deps = await setup({ payload: authPayloads[0] });
    const sending = transportSetup('smtp');
    sending.platformSend.mockResolvedValueOnce(err(internal('Platform unavailable')));

    expect(await dispatchEmailBatch({ ...deps, email: sending.email }))
      .toEqual(ok({ attemptsMade: 1, sentCount: 0, failedCount: 1 }));
    expect(deps.emailOutbox.items[0]).toMatchObject({ status: 'failed', transport: 'platform' });
    expect(await dispatchEmailBatch({ ...deps, email: sending.email }))
      .toEqual(ok({ attemptsMade: 1, sentCount: 1, failedCount: 0 }));
    expect(sending.platformSend).toHaveBeenCalledTimes(2);
    expect(sending.recordCapExemptSend).toHaveBeenCalledExactlyOnceWith('tenant-1');
    expect(sending.attackerSend).not.toHaveBeenCalled();
    expect(sending.resolve).not.toHaveBeenCalled();
  });

  it('still delivers auth mail when the platform cap is exhausted, without touching tenant SMTP', async () => {
    const deps = await setup({ payload: authPayloads[0] });
    const sending = transportSetup('smtp');
    sending.reserve.mockResolvedValue(false);

    expect(await dispatchEmailBatch({ ...deps, email: sending.email }))
      .toEqual(ok({ attemptsMade: 1, sentCount: 1, failedCount: 0 }));
    expect(sending.platformSend).toHaveBeenCalledOnce();
    expect(sending.recordCapExemptSend).toHaveBeenCalledExactlyOnceWith('tenant-1');
    expect(sending.reserve).not.toHaveBeenCalled();
    expect(sending.settle).not.toHaveBeenCalled();
    expect(sending.attackerSend).not.toHaveBeenCalled();
    expect(sending.resolve).not.toHaveBeenCalled();
    expect(deps.emailOutbox.items[0]).toMatchObject({ status: 'sent', transport: 'platform' });
  });

  it('keeps smoke-tenant enrollment auth mail in the production sink', async () => {
    const deps = await setup({ payload: authPayloads[0], tenantId: SMOKE_TENANT_ID });
    const sinkSend = vi.fn<EmailPort['send']>(async () => ok({ messageId: 'sink-message' }));
    const sending = transportSetup('smtp', {
      send: sinkSend,
      healthcheck: async () => ok({ healthy: true }),
      test: async () => ok({ code: 'email.available', message: 'Email is available.' }),
    });

    expect(await dispatchEmailBatch({ ...deps, email: sending.email }))
      .toEqual(ok({ attemptsMade: 1, sentCount: 1, failedCount: 0 }));
    expect(sinkSend).toHaveBeenCalledOnce();
    expect(sending.platformSend).not.toHaveBeenCalled();
    expect(sending.attackerSend).not.toHaveBeenCalled();
    expect(sending.resolve).not.toHaveBeenCalled();
    expect(sending.reserve).not.toHaveBeenCalled();
    expect(sending.settle).not.toHaveBeenCalled();
    expect(sending.recordCapExemptSend).not.toHaveBeenCalled();
    expect(deps.emailOutbox.items[0]).toMatchObject({
      tenantId: SMOKE_TENANT_ID, status: 'sent', transport: 'platform',
    });
  });

  it('keeps non-auth API mail on the configured tenant SMTP transport', async () => {
    const deps = await setup({ payload: { kind: 'm2m-transactional', subject: 'Receipt', text: 'Your receipt' }, tenantTransportRequired: true });
    const sending = transportSetup('smtp');

    expect(await dispatchEmailBatch({ ...deps, email: sending.email }))
      .toEqual(ok({ attemptsMade: 1, sentCount: 1, failedCount: 0 }));
    expect(sending.attackerSend).toHaveBeenCalledOnce();
    expect(sending.platformSend).not.toHaveBeenCalled();
    expect(deps.emailOutbox.items[0]).toMatchObject({ transport: 'smtp' });
  });
});

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
      email: { send: async () => ok({ messageId: 'ses-1', transport: 'platform' as const }) },
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
      email: { send: async () => ok({ messageId: 'ses-1', transport: 'smtp' as const }) },
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
        expect.objectContaining({
          type: 'accepted',
          meta: expect.objectContaining({ runId, transport: 'smtp' }),
        }),
      ]),
    );
    expect(deps.emailOutbox.items[0]).toMatchObject({
      status: 'sent',
      transport: 'smtp',
      deliveryStatus: null,
    });
  });

  it('records failure, retry, and acceptance in exact order', async () => {
    const deps = await setup();
    let attempt = 0;
    const email = {
      send: async () => {
        attempt += 1;
        return attempt === 1
          ? err(internal('SES unavailable'))
          : ok({ messageId: 'ses-recovered', transport: 'platform' as const });
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
