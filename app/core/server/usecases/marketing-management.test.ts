import { describe, expect, it } from 'vitest';

import type {
  Campaign,
  ConsentDefinition,
  ConsentDefinitionVersion,
  Identity,
  TenantSecret,
  TenantSecretKey,
  TenantSesSettings,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { TenantSecretRepository } from '../ports.js';
import {
  InMemoryCampaignRepository,
  InMemoryConsentDefinitionRepository,
  InMemoryEmailLayoutRepository,
  InMemoryMarketingAudienceRepository,
  InMemoryTenantDocumentRepository,
  InMemorySnsWebhookDeliveryRepository,
  InMemoryTenantSesSettingsRepository,
} from '../testing/marketing-fakes.js';
import {
  createTenantDocument,
  getTenantSesMarketingSettings,
  previewMarketingAudience,
  publishTenantDocument,
  saveEmailLayout,
  saveTenantDocumentDraft,
  updateMarketingCampaign,
  updateMarketingConsentDefinition,
  updateTenantSesMarketingSettings,
} from './marketing-management.js';

const NOW = '2026-07-22T10:00:00.000Z';
const snsDeliveries = new InMemorySnsWebhookDeliveryRepository();

const ctx: Ctx = { identity: {
  userId: 'staff-1', email: 'staff@example.test', name: 'Staff', emailVerified: true, tenantId: 'tenant-1',
  tenantSlug: 'tenant', tenantName: 'Tenant', staffRole: 'owner', memberId: null,
image: null,
memberDisplayName: null,
memberBannedAt: null,
memberDmOptOutAt: null,
memberLanguage: null,
memberVideoAutoplay: false,
} satisfies Identity };
const clock = { nowIso: () => NOW };
const sequence = () => {
  let value = 0;
  return { nextId: () => `generated-${String(++value)}` };
};

const definition: ConsentDefinition = {
  id: 'definition-1', tenantId: 'tenant-1', key: 'newsletter', kind: 'optional_marketing',
  channel: 'email', doubleOptIn: true, documentRef: { mode: 'url', url: 'https://tenant.test/privacy' },
  status: 'active', createdAt: NOW, updatedAt: NOW,
};
const version: ConsentDefinitionVersion = {
  id: 'version-1', tenantId: 'tenant-1', definitionId: definition.id, version: 1,
  label: 'Send me the newsletter', documentVersionRef: { mode: 'url', url: 'https://tenant.test/privacy' },
  createdAt: NOW, createdBy: 'staff-1',
};
const campaign = (status: Campaign['status']): Campaign => ({
  id: 'campaign-1', tenantId: 'tenant-1', name: 'Weekly', subject: 'Hello', bodyHtml: '<p>News</p>',
  bodySource: '<p>News</p>', layoutId: null, consentDefinitionId: definition.id, audienceFilter: null,
  status, sendAt: null, snapshotMaxMemberId: null, cursorMemberId: null, toSend: 0, sent: 0, failed: 0,
  lockedUntil: null, lockedBy: null, errorCount: 0, pausedReason: null, audienceNameSnapshot: null,
  consentLabelSnapshot: null, startedAt: null, finishedAt: null, createdAt: NOW,
});

const secretRow = (key: TenantSecretKey): TenantSecret => ({
  id: `secret-${key}`, tenantId: 'tenant-1', key, ciphertext: 'ciphertext', iv: 'iv', authTag: 'tag',
  maskedPreview: '••••test', updatedAt: NOW,
});

const secretRepository = (keys: TenantSecretKey[]): TenantSecretRepository => {
  const rows = keys.map(secretRow);
  return {
    listByTenant: async (tenantId) => rows.filter((row) => row.tenantId === tenantId),
    findByKey: async (tenantId, key) => rows.find((row) => row.tenantId === tenantId && row.key === key) ?? null,
    upsert: async (_tenantId, secret) => secret,
    delete: async () => false,
  };
};

describe('marketing management use-cases', () => {
  it('requires the declared marketing document write capability', async () => {
    const documents = new InMemoryTenantDocumentRepository();
    const readOnlyCtx: Ctx = {
      ...ctx,
      capabilities: ['marketing:document:read'],
    };
    expect(await createTenantDocument(
      readOnlyCtx,
      { slug: 'privacy', title: 'Privacy', content: '# Policy' },
      { documents, ids: sequence(), clock },
    )).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('publishes immutable hosted document versions while reusing only the active draft', async () => {
    const documents = new InMemoryTenantDocumentRepository();
    const ids = sequence();
    const created = await createTenantDocument(ctx, { slug: 'privacy', title: 'Privacy', content: '# First' }, { documents, ids, clock });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const firstPublish = await publishTenantDocument(ctx, { documentId: created.value.document.id }, { documents, clock });
    expect(firstPublish.ok).toBe(true);
    await saveTenantDocumentDraft(ctx, {
      documentId: created.value.document.id, title: 'Privacy policy', content: '# Second draft',
    }, { documents, ids, clock });
    await saveTenantDocumentDraft(ctx, {
      documentId: created.value.document.id, title: 'Privacy policy', content: '# Revised second draft',
    }, { documents, ids, clock });
    const secondPublish = await publishTenantDocument(ctx, { documentId: created.value.document.id }, { documents, clock });

    expect(secondPublish.ok).toBe(true);
    if (!secondPublish.ok) return;
    expect(secondPublish.value.versions.map(({ version: number, content, publishedAt }) => ({ number, content, publishedAt }))).toEqual([
      { number: 1, content: '# First', publishedAt: NOW },
      { number: 2, content: '# Revised second draft', publishedAt: NOW },
    ]);
  });

  it('appends consent wording versions only when wording or document evidence changes', async () => {
    const definitions = new InMemoryConsentDefinitionRepository();
    await definitions.create('tenant-1', definition, version);
    const documents = new InMemoryTenantDocumentRepository();
    const ids = sequence();

    const unchanged = await updateMarketingConsentDefinition(ctx, {
      definitionId: definition.id, label: version.label, doubleOptIn: false,
      documentRef: definition.documentRef, status: 'active',
    }, { definitions, documents, ids, clock });
    expect(unchanged.ok && unchanged.value.versions).toHaveLength(1);

    const changed = await updateMarketingConsentDefinition(ctx, {
      definitionId: definition.id, label: 'Send me product news', doubleOptIn: false,
      documentRef: definition.documentRef, status: 'active',
    }, { definitions, documents, ids, clock });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value.versions.map((entry) => entry.label)).toEqual([
      'Send me the newsletter',
      'Send me product news',
    ]);
  });

  it('validates layout slots, audience definitions, and campaign edit locks', async () => {
    const layouts = new InMemoryEmailLayoutRepository();
    const ids = sequence();
    const missingSlot = await saveEmailLayout(ctx, { name: 'Broken', bodyHtml: '<main>No content</main>' }, { layouts, ids, clock });
    const validLayout = await saveEmailLayout(ctx, {
      name: 'Newsletter', bodyHtml: '<html><body>{{{content}}}</body></html>',
    }, { layouts, ids, clock });
    expect(missingSlot.ok).toBe(false);
    expect(validLayout.ok).toBe(true);

    const definitions = new InMemoryConsentDefinitionRepository();
    await definitions.create('tenant-1', definition, version);
    const audience = new InMemoryMarketingAudienceRepository([
      { memberId: 'member-1', email: 'member@example.test', displayName: null, productIds: ['product-1'] },
    ]);
    const preview = await previewMarketingAudience(ctx, {
      consentDefinitionId: definition.id, productIds: ['product-1'],
    }, { definitions, audience });
    expect(preview).toEqual({ ok: true, value: { count: 1 } });

    const campaigns = new InMemoryCampaignRepository([campaign('running')]);
    const locked = await updateMarketingCampaign(ctx, {
      campaignId: 'campaign-1', name: 'Changed', subject: 'Changed', bodyHtml: '<p>Changed</p>',
      consentDefinitionId: definition.id, productIds: [], layoutId: null,
    }, { campaigns, definitions, layouts });
    expect(locked.ok).toBe(false);

    const editableCampaigns = new InMemoryCampaignRepository([campaign('draft')]);
    const updated = await updateMarketingCampaign(ctx, {
      campaignId: 'campaign-1', name: 'Changed', subject: 'Changed',
      bodyHtml: '<h1>Hello</h1>', bodySource: '# Hello',
      consentDefinitionId: definition.id, productIds: [], layoutId: null,
    }, { campaigns: editableCampaigns, definitions, layouts });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.campaign.bodySource).toBe('# Hello');
      expect(updated.value.campaign.bodyHtml).toBe('<h1>Hello</h1>');
    }
  });

  it('derives readiness from credentials and onboarding state instead of persisted flags', async () => {
    const settings: TenantSesSettings = {
      tenantId: 'tenant-1', fromAddress: 'news@tenant.test', fromName: 'Tenant', identity: 'tenant.test',
      identityVerifiedAt: NOW, identityCheckedAt: NOW, identityCheckError: null,
      configurationSet: null, snsTopicArn: 'arn:topic',
      snsSubscriptionEndpoint: null, snsSubscriptionConfirmedAt: null,
      trackingEnabled: false,
      autoPauseOnCritical: false,
      webhookToken: 'webhook_token_123456789012345', quotaRatePerSec: 10, quotaDaily: 1000,
      quotaSentLast24Hours: 0,
      quotaRefreshedAt: NOW, inSandbox: false, webhookVerifiedAt: NOW, footerLegalName: 'Tenant Ltd',
      footerAddress: 'Street 1, Warsaw', broadcastsEnabled: false,
      reputationAlertStatus: null, reputationAlertedAt: null,
    };
    const repository = new InMemoryTenantSesSettingsRepository([settings]);
    const secrets = secretRepository(['ses.accessKeyId', 'ses.secretAccessKey', 'ses.region']);
    const pool = {
      usage: async () => ({ sent: 0, reserved: 0 }),
      reserve: async () => true,
      settle: async () => undefined,
    };
    const read = await getTenantSesMarketingSettings(ctx, { webhookBaseUrl: async () => 'https://tenant.test/api/webhooks/ses' }, {
      settings: repository, secrets, pool, snsDeliveries,
    });
    expect(read.ok && read.value.settings?.broadcastsEnabled).toBe(false);
    await repository.upsert('tenant-1', { ...settings, configurationSet: 'marketing' });
    const configured = await getTenantSesMarketingSettings(ctx, {
      webhookBaseUrl: async () => 'https://tenant.test/api/webhooks/ses',
    }, { settings: repository, secrets, pool, snsDeliveries });
    expect(configured.ok && configured.value.settings?.broadcastsEnabled).toBe(true);

    const sandboxed = await updateTenantSesMarketingSettings(ctx, {
      fromAddress: settings.fromAddress, fromName: settings.fromName, identity: settings.identity,
      configurationSet: 'marketing', snsTopicArn: settings.snsTopicArn,
      trackingEnabled: true,
      autoPauseOnCritical: true,
      footerLegalName: settings.footerLegalName, footerAddress: settings.footerAddress,
    }, {
      settings: new InMemoryTenantSesSettingsRepository([{ ...settings, inSandbox: true }]), secrets,
      tokens: { nextToken: () => 'webhook_token_123456789012345' }, clock,
      webhookBaseUrl: async () => 'https://tenant.test/api/webhooks/ses',
      pool,
      snsDeliveries,
    });
    expect(sandboxed.ok && sandboxed.value.settings?.broadcastsEnabled).toBe(false);
    expect(sandboxed.ok && sandboxed.value.settings?.trackingEnabled).toBe(true);
    expect(sandboxed.ok && sandboxed.value.settings?.autoPauseOnCritical).toBe(true);

    const changedIdentity = await updateTenantSesMarketingSettings(ctx, {
      fromAddress: settings.fromAddress,
      fromName: settings.fromName,
      identity: 'new-identity.tenant.test',
      configurationSet: null,
      snsTopicArn: settings.snsTopicArn,
      trackingEnabled: false,
      autoPauseOnCritical: false,
      footerLegalName: settings.footerLegalName,
      footerAddress: settings.footerAddress,
    }, {
      settings: new InMemoryTenantSesSettingsRepository([settings]),
      secrets,
      tokens: { nextToken: () => 'webhook_token_123456789012345' },
      clock,
      webhookBaseUrl: async () => 'https://tenant.test/api/webhooks/ses',
      pool,
      snsDeliveries,
    });
    expect(changedIdentity).toMatchObject({
      ok: true,
      value: {
        settings: {
          identityVerifiedAt: null,
          identityCheckedAt: null,
          broadcastsEnabled: false,
        },
      },
    });

    expect(await updateTenantSesMarketingSettings(ctx, {
      fromAddress: settings.fromAddress, fromName: settings.fromName, identity: settings.identity,
      configurationSet: null, snsTopicArn: settings.snsTopicArn,
      trackingEnabled: true,
      autoPauseOnCritical: false,
      footerLegalName: settings.footerLegalName, footerAddress: settings.footerAddress,
    }, {
      settings: repository, secrets,
      tokens: { nextToken: () => 'webhook_token_123456789012345' }, clock,
      webhookBaseUrl: async () => 'https://tenant.test/api/webhooks/ses',
      pool,
      snsDeliveries,
    })).toMatchObject({ ok: false, error: { code: 'validation' } });

    const unrefreshed = await updateTenantSesMarketingSettings(ctx, {
      fromAddress: settings.fromAddress, fromName: settings.fromName, identity: settings.identity,
      configurationSet: null, snsTopicArn: settings.snsTopicArn,
      trackingEnabled: false,
      autoPauseOnCritical: false,
      footerLegalName: settings.footerLegalName, footerAddress: settings.footerAddress,
    }, {
      settings: new InMemoryTenantSesSettingsRepository(), secrets,
      tokens: { nextToken: () => 'webhook_token_123456789012345' }, clock,
      webhookBaseUrl: async () => 'https://tenant.test/api/webhooks/ses',
      pool,
      snsDeliveries,
    });
    expect(unrefreshed).toMatchObject({
      ok: true,
      value: {
        settings: {
          identityVerifiedAt: null,
          inSandbox: true,
          quotaRefreshedAt: null,
          broadcastsEnabled: false,
        },
      },
    });
  });

  it('keeps the SNS subscription state only while the topic ARN stays the same', async () => {
    const stored: TenantSesSettings = {
      tenantId: 'tenant-1', fromAddress: 'news@tenant.test', fromName: 'Tenant', identity: 'tenant.test',
      identityVerifiedAt: NOW, identityCheckedAt: NOW, identityCheckError: null,
      configurationSet: 'marketing', snsTopicArn: 'arn:topic',
      snsSubscriptionEndpoint: 'https://tenant.test/api/webhooks/ses/webhook_token_123456789012345',
      snsSubscriptionConfirmedAt: NOW,
      trackingEnabled: false, autoPauseOnCritical: false,
      webhookToken: 'webhook_token_123456789012345', quotaRatePerSec: 10, quotaDaily: 1000,
      quotaSentLast24Hours: 0, quotaRefreshedAt: NOW, inSandbox: false, webhookVerifiedAt: NOW,
      footerLegalName: 'Tenant Ltd', footerAddress: 'Street 1, Warsaw', broadcastsEnabled: false,
      reputationAlertStatus: null, reputationAlertedAt: null,
    };
    const secrets = secretRepository(['ses.accessKeyId', 'ses.secretAccessKey', 'ses.region']);
    const pool = {
      usage: async () => ({ sent: 0, reserved: 0 }),
      reserve: async () => true,
      settle: async () => undefined,
    };
    const save = (snsTopicArn: string | null) => updateTenantSesMarketingSettings(ctx, {
      fromAddress: stored.fromAddress, fromName: stored.fromName, identity: stored.identity,
      configurationSet: stored.configurationSet, snsTopicArn,
      trackingEnabled: false, autoPauseOnCritical: false,
      footerLegalName: stored.footerLegalName, footerAddress: stored.footerAddress,
    }, {
      settings: new InMemoryTenantSesSettingsRepository([stored]), secrets,
      tokens: { nextToken: () => 'webhook_token_123456789012345' }, clock,
      webhookBaseUrl: async () => 'https://tenant.test/api/webhooks/ses',
      pool,
      snsDeliveries,
    });

    expect(await save(stored.snsTopicArn)).toMatchObject({
      ok: true,
      value: {
        settings: {
          snsSubscriptionEndpoint: stored.snsSubscriptionEndpoint,
          snsSubscriptionConfirmedAt: NOW,
        },
      },
    });
    expect(await save('arn:other-topic')).toMatchObject({
      ok: true,
      value: {
        settings: {
          snsSubscriptionEndpoint: null,
          snsSubscriptionConfirmedAt: null,
        },
      },
    });
  });

  it('flags a subscribed endpoint that no longer matches the tenant webhook address', async () => {
    const stored: TenantSesSettings = {
      tenantId: 'tenant-1', fromAddress: 'news@tenant.test', fromName: 'Tenant', identity: 'tenant.test',
      identityVerifiedAt: NOW, identityCheckedAt: NOW, identityCheckError: null,
      configurationSet: 'marketing', snsTopicArn: 'arn:topic',
      snsSubscriptionEndpoint: 'https://apex.test/api/webhooks/ses/webhook_token_123456789012345',
      snsSubscriptionConfirmedAt: NOW,
      trackingEnabled: false, autoPauseOnCritical: false,
      webhookToken: 'webhook_token_123456789012345', quotaRatePerSec: 10, quotaDaily: 1000,
      quotaSentLast24Hours: 0, quotaRefreshedAt: NOW, inSandbox: false, webhookVerifiedAt: NOW,
      footerLegalName: 'Tenant Ltd', footerAddress: 'Street 1, Warsaw', broadcastsEnabled: false,
      reputationAlertStatus: null, reputationAlertedAt: null,
    };
    const read = (settings: TenantSesSettings) => getTenantSesMarketingSettings(
      ctx,
      { webhookBaseUrl: async () => 'https://tenant.test/api/webhooks/ses' },
      {
        settings: new InMemoryTenantSesSettingsRepository([settings]),
        secrets: secretRepository(['ses.accessKeyId', 'ses.secretAccessKey', 'ses.region']),
        pool: {
          usage: async () => ({ sent: 0, reserved: 0 }),
          reserve: async () => true,
          settle: async () => undefined,
        },
        snsDeliveries,
      },
    );

    expect(await read(stored)).toMatchObject({
      ok: true,
      value: {
        webhookUrl: 'https://tenant.test/api/webhooks/ses/webhook_token_123456789012345',
        webhookEndpointStale: true,
      },
    });
    expect(await read({
      ...stored,
      snsSubscriptionEndpoint: 'https://tenant.test/api/webhooks/ses/webhook_token_123456789012345',
    })).toMatchObject({ ok: true, value: { webhookEndpointStale: false } });
  });

  it('reads secrets once and requires sender identity for SMTP and Resend readiness', async () => {
    const stored = secretRepository([
      'smtp.host',
      'smtp.port',
      'smtp.user',
      'smtp.password',
      'smtp.secure',
      'resend.apiKey',
    ]);
    let secretReads = 0;
    const secrets: TenantSecretRepository = {
      ...stored,
      listByTenant: async (tenantId) => {
        secretReads += 1;
        return stored.listByTenant(tenantId);
      },
    };
    const pool = {
      usage: async () => ({ sent: 0, reserved: 0 }),
      reserve: async () => true,
      settle: async () => undefined,
    };
    const settings = new InMemoryTenantSesSettingsRepository();

    const missingIdentity = await getTenantSesMarketingSettings(
      ctx,
      { webhookBaseUrl: async () => 'https://tenant.test/api/webhooks/ses' },
      { settings, secrets, pool, snsDeliveries },
    );

    expect(missingIdentity).toMatchObject({
      ok: true,
      value: { smtpConfigured: false, resendConfigured: false },
    });
    expect(secretReads).toBe(1);

    const configured = await updateTenantSesMarketingSettings(ctx, {
      fromAddress: 'news@tenant.test',
      fromName: 'Tenant',
      identity: 'tenant.test',
      configurationSet: null,
      snsTopicArn: null,
      trackingEnabled: false,
      autoPauseOnCritical: false,
      footerLegalName: 'Tenant Ltd',
      footerAddress: 'Street 1, Warsaw',
    }, {
      settings,
      secrets,
      tokens: { nextToken: () => 'webhook_token_123456789012345' },
      clock,
      webhookBaseUrl: async () => 'https://tenant.test/api/webhooks/ses',
      pool,
      snsDeliveries,
    });

    expect(configured).toMatchObject({
      ok: true,
      value: { smtpConfigured: true, resendConfigured: true },
    });
    expect(secretReads).toBe(2);
  });
});
