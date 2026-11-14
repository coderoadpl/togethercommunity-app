import { ensureTransactionalSesConfiguration } from '#core/server/usecases/transactional-ses-configuration.js';
import { describe, expect, it, vi } from 'vitest';

import { err, notFound, ok, TRANSACTIONAL_SES_CONFIGURATION_FAILURE, type TenantSesSettings } from '#core/domain/index.js';

import {
  createEmailIntegrationTransportResolver,
  createResendTransactionalResolver,
  createTenantSesTransactionalResolver,
} from './transactional-resolvers.js';

const controlPlane = {
  ensureConfigurationSet: async (_credentials: unknown, name: string) => ok({ name }),
  ensureEventDestination: async () => ok({ ready: true as const }),
};
const infrastructure = {
  readiness: { ensure: (_tenantId: string, credentials: Parameters<typeof ensureTransactionalSesConfiguration>[0], settings: Parameters<typeof ensureTransactionalSesConfiguration>[1]) => ensureTransactionalSesConfiguration(credentials, settings, controlPlane) },
  logger: { warn: vi.fn() },
};
const message = { to: 'member@example.test', subject: 'Test', html: '<p>Test</p>', text: 'Test' };

describe('transactional e-mail transport resolvers', () => {
  it('attaches the non-engagement configuration set to transactional SES', async () => {
    const tenantSettings = {
      tenantId: 'tenant-1',
      fromAddress: 'mail@example.test',
      fromName: 'Example',
      identity: 'example.test',
      replyTo: null, identityVerifiedAt: '2026-07-22T00:00:00.000Z',
      identityCheckedAt: null,
      identityCheckError: null,
      configurationSet: 'marketing',
      snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:tenant-1',
      snsSubscriptionEndpoint: null,
      snsSubscriptionConfirmedAt: null,
      trackingEnabled: true,
      autoPauseOnCritical: true,
      webhookToken: 'token-token-token-token-token',
      quotaRatePerSec: 10,
      quotaDaily: 1000,
      quotaSentLast24Hours: 0,
      quotaRefreshedAt: '2026-07-22T00:00:00.000Z',
      inSandbox: false,
      webhookVerifiedAt: '2026-07-22T00:00:00.000Z',
      footerLegalName: 'Example sp. z o.o.',
      footerAddress: 'Example Street 1',
      broadcastsEnabled: true,
      reputationAlertStatus: null,
      reputationAlertedAt: null,
    };
    const settings = {
      findByTenant: async () => tenantSettings,
      findByWebhookToken: async () => tenantSettings,
      upsert: async () => tenantSettings,
    };
    const emailFor = vi.fn(() => ({
      healthcheck: async () => ok({ healthy: true as const }),
      test: async () => ok({ code: 'email.available' as const, message: 'Email is available.' }),
      send: async () => ok({ messageId: 'message-1', transport: 'tenant-ses' as const }),
    }));
    const resolver = createTenantSesTransactionalResolver(
      settings,
      {
        resolve: async () => ok({
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
          region: 'eu-central-1',
        }),
      },
      infrastructure,
      emailFor,
    );

    await expect(resolver.resolve('tenant-1')).resolves.not.toBeNull();
    expect(emailFor).toHaveBeenCalledWith(expect.objectContaining({
      configurationSet: 'marketing-transactional',
    }));
  });

  it('sends without a configuration set when a verified tenant has none, with one warning', async () => {
    const warn = vi.fn();
    const tenantSettings = {
      tenantId: 'tenant-1',
      fromAddress: 'mail@example.test',
      fromName: 'Example',
      identity: 'example.test',
      replyTo: null, identityVerifiedAt: '2026-07-22T00:00:00.000Z',
      identityCheckedAt: null,
      identityCheckError: null,
      configurationSet: null,
      snsTopicArn: null,
      snsSubscriptionEndpoint: null,
      snsSubscriptionConfirmedAt: null,
      trackingEnabled: false,
      autoPauseOnCritical: false,
      webhookToken: 'token-token-token-token-token',
      quotaRatePerSec: 0,
      quotaDaily: 0,
      quotaSentLast24Hours: 0,
      quotaRefreshedAt: null,
      inSandbox: true,
      webhookVerifiedAt: null,
      footerLegalName: 'Example sp. z o.o.',
      footerAddress: 'Example Street 1',
      broadcastsEnabled: false,
      reputationAlertStatus: null,
      reputationAlertedAt: null,
    };
    const emailFor = vi.fn(() => ({
      healthcheck: async () => ok({ healthy: true as const }),
      test: async () => ok({ code: 'email.available' as const, message: 'Email is available.' }),
      send: async () =>
        ok({ messageId: 'message-1', transport: 'tenant-ses' as const }),
    }));
    const resolver = createTenantSesTransactionalResolver(
      {
        findByTenant: async () => tenantSettings,
        findByWebhookToken: async () => tenantSettings,
        upsert: async () => tenantSettings,
      },
      {
        resolve: async () =>
          ok({
            accessKeyId: 'access-key',
            secretAccessKey: 'secret-key',
            region: 'eu-central-1',
          }),
      },
      { ...infrastructure, logger: { warn } },
      emailFor,
    );

    const email = await resolver.resolve('tenant-1');
    expect(email).not.toBeNull();
    expect(await email?.send({ to: 'member@example.test', subject: 'Test', html: '<p>Test</p>', text: 'Test' }))
      .toMatchObject({ ok: true, value: { messageId: 'message-1' } });
    expect(emailFor).toHaveBeenCalledWith(expect.objectContaining({ configurationSet: null }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tenant=tenant-1'));
  });

  describe('tenant SES states reachable before the transactional configuration repair', () => {
    const verified: TenantSesSettings = {
      tenantId: 'tenant-1',
      fromAddress: 'mail@example.test',
      fromName: 'Example',
      identity: 'example.test',
      replyTo: null,
      identityVerifiedAt: '2026-07-22T00:00:00.000Z',
      identityCheckedAt: null,
      identityCheckError: null,
      configurationSet: 'marketing',
      snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:tenant-1',
      snsSubscriptionEndpoint: null,
      snsSubscriptionConfirmedAt: null,
      trackingEnabled: false,
      autoPauseOnCritical: false,
      webhookToken: 'token-token-token-token-token',
      quotaRatePerSec: 10,
      quotaDaily: 1000,
      quotaSentLast24Hours: 0,
      quotaRefreshedAt: null,
      inSandbox: false,
      webhookVerifiedAt: null,
      footerLegalName: 'Example sp. z o.o.',
      footerAddress: 'Example Street 1',
      broadcastsEnabled: false,
      reputationAlertStatus: null,
      reputationAlertedAt: null,
    };
    const repairError = `${TRANSACTIONAL_SES_CONFIGURATION_FAILURE}SES rejected the credentials.`;
    const build = (tenantSettings: TenantSesSettings | null, credentialsResolve = true) => {
      const warn = vi.fn();
      const emailFor = vi.fn(() => ({
        healthcheck: async () => ok({ healthy: true as const }),
        test: async () => ok({ code: 'email.available' as const, message: 'Email is available.' }),
        send: async () => ok({ messageId: 'message-1' }),
      }));
      const resolver = createTenantSesTransactionalResolver(
        {
          findByTenant: async () => tenantSettings,
          findByWebhookToken: async () => tenantSettings,
          upsert: async (_tenantId, next) => next,
        },
        {
          resolve: async () => credentialsResolve
            ? ok({ accessKeyId: 'access-key', secretAccessKey: 'secret-key', region: 'eu-central-1' })
            : err(notFound('SES credentials are not configured')),
        },
        { ...infrastructure, logger: { warn } },
        emailFor,
      );
      return { resolver, emailFor, warn };
    };

    it('falls through when the tenant has no SES settings', async () => {
      const test = build(null);
      await expect(test.resolver.resolve('tenant-1')).resolves.toBeNull();
      expect(test.emailFor).not.toHaveBeenCalled();
    });

    it.each([null, repairError])('falls through while the identity is unverified (identityCheckError=%s)', async (identityCheckError) => {
      const test = build({ ...verified, identityVerifiedAt: null, identityCheckError });
      await expect(test.resolver.resolve('tenant-1')).resolves.toBeNull();
      expect(test.emailFor).not.toHaveBeenCalled();
    });

    it('falls through when the SES credentials do not resolve', async () => {
      const test = build({ ...verified, identityCheckError: repairError }, false);
      await expect(test.resolver.resolve('tenant-1')).resolves.toBeNull();
      expect(test.emailFor).not.toHaveBeenCalled();
    });

    it('sends with the transactional set when the topic is missing', async () => {
      const test = build({ ...verified, snsTopicArn: null });
      const email = await test.resolver.resolve('tenant-1');
      expect(await email?.send(message)).toEqual(ok({ messageId: 'message-1' }));
      expect(test.emailFor).toHaveBeenCalledWith(expect.objectContaining({ configurationSet: 'marketing-transactional' }));
    });

    it('keeps sending with a stored repair error and warns about it', async () => {
      const test = build({ ...verified, identityCheckError: repairError });
      const email = await test.resolver.resolve('tenant-1');
      expect(await email?.send(message)).toEqual(ok({ messageId: 'message-1' }));
      expect(test.emailFor).toHaveBeenCalledWith(expect.objectContaining({ configurationSet: 'marketing-transactional' }));
      expect(test.warn).toHaveBeenCalledTimes(1);
      expect(test.warn).toHaveBeenCalledWith(expect.stringContaining('tenant=tenant-1'));
    });
  });

  it('resolves Resend from the tenant key and shared sender identity', async () => {
    const emailFor = vi.fn(() => ({
      healthcheck: async () => ok({ healthy: true as const }),
      test: async () => ok({ code: 'email.available' as const, message: 'Resend is available.' }),
      send: async () => ok({ messageId: 'resend-message-1' }),
    }));
    const resolver = createResendTransactionalResolver(
      {
        findByTenant: async () => ({
          tenantId: 'tenant-1',
          fromAddress: 'mail@example.test',
          fromName: 'Example',
          identity: 'example.test',
          replyTo: null, identityVerifiedAt: null,
          identityCheckedAt: null,
          identityCheckError: null,
          configurationSet: null,
          snsTopicArn: null,
          snsSubscriptionEndpoint: null,
          snsSubscriptionConfirmedAt: null,
          trackingEnabled: false,
          autoPauseOnCritical: false,
          webhookToken: 'token-token-token-token-token',
          quotaRatePerSec: 0,
          quotaDaily: 0,
          quotaSentLast24Hours: 0,
          quotaRefreshedAt: null,
          inSandbox: true,
          webhookVerifiedAt: null,
          footerLegalName: '',
          footerAddress: '',
          broadcastsEnabled: false,
          reputationAlertStatus: null,
          reputationAlertedAt: null,
        }),
        findByWebhookToken: async () => null,
        upsert: async (_tenantId, settings) => settings,
      },
      {
        resolve: async (_tenantId, key) => key === 'resend.apiKey'
          ? ok('re_tenant_123')
          : { ok: false, error: notFound('Secret is not configured') },
      },
      emailFor,
    );

    await expect(resolver.resolve('tenant-1')).resolves.not.toBeNull();
    expect(emailFor).toHaveBeenCalledWith({
      apiKey: 're_tenant_123',
      from: 'Example <mail@example.test>',
    });
  });

  it('routes each wizard transport to its matching EmailPort resolver', async () => {
    const called: string[] = [];
    const resolver = createEmailIntegrationTransportResolver({
      smtp: { resolve: async () => { called.push('smtp'); return null; } },
      ses: { resolve: async () => { called.push('ses'); return null; } },
      resend: { resolve: async () => { called.push('resend'); return null; } },
    });

    for (const transport of ['smtp', 'ses', 'resend'] as const) {
      await resolver.resolve('tenant-1', transport);
    }

    expect(called).toEqual(['smtp', 'ses', 'resend']);
  });
});
