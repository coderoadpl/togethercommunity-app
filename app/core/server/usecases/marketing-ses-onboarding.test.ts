import { describe, expect, it } from 'vitest';

import {
  err,
  integrationUnavailable,
  ok,
  type TenantSecret,
  type TenantSecretKey,
  type TenantSesSettings,
} from '#core/domain/index.js';

import type { SecretCrypto, SesAccountIdentity, TenantSecretRepository } from '../ports.js';
import { updateTenantSesMarketingSettings } from './marketing-management.js';
import { setTenantSecret } from './tenant-secrets.js';
import {
  deriveSesOnboardingChecklist,
  listSesIdentities,
  pollSesOnboarding,
  provisionSesInfrastructure,
  refreshSesIdentity,
  sendSesSimulatorTest,
  startSesIdentityVerification,
  type SesOnboardingControlPlane,
} from './marketing-ses-onboarding.js';
import {
  InMemorySnsWebhookDeliveryRepository,
  InMemoryTenantSesSettingsRepository,
} from '../testing/marketing-fakes.js';

const NOW = '2026-07-27T10:00:00.000Z';
const WEBHOOK_URL = 'https://app.together.test/api/webhooks/ses/webhook_token_123456789012345';
const LEGACY_WEBHOOK_URL = 'https://together.test/api/webhooks/ses/webhook_token_123456789012345';

const ctx = {
  identity: {
    userId: 'user-1',
    email: 'owner@tenant.test',
    name: 'Owner',
    emailVerified: true,
    tenantId: 'tenant-1',
    tenantSlug: 'tenant',
    tenantName: 'Tenant',
    staffRole: 'owner' as const,
    memberId: null,
    image: null,
    memberDisplayName: null,
    memberBannedAt: null,
    memberDmOptOutAt: null,
    memberLanguage: null,
  },
};

const settings = (overrides: Partial<TenantSesSettings> = {}): TenantSesSettings => ({
  tenantId: 'tenant-1',
  fromAddress: 'news@tenant.test',
  fromName: 'Tenant',
  identity: 'tenant.test',
  identityVerifiedAt: null,
  identityCheckedAt: null,
  identityCheckError: null,
  configurationSet: null,
  snsTopicArn: null,
  snsSubscriptionEndpoint: null,
  snsSubscriptionConfirmedAt: null,
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
  reputationAlertStatus: null,
  reputationAlertedAt: null,
  ...overrides,
});

class FakeSesOnboardingControlPlane implements SesOnboardingControlPlane {
  failEventDestinationOnce = false;
  eventDestinationAttempts = 0;
  eventDestinationTracking: boolean[] = [];
  identityVerified = false;
  identityFailure = false;
  infrastructureReady = true;
  subscriptionConfirmed = true;
  feedbackForwardingAttempts = 0;
  simulatorRecipients: string[] = [];
  accountIdentities: SesAccountIdentity[] = [];
  accessDeniedAction: string | null = null;
  subscribedEndpoints: string[] = [];
  removedEndpoints: string[] = [];
  removable = true;
  readSubscribedEndpoints: (string | null)[] = [];

  async listIdentities() {
    return ok({ identities: this.accountIdentities, accessDeniedAction: this.accessDeniedAction });
  }

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
    if (this.identityFailure) {
      return err(integrationUnavailable('SES identity lookup failed'));
    }
    return ok({ verified: this.identityVerified, dkimVerified: this.identityVerified, records: [] });
  }

  async ensureConfigurationSet(_credentials: unknown, name: string) {
    return ok({ name });
  }

  async ensureTopic() {
    return ok({ arn: 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1' });
  }

  async ensureSubscription(_credentials: unknown, input: { endpoint: string }) {
    this.subscribedEndpoints.push(input.endpoint);
    return ok({
      confirmed: this.subscriptionConfirmed,
      arn: this.subscriptionConfirmed ? 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1:sub' : null,
      endpoint: input.endpoint,
    });
  }

  async removeSubscription(_credentials: unknown, input: { endpoint: string }) {
    this.removedEndpoints.push(input.endpoint);
    return ok({ removed: this.removable });
  }

  async readInfrastructure(_credentials: unknown, input: { subscribedEndpoint: string | null }) {
    this.readSubscribedEndpoints.push(input.subscribedEndpoint);
    return ok({
      configurationSetReady: this.infrastructureReady,
      eventDestinationReady: true,
      subscriptionConfirmed: this.subscriptionConfirmed,
    });
  }

  async ensureEventDestination(
    _credentials: unknown,
    input: { engagementTracking: boolean },
  ) {
    this.eventDestinationAttempts += 1;
    this.eventDestinationTracking.push(input.engagementTracking);
    if (this.failEventDestinationOnce && this.eventDestinationAttempts === 1) {
      return err(integrationUnavailable('SES event destination could not be created'));
    }
    return ok({ ready: true as const });
  }

  async disableFeedbackForwarding() {
    this.feedbackForwardingAttempts += 1;
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
  webhookBaseUrl: async () => 'https://app.together.test/api/webhooks/ses',
});

const sesSecretKeys: TenantSecretKey[] = ['ses.accessKeyId', 'ses.secretAccessKey', 'ses.region'];

const sesSecretRows: TenantSecret[] = sesSecretKeys.map(
  (key) => ({
    id: `secret-${key}`,
    tenantId: 'tenant-1',
    key,
    ciphertext: `cipher:${key}`,
    iv: 'iv',
    authTag: 'tag',
    maskedPreview: '••••2345',
    updatedAt: NOW,
  }),
);

const secretRepository = (rows: TenantSecret[]): TenantSecretRepository => ({
  listByTenant: async () => rows,
  findByKey: async (_tenantId, key) => rows.find((row) => row.key === key) ?? null,
  upsert: async (_tenantId, secret) => secret,
  delete: async () => false,
});

const secretCrypto: SecretCrypto = {
  encrypt: (plaintext) => ({ ciphertext: `cipher:${plaintext}`, iv: 'iv', authTag: 'tag' }),
  decrypt: (input) => ok(input.ciphertext),
};

const platformPool = {
  usage: async () => ({ sent: 0, reserved: 0 }),
  reserve: async () => true,
  settle: async () => undefined,
};

const senderInput = {
  fromAddress: 'news@tenant.test',
  fromName: 'Tenant',
  identity: 'tenant.test',
  configurationSet: null,
  snsTopicArn: null,
  trackingEnabled: false,
  autoPauseOnCritical: false,
  footerLegalName: 'Tenant Ltd',
  footerAddress: 'Street 1, Warsaw',
};

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
    expect(controlPlane.eventDestinationAttempts).toBe(3);
    expect(controlPlane.eventDestinationTracking).toEqual([true, true, false]);
  });

  it('keeps SES feedback forwarding enabled while SNS confirmation is pending', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings()]);
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.subscriptionConfirmed = false;

    const result = await provisionSesInfrastructure(ctx, deps(repository, controlPlane));

    expect(result).toMatchObject({
      ok: true,
      value: {
        subscriptionConfirmed: false,
        feedbackForwardingDisabled: false,
      },
    });
    expect(controlPlane.feedbackForwardingAttempts).toBe(0);
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

  it('refreshes identity state and clears verification after a regression', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings({
      identityVerifiedAt: '2026-07-20T10:00:00.000Z',
      configurationSet: 'together-tenant-1',
      snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1',
    })]);
    const controlPlane = new FakeSesOnboardingControlPlane();

    const result = await refreshSesIdentity(ctx, deps(repository, controlPlane));

    expect(result).toMatchObject({
      ok: true,
      value: {
        identityVerifiedAt: null,
        identityCheckedAt: NOW,
        identityCheckError: null,
      },
    });
  });

  it('records a refresh error without clearing the last verified state', async () => {
    const verifiedAt = '2026-07-20T10:00:00.000Z';
    const repository = new InMemoryTenantSesSettingsRepository([settings({
      identityVerifiedAt: verifiedAt,
    })]);
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.identityFailure = true;

    const result = await refreshSesIdentity(ctx, deps(repository, controlPlane));

    expect(result).toMatchObject({
      ok: true,
      value: {
        identityVerifiedAt: verifiedAt,
        identityCheckedAt: NOW,
        identityCheckError: 'SES identity lookup failed',
      },
    });
  });

  it('removes a configuration set that SES no longer reports', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings({
      identityVerifiedAt: NOW,
      configurationSet: 'missing-configuration-set',
      snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1',
      webhookVerifiedAt: NOW,
    })]);
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.identityVerified = true;
    controlPlane.infrastructureReady = false;

    const result = await refreshSesIdentity(ctx, deps(repository, controlPlane));

    expect(result).toMatchObject({
      ok: true,
      value: {
        configurationSet: null,
        webhookVerifiedAt: null,
        broadcastsEnabled: false,
      },
    });
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

  it('stamps the subscription confirmation and the subscribed endpoint when SNS confirms it', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings()]);
    const controlPlane = new FakeSesOnboardingControlPlane();

    const result = await provisionSesInfrastructure(ctx, deps(repository, controlPlane));

    expect(result).toMatchObject({ ok: true, value: { subscriptionEndpoint: WEBHOOK_URL } });
    expect(await repository.findByTenant('tenant-1')).toMatchObject({
      snsSubscriptionEndpoint: WEBHOOK_URL,
      snsSubscriptionConfirmedAt: NOW,
    });
    expect(controlPlane.subscribedEndpoints).toEqual([WEBHOOK_URL]);
  });

  it('leaves the subscription unconfirmed while SNS still reports it as pending', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings()]);
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.subscriptionConfirmed = false;

    await provisionSesInfrastructure(ctx, deps(repository, controlPlane));

    expect(await repository.findByTenant('tenant-1')).toMatchObject({
      snsSubscriptionEndpoint: WEBHOOK_URL,
      snsSubscriptionConfirmedAt: null,
    });
  });

  it('resubscribes and drops the confirmation when provisioning finds a stale endpoint', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings({
      identityVerifiedAt: NOW,
      configurationSet: 'together-tenant-1',
      snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1',
      snsSubscriptionEndpoint: LEGACY_WEBHOOK_URL,
      snsSubscriptionConfirmedAt: '2026-07-20T10:00:00.000Z',
    })]);
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.subscriptionConfirmed = false;

    const result = await provisionSesInfrastructure(ctx, deps(repository, controlPlane));

    expect(result).toMatchObject({ ok: true, value: { subscriptionEndpoint: WEBHOOK_URL } });
    expect(await repository.findByTenant('tenant-1')).toMatchObject({
      snsSubscriptionEndpoint: WEBHOOK_URL,
      snsSubscriptionConfirmedAt: null,
    });
    expect(controlPlane.subscribedEndpoints).toEqual([WEBHOOK_URL, WEBHOOK_URL]);
    expect(controlPlane.removedEndpoints).toEqual([LEGACY_WEBHOOK_URL]);
  });

  it('keeps the stale subscription when SNS cannot unsubscribe it', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings({
      snsSubscriptionEndpoint: LEGACY_WEBHOOK_URL,
      snsSubscriptionConfirmedAt: '2026-07-20T10:00:00.000Z',
    })]);
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.removable = false;

    const result = await provisionSesInfrastructure(ctx, deps(repository, controlPlane));

    expect(result).toMatchObject({ ok: true, value: { subscriptionEndpoint: WEBHOOK_URL } });
    expect(await repository.findByTenant('tenant-1')).toMatchObject({
      snsSubscriptionEndpoint: WEBHOOK_URL,
    });
  });

  it('migrates a stale endpoint on poll and reports the subscription as pending again', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings({
      identityVerifiedAt: NOW,
      configurationSet: 'together-tenant-1',
      snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1',
      snsSubscriptionEndpoint: LEGACY_WEBHOOK_URL,
      snsSubscriptionConfirmedAt: '2026-07-20T10:00:00.000Z',
    })]);
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.identityVerified = true;
    controlPlane.subscriptionConfirmed = false;

    const result = await pollSesOnboarding(ctx, deps(repository, controlPlane));

    expect(result).toMatchObject({ ok: true, value: { checklist: { snsSubscription: false } } });
    expect(controlPlane.subscribedEndpoints).toEqual([WEBHOOK_URL]);
    expect(controlPlane.removedEndpoints).toEqual([LEGACY_WEBHOOK_URL]);
    expect(controlPlane.readSubscribedEndpoints).toEqual([WEBHOOK_URL]);
    expect(await repository.findByTenant('tenant-1')).toMatchObject({
      snsSubscriptionEndpoint: WEBHOOK_URL,
      snsSubscriptionConfirmedAt: null,
    });
  });

  it('leaves a subscription that only differs by trailing slash alone', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings({
      identityVerifiedAt: NOW,
      configurationSet: 'together-tenant-1',
      snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1',
      snsSubscriptionEndpoint: `${WEBHOOK_URL}/`,
      snsSubscriptionConfirmedAt: '2026-07-20T10:00:00.000Z',
    })]);
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.identityVerified = true;

    await pollSesOnboarding(ctx, deps(repository, controlPlane));

    expect(controlPlane.subscribedEndpoints).toEqual([]);
    expect(controlPlane.removedEndpoints).toEqual([]);
  });

  it('clears the persisted confirmation when a poll no longer observes a confirmed subscription', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings({
      identityVerifiedAt: NOW,
      configurationSet: 'together-tenant-1',
      snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1',
      snsSubscriptionEndpoint: WEBHOOK_URL,
      snsSubscriptionConfirmedAt: '2026-07-20T10:00:00.000Z',
    })]);
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.identityVerified = true;
    controlPlane.subscriptionConfirmed = false;

    const result = await pollSesOnboarding(ctx, deps(repository, controlPlane));

    expect(result).toMatchObject({ ok: true, value: { checklist: { snsSubscription: false } } });
    expect(await repository.findByTenant('tenant-1')).toMatchObject({
      snsSubscriptionConfirmedAt: null,
    });
    expect(controlPlane.readSubscribedEndpoints).toEqual([WEBHOOK_URL]);
  });

  it('keeps the confirmation when the poll cannot observe the subscription', async () => {
    const confirmedAt = '2026-07-20T10:00:00.000Z';
    const repository = new InMemoryTenantSesSettingsRepository([settings({
      identityVerifiedAt: NOW,
      configurationSet: null,
      snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1',
      snsSubscriptionEndpoint: WEBHOOK_URL,
      snsSubscriptionConfirmedAt: confirmedAt,
    })]);
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.identityVerified = true;

    const result = await pollSesOnboarding(ctx, deps(repository, controlPlane));

    expect(result).toMatchObject({ ok: true, value: { checklist: { snsSubscription: true } } });
    expect(await repository.findByTenant('tenant-1')).toMatchObject({
      snsSubscriptionConfirmedAt: confirmedAt,
    });
    expect(controlPlane.readSubscribedEndpoints).toEqual([]);
  });

  it('keeps the poll and the stored readiness in sync and records the identity check time', async () => {
    const confirmedAt = '2026-07-20T10:00:00.000Z';
    const repository = new InMemoryTenantSesSettingsRepository([settings({
      identityVerifiedAt: NOW,
      configurationSet: 'together-tenant-1',
      snsTopicArn: 'arn:aws:sns:eu-central-1:123456789012:together-tenant-1',
      snsSubscriptionEndpoint: WEBHOOK_URL,
      snsSubscriptionConfirmedAt: confirmedAt,
    })]);
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.identityVerified = true;

    const result = await pollSesOnboarding(ctx, deps(repository, controlPlane));

    expect(result).toMatchObject({ ok: true, value: { checklist: { snsSubscription: true } } });
    expect(await repository.findByTenant('tenant-1')).toMatchObject({
      snsSubscriptionConfirmedAt: confirmedAt,
      identityCheckedAt: NOW,
      identityCheckError: null,
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

  it('offers the identities that already exist in the tenant AWS account', async () => {
    const repository = new InMemoryTenantSesSettingsRepository();
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.accountIdentities = [
      { identity: 'tenant.test', kind: 'domain', verified: true, dkimVerified: true },
      { identity: 'owner@tenant.test', kind: 'email', verified: false, dkimVerified: false },
    ];

    expect(await listSesIdentities(ctx, deps(repository, controlPlane))).toEqual(ok({
      identities: controlPlane.accountIdentities,
      accessDeniedAction: null,
    }));
  });

  it('passes the missing list permission through as a hint instead of an error', async () => {
    const repository = new InMemoryTenantSesSettingsRepository();
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.accessDeniedAction = 'ses:ListIdentities';

    expect(await listSesIdentities(ctx, deps(repository, controlPlane))).toEqual(ok({
      identities: [],
      accessDeniedAction: 'ses:ListIdentities',
    }));
  });

  it('refuses to list identities before the AWS credentials are configured', async () => {
    const repository = new InMemoryTenantSesSettingsRepository();
    const controlPlane = new FakeSesOnboardingControlPlane();

    const result = await listSesIdentities(ctx, {
      ...deps(repository, controlPlane),
      credentials: { resolve: async () => err(integrationUnavailable('SES credentials are missing')) },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
  });

  it('reads the identity status from AWS as soon as the sender is saved', async () => {
    const repository = new InMemoryTenantSesSettingsRepository();
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.identityVerified = true;

    const saved = await updateTenantSesMarketingSettings(ctx, senderInput, {
      settings: repository,
      secrets: secretRepository(sesSecretRows),
      tokens: { nextToken: () => 'webhook_token_123456789012345' },
      clock: { nowIso: () => NOW },
      webhookBaseUrl: async () => 'https://app.together.test/api/webhooks/ses',
      pool: platformPool,
      snsDeliveries: new InMemorySnsWebhookDeliveryRepository(),
      sesOnboarding: { credentials: deps(repository, controlPlane).credentials, controlPlane },
    });

    expect(saved).toMatchObject({
      ok: true,
      value: { settings: { identityCheckedAt: NOW, identityVerifiedAt: NOW, identityCheckError: null } },
    });
  });

  it('still saves the sender when the AWS identity read fails', async () => {
    const repository = new InMemoryTenantSesSettingsRepository();
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.identityFailure = true;

    const saved = await updateTenantSesMarketingSettings(ctx, senderInput, {
      settings: repository,
      secrets: secretRepository(sesSecretRows),
      tokens: { nextToken: () => 'webhook_token_123456789012345' },
      clock: { nowIso: () => NOW },
      webhookBaseUrl: async () => 'https://app.together.test/api/webhooks/ses',
      pool: platformPool,
      snsDeliveries: new InMemorySnsWebhookDeliveryRepository(),
      sesOnboarding: { credentials: deps(repository, controlPlane).credentials, controlPlane },
    });

    expect(saved).toMatchObject({
      ok: true,
      value: {
        settings: {
          identity: 'tenant.test',
          identityCheckedAt: NOW,
          identityVerifiedAt: null,
          identityCheckError: 'SES identity lookup failed',
        },
      },
    });
  });

  it('skips the immediate check while the AWS credentials are still missing', async () => {
    const repository = new InMemoryTenantSesSettingsRepository();
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.identityVerified = true;

    const saved = await updateTenantSesMarketingSettings(ctx, senderInput, {
      settings: repository,
      secrets: secretRepository([]),
      tokens: { nextToken: () => 'webhook_token_123456789012345' },
      clock: { nowIso: () => NOW },
      webhookBaseUrl: async () => 'https://app.together.test/api/webhooks/ses',
      pool: platformPool,
      snsDeliveries: new InMemorySnsWebhookDeliveryRepository(),
      sesOnboarding: { credentials: deps(repository, controlPlane).credentials, controlPlane },
    });

    expect(saved).toMatchObject({
      ok: true,
      value: { settings: { identityCheckedAt: null, identityVerifiedAt: null } },
    });
  });

  it('reads the identity status as soon as an AWS credential is saved', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings()]);
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.identityVerified = true;

    const stored = await setTenantSecret(ctx, { key: 'ses.region', value: 'eu-central-1' }, {
      tenantSecrets: secretRepository(sesSecretRows),
      secretCrypto,
      ids: { nextId: () => 'secret-1' },
      clock: { nowIso: () => NOW },
      sesIdentity: {
        settings: repository,
        credentials: deps(repository, controlPlane).credentials,
        controlPlane,
        webhookBaseUrl: async () => 'https://app.together.test/api/webhooks/ses',
      },
    });

    expect(stored.ok).toBe(true);
    expect(await repository.findByTenant('tenant-1')).toMatchObject({
      identityCheckedAt: NOW,
      identityVerifiedAt: NOW,
      identityCheckError: null,
    });
  });

  it('leaves non-SES secrets alone and stores the check error when AWS is unreachable', async () => {
    const repository = new InMemoryTenantSesSettingsRepository([settings()]);
    const controlPlane = new FakeSesOnboardingControlPlane();
    controlPlane.identityFailure = true;
    const secretDeps = {
      tenantSecrets: secretRepository(sesSecretRows),
      secretCrypto,
      ids: { nextId: () => 'secret-1' },
      clock: { nowIso: () => NOW },
      sesIdentity: {
        settings: repository,
        credentials: deps(repository, controlPlane).credentials,
        controlPlane,
        webhookBaseUrl: async () => 'https://app.together.test/api/webhooks/ses',
      },
    };

    await setTenantSecret(ctx, { key: 'resend.apiKey', value: 're_abcdefghijkl' }, secretDeps);
    expect(await repository.findByTenant('tenant-1')).toMatchObject({ identityCheckedAt: null });

    const stored = await setTenantSecret(ctx, { key: 'ses.accessKeyId', value: 'AKIAEXAMPLE12345' }, secretDeps);

    expect(stored.ok).toBe(true);
    expect(await repository.findByTenant('tenant-1')).toMatchObject({
      identityCheckedAt: NOW,
      identityCheckError: 'SES identity lookup failed',
    });
  });
});
