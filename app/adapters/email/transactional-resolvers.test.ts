import { describe, expect, it, vi } from 'vitest';

import { ok } from '#core/domain/index.js';

import { createTenantSesTransactionalResolver } from './transactional-resolvers.js';

describe('transactional e-mail transport resolvers', () => {
  it('never attaches the marketing configuration set to tenant SES', async () => {
    const tenantSettings = {
      tenantId: 'tenant-1',
      fromAddress: 'mail@example.test',
      fromName: 'Example',
      identity: 'example.test',
      identityVerifiedAt: '2026-07-22T00:00:00.000Z',
      configurationSet: 'marketing',
      snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:tenant-1',
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
    };
    const settings = {
      findByTenant: async () => tenantSettings,
      findByWebhookToken: async () => tenantSettings,
      upsert: async () => tenantSettings,
    };
    const emailFor = vi.fn(() => ({
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
      configurationSet: null,
    }));
  });
});
