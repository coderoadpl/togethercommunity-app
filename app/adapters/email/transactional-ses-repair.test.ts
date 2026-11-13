import { ensureTransactionalSesConfiguration } from '#core/server/usecases/transactional-ses-configuration.js';
import {
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
  DescribeConfigurationSetCommand,
  SESClient,
  SendEmailCommand,
  UpdateConfigurationSetEventDestinationCommand,
  type EventDestination,
} from '@aws-sdk/client-ses';
import { SNSClient } from '@aws-sdk/client-sns';
import { expect, it, vi } from 'vitest';

import { ok, tenantSesSettingsSchema } from '#core/domain/index.js';
import { createLayeredTransactionalEmailSender } from '#core/server/usecases/layered-transactional-email.js';
import { dispatchEmailBatch } from '#core/server/usecases/dispatch-email-batch.js';
import { InMemoryTenantSesSettingsRepository, InMemoryEmailEventRepository, InMemoryEmailOutboxRepository, InMemorySchedulerRunRepository } from '#core/server/testing/marketing-fakes.js';

import { createSesEmailPort, type SesEmailSettings } from './ses.js';
import { createSesOnboardingControlPlane } from './ses-onboarding.js';
import { createTenantSesTransactionalResolver } from './transactional-resolvers.js';

const credentials = { accessKeyId: 'tenant-access', secretAccessKey: 'tenant-secret', region: 'eu-central-1' };
const now = '2026-11-01T12:00:00.000Z';
const topicArn = 'arn:aws:sns:eu-central-1:123456789012:tenant';
const setup = () => {
  const sets = new Map<string, EventDestination[]>([['marketing', []]]);
  const ses = new SESClient(credentials);
  const state: { fail: boolean; concurrentCreation: boolean; duplicateDestinations: number; concurrentDestinations: EventDestination[] | null } = {
    fail: false, concurrentCreation: false, duplicateDestinations: 0, concurrentDestinations: null,
  };
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- The SDK also declares callback overloads; the adapter only calls the promise overload.
  vi.spyOn(ses, 'send').mockImplementation(async (command) => {
    if (command instanceof SendEmailCommand) {
      if (!sets.has(command.input.ConfigurationSetName ?? '')) throw Object.assign(new Error('Missing'), { name: 'ConfigurationSetDoesNotExistException' });
      return { MessageId: 'sent', $metadata: {} };
    }
    if (state.fail) throw new Error('AccessDenied');
    if (command instanceof DescribeConfigurationSetCommand) {
      const destinations = sets.get(command.input.ConfigurationSetName ?? '');
      if (destinations === undefined) throw Object.assign(new Error('Missing'), { name: 'ConfigurationSetDoesNotExistException' });
      return { EventDestinations: destinations, $metadata: {} };
    }
    if (command instanceof CreateConfigurationSetCommand) {
      sets.set(command.input.ConfigurationSet?.Name ?? '', []);
      if (state.concurrentCreation) throw Object.assign(new Error('Already created'), { name: 'ConfigurationSetAlreadyExistsException' });
      return { $metadata: {} };
    }
    if (command instanceof CreateConfigurationSetEventDestinationCommand || command instanceof UpdateConfigurationSetEventDestinationCommand) {
      const name = command.input.ConfigurationSetName ?? '';
      const destination = command.input.EventDestination;
      if (destination === undefined) throw new Error('Missing destination');
      if (command instanceof CreateConfigurationSetEventDestinationCommand && sets.get(name)?.some((item) => item.Name === destination.Name)) {
        state.duplicateDestinations += 1;
        if (state.concurrentDestinations !== null) sets.set(name, state.concurrentDestinations);
        throw Object.assign(new Error('Already created'), { name: 'EventDestinationAlreadyExistsException' });
      }
      sets.set(name, [...(sets.get(name) ?? []).filter((item) => item.Name !== destination.Name), destination]);
      return { $metadata: {} };
    }
    throw new Error('Unexpected SES command');
  });
  const factory = vi.fn((input: typeof credentials) => {
    expect(input).toEqual(credentials);
    return { ses, sns: new SNSClient(credentials) };
  });
  const controlPlane = createSesOnboardingControlPlane(factory, {
    list: async () => [], subscribe: async () => ({ $metadata: {} }), unsubscribe: async () => undefined,
  });
  const settings = tenantSesSettingsSchema.parse({
    tenantId: 'tenant', fromAddress: 'mail@example.test', fromName: 'Example', identity: 'example.test', replyTo: null,
    identityCheckedAt: null, identityCheckError: null, snsSubscriptionEndpoint: null, snsSubscriptionConfirmedAt: null, autoPauseOnCritical: false, reputationAlertStatus: null, reputationAlertedAt: null,
    identityVerifiedAt: now, configurationSet: 'marketing', snsTopicArn: topicArn, trackingEnabled: true,
    webhookToken: 'webhook-token-1234567890123456', quotaRatePerSec: 10, quotaDaily: 1000, quotaSentLast24Hours: 0,
    quotaRefreshedAt: now, inSandbox: false, webhookVerifiedAt: now, footerLegalName: 'Example', footerAddress: 'Example Street', broadcastsEnabled: true,
  });
  const port = { send: vi.fn(async () => ok({ messageId: 'sent' })), healthcheck: async () => ok({ healthy: true as const }), test: async () => ok({ code: 'email.available' as const, message: 'Ready' }) };
  const repository = new InMemoryTenantSesSettingsRepository([settings]);
  const emailFor = vi.fn((input: SesEmailSettings) => createSesEmailPort(input, {
    send: (command) => ses.send(command), healthcheck: async () => undefined,
  }));
  const logger = { warn: vi.fn() };
  const repair = vi.fn(async () => {
    const result = await ensureTransactionalSesConfiguration(credentials, settings, controlPlane);
    await repository.upsert('tenant', { ...settings, identityCheckError: result.ok ? null : result.error.message });
    return result;
  });
  const resolver = createTenantSesTransactionalResolver(repository,
    { resolve: async () => ok(credentials) }, { readiness: { ensure: repair }, logger }, emailFor);
  return { sets, state, resolver, factory, emailFor, port, logger, controlPlane, repair, repository, ses };
};

const message = { to: 'member@example.test', subject: 'Message', html: '<p>Message</p>', text: 'Message' };

it('sends a burst and checks availability without configuration API calls', async () => {
  const test = setup();
  await test.repair();
  test.factory.mockClear();
  test.repair.mockClear();
  vi.mocked(test.ses.send).mockClear();
  const results = await Promise.all(Array.from({ length: 20 }, async () => {
    const port = await test.resolver.resolve('tenant');
    expect(await port?.healthcheck()).toEqual(ok({ healthy: true }));
    expect(await port?.test()).toMatchObject({ ok: true });
    return port?.send(message);
  }));
  expect(results).toEqual(Array.from({ length: 20 }, () => ok({ messageId: 'sent' })));
  expect(test.repair).not.toHaveBeenCalled();
  expect(test.factory).not.toHaveBeenCalled();
  expect(test.ses.send).toHaveBeenCalledTimes(20);
  for (const [command] of vi.mocked(test.ses.send).mock.calls) expect(command).toBeInstanceOf(SendEmailCommand);
  expect(test.emailFor).toHaveBeenCalledWith(expect.objectContaining({ configurationSet: 'marketing-transactional', credentials: { accessKeyId: 'tenant-access', secretAccessKey: 'tenant-secret' } }));
});

it('does not repair a missing set during availability and diagnostic checks', async () => {
  const test = setup();
  const port = await test.resolver.resolve('tenant');
  expect(await port?.healthcheck()).toEqual(ok({ healthy: true }));
  expect(await port?.test()).toMatchObject({ ok: true });
  expect(test.repair).not.toHaveBeenCalled();
  expect(test.factory).not.toHaveBeenCalled();
  expect(test.ses.send).not.toHaveBeenCalled();
});

it('repairs a missing set once and returns a retryable error without resending inline', async () => {
  const test = setup();
  const port = await test.resolver.resolve('tenant');
  expect(test.factory).not.toHaveBeenCalled();
  expect(await port?.send(message)).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
  expect(test.repair).toHaveBeenCalledTimes(1);
  expect(vi.mocked(test.ses.send).mock.calls.filter(([command]) => command instanceof SendEmailCommand)).toHaveLength(1);
  expect(test.logger.warn).toHaveBeenCalledWith(expect.stringContaining('tenant=tenant'));
  expect(await (await test.resolver.resolve('tenant'))?.send(message)).toEqual(ok({ messageId: 'sent' }));
  expect(test.repair).toHaveBeenCalledTimes(1);
});

it('proactively repairs an older tenant and repeats safely after destination loss', async () => {
  const test = setup();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt === 2) test.sets.set('marketing-transactional', []);
    expect(await test.repair()).toEqual(ok('marketing-transactional'));
    expect(test.sets.get('marketing-transactional')).toEqual([{
      Name: 'together-events', Enabled: true, MatchingEventTypes: ['send', 'delivery', 'bounce', 'complaint'], SNSDestination: { TopicARN: topicArn },
    }]);
  }
  for (const [input] of test.factory.mock.calls) expect(input).toEqual(credentials);
  expect(test.sets.get('marketing')).toEqual([]);
});

it('accepts a set created concurrently and still verifies its destination before sending', async () => {
  const test = setup();
  test.state.concurrentCreation = true;
  expect(await test.repair()).toEqual(ok('marketing-transactional'));
  expect(test.sets.get('marketing-transactional')).toMatchObject([{
    MatchingEventTypes: ['send', 'delivery', 'bounce', 'complaint'],
  }]);
});

it('repairs engagement drift in the managed transactional destination', async () => {
  const test = setup();
  test.sets.set('marketing-transactional', [{
    Name: 'together-events', Enabled: false, MatchingEventTypes: ['open', 'click'],
    SNSDestination: { TopicARN: 'arn:aws:sns:eu-central-1:123456789012:old' },
  }]);
  expect(await test.repair()).toEqual(ok('marketing-transactional'));
  expect(test.sets.get('marketing-transactional')).toEqual([{
    Name: 'together-events', Enabled: true, MatchingEventTypes: ['send', 'delivery', 'bounce', 'complaint'],
    SNSDestination: { TopicARN: topicArn },
  }]);
});

it.each([true, false])('checks unrelated destinations when reporting readiness (enabled=%s)', async (enabled) => {
  const test = setup();
  expect(await test.repair()).toEqual(ok('marketing-transactional'));
  test.sets.set('marketing', [{
    Name: 'together-events', Enabled: true, SNSDestination: { TopicARN: topicArn },
    MatchingEventTypes: ['send', 'delivery', 'bounce', 'complaint', 'open', 'click'],
  }]);
  test.sets.get('marketing-transactional')?.push({ Name: 'other', Enabled: enabled, MatchingEventTypes: ['open'] });
  expect(await test.controlPlane.readInfrastructure(credentials, {
    configurationSet: 'marketing', transactionalConfigurationSet: 'marketing-transactional', topicArn,
    endpoint: 'https://example.test/webhook', subscribedEndpoint: null,
  })).toMatchObject({ ok: true, value: { configurationSetReady: true, eventDestinationReady: !enabled } });
});

it('blocks another enabled engagement destination without changing it', async () => {
  const test = setup();
  const foreign: EventDestination = { Name: 'other', Enabled: true, MatchingEventTypes: ['open', 'click'] };
  test.sets.set('marketing-transactional', [foreign]);
  expect(await test.repair()).toMatchObject({ ok: false });
  const port = await test.resolver.resolve('tenant');
  expect(await port?.send({ to: 'member@example.test', subject: 'Message', html: '<p>Message</p>', text: 'Message' }))
    .toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
  expect(test.emailFor).not.toHaveBeenCalled();
  expect(test.sets.get('marketing-transactional')).toEqual([foreign]);
});

it.each([true, false])('retries the transactional outbox without transport fallthrough (repair failure=%s)', async (repairFails) => {
  const test = setup();
  test.state.fail = repairFails;
  const events = new InMemoryEmailEventRepository();
  const outbox = new InMemoryEmailOutboxRepository(events);
  await outbox.enqueue({ id: 'outbox', tenantId: 'tenant', to: 'member@example.test', now,
    payload: { kind: 'thread-reply', language: 'en', tenantName: 'Example', lessonName: 'Lesson', authorDisplay: 'Author', snippet: 'Message', url: 'https://example.test/lesson' } });
  const resolve = vi.fn(async (tenantId: string) => test.resolver.resolve(tenantId));
  const sender = createLayeredTransactionalEmailSender({ transports: { resolve }, platform: test.port,
    pool: { usage: async () => ({ sent: 0, reserved: 0 }), reserve: async () => true, settle: async () => undefined, recordCapExemptSend: async () => undefined }, platformLimit: 1000 });
  const deps = { emailOutbox: outbox, events, email: sender, clock: { nowIso: () => now }, logger: { error: vi.fn() }, batchSize: 1, attemptsCap: 3, backoffBaseMs: 0, backoffCapMs: 0,
    ids: { nextId: () => crypto.randomUUID() }, runs: new InMemorySchedulerRunRepository(), trigger: 'manual' as const };
  expect(await dispatchEmailBatch(deps)).toEqual(ok({ attemptsMade: 1, sentCount: 0, failedCount: 1 }));
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(test.port.send).not.toHaveBeenCalled();
  expect(test.emailFor).toHaveBeenCalledTimes(1);
  expect(test.repair).toHaveBeenCalledTimes(1);
  expect(test.logger.warn).toHaveBeenCalledWith(expect.stringContaining('tenant=tenant'));
  expect((await events.listByRef('tenant', 'transactional', 'outbox')).map((event) => event.type)).toContain('failed');
  test.state.fail = false;
  if (repairFails) await test.repair();
  expect(await dispatchEmailBatch(deps)).toEqual(ok({ attemptsMade: 1, sentCount: 1, failedCount: 0 }));
  expect(test.repair).toHaveBeenCalledTimes(repairFails ? 2 : 1);
  expect(test.port.send).not.toHaveBeenCalled();
});

it('accepts concurrent repairs only after verifying the winning destination', async () => {
  const test = setup();
  test.sets.set('marketing-transactional', []);
  const results = await Promise.all([test.repair(), test.repair()]);
  expect(results).toEqual([ok('marketing-transactional'), ok('marketing-transactional')]);
  expect(test.state.duplicateDestinations).toBe(1);
  expect(test.sets.get('marketing-transactional')).toEqual([{
    Name: 'together-events', Enabled: true, MatchingEventTypes: ['send', 'delivery', 'bounce', 'complaint'], SNSDestination: { TopicARN: topicArn },
  }]);
});

it.each(['engagement', 'topic', 'disabled', 'missing-events'] as const)('rejects an unsafe concurrent destination (%s)', async (drift) => {
  const test = setup();
  test.sets.set('marketing-transactional', []);
  test.state.concurrentDestinations = [{
    Name: 'together-events', Enabled: drift !== 'disabled',
    MatchingEventTypes: drift === 'missing-events' ? ['send'] : ['send', 'delivery', 'bounce', 'complaint'],
    SNSDestination: { TopicARN: drift === 'topic' ? 'different-topic' : topicArn },
  }, ...(drift === 'engagement' ? [{ Name: 'other', Enabled: true, MatchingEventTypes: ['open' as const] }] : [])];
  const results = await Promise.all([test.repair(), test.repair()]);
  expect(test.state.duplicateDestinations).toBe(1);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
  expect(await (await test.resolver.resolve('tenant'))?.send(message)).toMatchObject({ ok: false });
  expect(test.emailFor).not.toHaveBeenCalled();
});
