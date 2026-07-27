import { describe, expect, it } from 'vitest';

import { err, integrationUnavailable, ok, type TenantSesSettings } from '@core/domain/index.js';
import {
  deriveSesOnboardingChecklist,
  pollSesOnboarding,
  provisionSesInfrastructure,
  sendSesSimulatorTest,
  startSesIdentityVerification,
  type SesOnboardingControlPlane,
} from './marketing-ses-onboarding.js';
import {
  InMemoryTenantSesSettingsRepository,
} from '../testing/marketing-fakes.js';

const NOW = '2026-07-27T10:00:00.000Z';
const WEBHOOK_URL = 'https://app.together.test/api/webhooks/ses/webhook_token_123456789012345';

const ctx = {
  identity: {
    userId: 'user-1',
    email: 'owner@tenant.test',
    name: 'Owner',
    tenantId: 'tenant-1',
    tenantSlug: 'tenant',
    tenantName: 'Tenant',
    staffRole: 'owner' as const,
    memberId: null,
  },
};

const settings = (overrides: Partial<TenantSesSettings> = {}): TenantSesSettings => ({
  tenantId: 'tenant-1',
  fromAddress: 'news@tenant.test',
  fromName: 'Tenant',
  identity: 'tenant.test',
  identityVerifiedAt: null,
  configurationSet: null,
  snsTopicArn: null,
  trackingEnabled: false,
  autoPauseOnCritical: false,
  webhookToken: 'webhook_token_123456789012345',
  quotaRatePerSec: 0,
  quotaDaily: 0,
  quotaSentLast24Hours: 0,
  quotaRefreshedAt: null,
  inSandbox: true,
  webhookVerifiedAt: null,
  footerLegalName: 'Tenant Ltd',
  footerAddress: 'Street 1, Warsaw',
  broadcastsEnabled: false,
  ...overrides,
});

class FakeSesOnboardingControlPlane implements SesOnboardingControlPlane {
  failEventDestinationOnce = false;
  eventDestinationAttempts = 0;
  identityVerified = false;
  subscriptionConfirmed = true;
  simulatorRecipients: string[] = [];

  async startDomainIdentity() {
    return ok({
      records: [
        { name: 'token-1._domainkey.tenant.test', type: 'CNAME' as const, value: 'token-1.dkim.amazonses.com' },
        { name: 'token-2._domainkey.tenant.test', type: 'CNAME' as const, value: 'token-2.dkim.amazonses.com' },
        { name: 'token-3._domainkey.tenant.test', type: 'CNAME' as const, value: 'token-3.dkim.amazonses.com' },
      ],
    });
  }

  async startEmailIdentity() {
    return ok({ records: [] });
  }

  async readIdentity() {
    return ok({ verified: this.identityVerified, dkimVerified: this.identityVerified, records: [] });
  }

  async ensureConfigurationSet() {
    return ok({ name: 'together-tenant-1' });
  }

  async ensureTopic() {
    return ok({ arn: 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1' });
  }

  async ensureSubscription() {
    return ok({
      confirmed: this.subscriptionConfirmed,
      arn: this.subscriptionConfirmed ? 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1:sub' : null,
    });
  }

  async readInfrastructure() {
    return ok({
      configurationSetReady: true,
      eventDestinationReady: true,
      subscriptionConfirmed: this.subscriptionConfirmed,
    });
  }

  async ensureEventDestination() {
    this.eventDestinationAttempts += 1;
    if (this.failEventDestinationOnce && this.eventDestinationAttempts === 1) {
      return err(integrationUnavailable('SES event destination could not be created'));
    }
    return ok({ ready: true as const });
  }

  async disableFeedbackForwarding() {
    return ok({ disabled: true as const });
  }

  async readQuota() {
    return ok({ ratePerSecond: 14, daily: 50_000, sentLast24Hours: 120, inSandbox: false });
  }

  async sendSimulator(
    _credentials: { accessKeyId: string; secretAccessKey: string; region: string },
    input: { to: string },
  ) {
    this.simulatorRecipients.push(input.to);
    return ok({ messageId: 'ses-simulator-message' });
  }
}

const deps = (
  repository: InMemoryTenantSesSettingsRepository,
  controlPlane: FakeSesOnboardingControlPlane,
) => ({
  settings: repository,
  credentials: {
    resolve: async () => ok({
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      region: 'eu-central-1',
    }),
  },
  controlPlane,
  clock: { nowIso: () => NOW },
  webhookBaseUrl: 'https://app.together.test/api/webhooks/ses',
});

describe('SES onboarding wizard', () => {
  it('starts domain verification idempotently and returns copy-paste DKIM records', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings()]);
    const controlPlane = new FakeSesOnboardingControlPlane();

    const first = await startSesIdentityVerification(ctx, { kind: 'domain' }, deps(repository, controlPlane));
    const second = await startSesIdentityVerification(ctx, { kind: 'domain' }, deps(repository, controlPlane));

    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true, value: { identity: 'tenant.test', kind: 'domain' } });
    expect(first.ok && first.value.records[0]).toEqual({
      name: 'token-1._domainkey.tenant.test',
      type: 'CNAME',
      value: 'token-1.dkim.amazonses.com',
    });
  });

  it('persists completed infrastructure steps so a partial failure resumes safely', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings()]);
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.failEventDestinationOnce = true;

    const first = await provisionSesInfrastructure(ctx, deps(repository, controlPlane));

    expect(first).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
    expect(await repository.findByTenant('tenant-1')).toMatchObject({
      configurationSet: 'together-tenant-1',
      snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1',
    });

    const resumed = await provisionSesInfrastructure(ctx, deps(repository, controlPlane));

    expect(resumed).toMatchObject({
      ok: true,
      value: {
        configurationSet: 'together-tenant-1',
        topicArn: 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1',
        subscriptionConfirmed: true,
        feedbackForwardingDisabled: true,
      },
    });
    expect(controlPlane.eventDestinationAttempts).toBe(2);
  });

  it('removes stale identity readiness and reports a verification regression', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings({
      identityVerifiedAt: NOW,
      configurationSet: 'together-tenant-1',
      snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1',
      quotaRefreshedAt: NOW,
      inSandbox: false,
    })]);
    const controlPlane = new FakeSesOnboardingControlPlane();

    const result = await pollSesOnboarding(ctx, deps(repository, controlPlane));

    expect(result).toMatchObject({
      ok: true,
      value: {
        identityVerified: false,
        identityRegressed: true,
      },
    });
    expect((await repository.findByTenant('tenant-1'))?.identityVerifiedAt).toBeNull();
  });

  it('derives every M19 item from provider and webhook state', () => {
    expect(deriveSesOnboardingChecklist({
      credentialsConfigured: true,
      identityVerified: true,
      configurationSetReady: true,
      subscriptionConfirmed: true,
      webhookVerifiedAt: NOW,
      footerConfigured: true,
      quotaRefreshed: true,
      inSandbox: false,
    })).toEqual({
      credentials: true,
      identity: true,
      configurationSet: true,
      snsSubscription: true,
      webhook: true,
      footer: true,
      productionAccess: true,
    });
    expect(deriveSesOnboardingChecklist({
      credentialsConfigured: true,
      identityVerified: true,
      configurationSetReady: true,
      subscriptionConfirmed: false,
      webhookVerifiedAt: null,
      footerConfigured: true,
      quotaRefreshed: true,
      inSandbox: true,
    })).toMatchObject({
      snsSubscription: false,
      webhook: false,
      productionAccess: false,
    });
  });

  it('sends the simulator bounce and leaves webhook readiness to the SNS round-trip', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings({
      identityVerifiedAt: NOW,
      configurationSet: 'together-tenant-1',
      snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1',
    })]);
    const controlPlane = new FakeSesOnboardingControlPlane();

    const result = await sendSesSimulatorTest(ctx, deps(repository, controlPlane));

    expect(result).toEqual(ok({
      messageId: 'ses-simulator-message',
      webhookVerifiedAt: null,
      waitingForWebhook: true,
    }));
    expect(controlPlane.simulatorRecipients).toEqual(['bounce@simulator.amazonses.com']);
    expect(WEBHOOK_URL).toContain('webhook_token_123456789012345');
  });
});
