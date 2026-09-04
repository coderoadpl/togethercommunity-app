import { describe, expect, it, vi } from 'vitest';

import { notFound, ok } from '#core/domain/index.js';

import {
  createEmailIntegrationTransportResolver,
  createResendTransactionalResolver,
  createTenantSesTransactionalResolver,
} from './transactional-resolvers.js';

describe('transactional e-mail transport resolvers', () => {
  it('attaches the non-engagement configuration set to transactional SES', async () => {
    const tenantSettings = {
      tenantId: 'tenant-1',
      fromAddress: 'mail@example.test',
      fromName: 'Example',
      identity: 'example.test',
      identityVerifiedAt: '2026-07-22T00:00:00.000Z',
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
      emailFor,
    );

    await expect(resolver.resolve('tenant-1')).resolves.not.toBeNull();
    expect(emailFor).toHaveBeenCalledWith(expect.objectContaining({
      configurationSet: 'marketing-transactional',
    }));
  });

  it('keeps the configuration set empty when the tenant has none', async () => {
    const tenantSettings = {
      tenantId: 'tenant-1',
      fromAddress: 'mail@example.test',
      fromName: 'Example',
      identity: 'example.test',
      identityVerifiedAt: '2026-07-22T00:00:00.000Z',
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
      emailFor,
    );

    await expect(resolver.resolve('tenant-1')).resolves.not.toBeNull();
    expect(emailFor).toHaveBeenCalledWith(
      expect.objectContaining({ configurationSet: null }),
    );
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
          identityVerifiedAt: null,
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
