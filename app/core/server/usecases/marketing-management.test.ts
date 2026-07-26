import { describe, expect, it } from 'vitest';

import type {
  Campaign,
  ConsentDefinition,
  ConsentDefinitionVersion,
  Identity,
  TenantSecret,
  TenantSecretKey,
  TenantSesSettings,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type { TenantSecretRepository } from '../ports.js';
import {
  InMemoryCampaignRepository,
  InMemoryConsentDefinitionRepository,
  InMemoryEmailLayoutRepository,
  InMemoryMarketingAudienceRepository,
  InMemoryTenantDocumentRepository,
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
const ctx: Ctx = { identity: {
  userId: 'staff-1', email: 'staff@example.test', name: 'Staff', tenantId: 'tenant-1',
  tenantSlug: 'tenant', tenantName: 'Tenant', staffRole: 'owner', memberId: null,
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
  });

  it('derives readiness from credentials and onboarding state instead of persisted flags', async () => {
    const settings: TenantSesSettings = {
      tenantId: 'tenant-1', fromAddress: 'news@tenant.test', fromName: 'Tenant', identity: 'tenant.test',
      identityVerifiedAt: NOW, configurationSet: null, snsTopicArn: 'arn:topic',
      trackingEnabled: false,
      webhookToken: 'webhook_token_123456789012345', quotaRatePerSec: 10, quotaDaily: 1000,
      quotaSentLast24Hours: 0,
      quotaRefreshedAt: NOW, inSandbox: false, webhookVerifiedAt: NOW, footerLegalName: 'Tenant Ltd',
      footerAddress: 'Street 1, Warsaw', broadcastsEnabled: false,
    };
    const repository = new InMemoryTenantSesSettingsRepository([settings]);
    const secrets = secretRepository(['ses.accessKeyId', 'ses.secretAccessKey', 'ses.region']);
    const read = await getTenantSesMarketingSettings(ctx, { webhookBaseUrl: 'https://tenant.test/api/webhooks/ses' }, {
      settings: repository, secrets,
    });
    expect(read.ok && read.value.settings?.broadcastsEnabled).toBe(true);

    const sandboxed = await updateTenantSesMarketingSettings(ctx, {
      fromAddress: settings.fromAddress, fromName: settings.fromName, identity: settings.identity,
      identityVerified: true, configurationSet: 'marketing', snsTopicArn: settings.snsTopicArn,
      trackingEnabled: true,
      footerLegalName: settings.footerLegalName, footerAddress: settings.footerAddress,
    }, {
      settings: new InMemoryTenantSesSettingsRepository([{ ...settings, inSandbox: true }]), secrets,
      tokens: { nextToken: () => 'webhook_token_123456789012345' }, clock,
      webhookBaseUrl: 'https://tenant.test/api/webhooks/ses',
    });
    expect(sandboxed.ok && sandboxed.value.settings.broadcastsEnabled).toBe(false);
    expect(sandboxed.ok && sandboxed.value.settings.trackingEnabled).toBe(true);

    expect(await updateTenantSesMarketingSettings(ctx, {
      fromAddress: settings.fromAddress, fromName: settings.fromName, identity: settings.identity,
      identityVerified: true, configurationSet: null, snsTopicArn: settings.snsTopicArn,
      trackingEnabled: true,
      footerLegalName: settings.footerLegalName, footerAddress: settings.footerAddress,
    }, {
      settings: repository, secrets,
      tokens: { nextToken: () => 'webhook_token_123456789012345' }, clock,
      webhookBaseUrl: 'https://tenant.test/api/webhooks/ses',
    })).toMatchObject({ ok: false, error: { code: 'validation' } });

    const unrefreshed = await updateTenantSesMarketingSettings(ctx, {
      fromAddress: settings.fromAddress, fromName: settings.fromName, identity: settings.identity,
      identityVerified: true, configurationSet: null, snsTopicArn: settings.snsTopicArn,
      trackingEnabled: false,
      footerLegalName: settings.footerLegalName, footerAddress: settings.footerAddress,
    }, {
      settings: new InMemoryTenantSesSettingsRepository(), secrets,
      tokens: { nextToken: () => 'webhook_token_123456789012345' }, clock,
      webhookBaseUrl: 'https://tenant.test/api/webhooks/ses',
    });
    expect(unrefreshed).toMatchObject({
      ok: true,
      value: { settings: { inSandbox: true, quotaRefreshedAt: null, broadcastsEnabled: false } },
    });
  });
});
