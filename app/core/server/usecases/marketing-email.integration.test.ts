import { describe, expect, it } from 'vitest';

import {
  emailEventSchema,
  err,
  integrationAuth,
  ok,
  type Campaign,
  type ConsentDefinition,
  type ConsentDefinitionVersion,
  type MarketingConsent,
  type TenantSesSettings,
} from '@core/domain/index.js';
import {
  FakeEmailHmac,
  FakeSesMarketingSender,
  InMemoryAutomationIdempotencyRepository,
  InMemoryCampaignRepository,
  InMemoryCampaignSendRepository,
  InMemoryConsentConfirmationTokenRepository,
  InMemoryConsentDefinitionRepository,
  InMemoryEmailLayoutRepository,
  InMemoryEmailEventRepository,
  InMemoryEmailOutboxRepository,
  InMemoryMarketingAudienceRepository,
  InMemoryMarketingConsentRepository,
  InMemoryMarketingThrottleRepository,
  InMemorySchedulerRunRepository,
  InMemorySuppressionRepository,
  InMemoryTenantSesSettingsRepository,
  InMemoryUnsubscribeTokenRepository,
  FakeScheduler,
} from '../testing/marketing-fakes.js';
import type { Ctx } from '../context.js';
import type { SesMarketingQuotaReader } from '../ports.js';
import { removeMember } from './members.js';
import { dispatchEmailBatch } from './dispatch-email-batch.js';
import {
  addManualSuppression,
  applyVerifiedSesEvent,
  cancelCampaign,
  campaignTick,
  claimIdempotencyKey,
  completeIdempotentRequest,
  confirmMarketingConsent,
  createCampaign,
  deleteCampaign,
  getMarketingEligibility,
  getCampaign,
  getCampaignWithEngagement,
  getUnsubscribePreferences,
  listCampaigns,
  listCampaignsWithEngagement,
  liftMarketingSuppression,
  pauseCampaign,
  recordMarketingConsent,
  runMarketingRetentionJobs,
  runScheduledMarketingJobs,
  saveMarketingConsentPreferences,
  scheduleCampaign,
  scheduleMarketingRetentionJobs,
  sendMarketingMessages,
  testSendCampaignToSelf,
  unsubscribeAllMarketing,
  unsubscribeOneClick,
  withdrawMarketingConsent,
} from './marketing-email.js';

const NOW = '1998-07-22T10:00:00.000Z';
const ctx: Ctx = { identity: {
  userId: 'staff-1', email: 'staff@example.test', name: 'Staff', tenantId: 'tenant-1',
  tenantSlug: 'tenant', tenantName: 'Tenant', staffRole: 'owner', memberId: null,
} };
const anonymousCtx: Ctx = { identity: {
  userId: 'anonymous', email: 'anonymous@invalid.test', name: 'Anonymous', tenantId: 'tenant-1',
  tenantSlug: 'tenant', tenantName: 'Tenant', staffRole: null, memberId: null,
} };
const clock = { nowIso: () => NOW };
const ids = (() => { let value = 0; return { nextId: () => `generated-${String(++value)}` }; })();
const tokens = (() => { let value = 0; return { nextToken: () => `token_${String(++value).padStart(26, '0')}` }; })();

const definition: ConsentDefinition = {
  id: 'definition-1', tenantId: 'tenant-1', key: 'newsletter', kind: 'optional_marketing',
  channel: 'email', doubleOptIn: true, documentRef: { mode: 'url', url: 'https://tenant.test/privacy' },
  status: 'active', createdAt: NOW, updatedAt: NOW,
};
const version: ConsentDefinitionVersion = {
  id: 'version-1', tenantId: 'tenant-1', definitionId: definition.id, version: 1,
  label: 'I want the newsletter', documentVersionRef: { mode: 'url', url: 'https://tenant.test/privacy?v=1' },
  createdAt: NOW, createdBy: 'staff-1',
};
const consent = (email: string, status: MarketingConsent['status'] = 'confirmed', id = `consent-${email}`): MarketingConsent => ({
  id, tenantId: 'tenant-1', memberId: `member-${email}`, email, definitionId: definition.id,
  definitionVersion: 1, wordingSnapshot: version.label, documentRefSnapshot: version.documentVersionRef,
  status, previousId: null, source: 'api', evidence: { collectedAt: NOW, proofRef: 'form-1' }, occurredAt: NOW,
});
const settings: TenantSesSettings = {
  tenantId: 'tenant-1', fromAddress: 'news@tenant.test', fromName: 'Tenant', identity: 'tenant.test',
  identityVerifiedAt: NOW, configurationSet: 'marketing', snsTopicArn: 'arn:topic:tenant-1',
  trackingEnabled: true,
  autoPauseOnCritical: false,
  webhookToken: 'webhook_token_123456789012345', quotaRatePerSec: 10, quotaDaily: 1000,
  quotaRefreshedAt: NOW, inSandbox: false, webhookVerifiedAt: NOW, footerLegalName: 'Tenant Legal Ltd',
  quotaSentLast24Hours: 0,
  footerAddress: 'Street 1, Warsaw; contact@tenant.test', broadcastsEnabled: true,
};
const campaign = (overrides: Partial<Campaign> = {}): Campaign => ({
  id: 'campaign-1', tenantId: 'tenant-1', name: 'Weekly', subject: 'Hello {{member.email}}',
  bodyHtml: '<p>Welcome {{member.email}}</p>', bodySource: '<p>Welcome {{member.email}}</p>', layoutId: null,
  consentDefinitionId: definition.id, audienceFilter: null, status: 'running', sendAt: null,
  snapshotMaxMemberId: 'member-z', cursorMemberId: null, toSend: 1, sent: 0, failed: 0,
  lockedUntil: null, lockedBy: null, errorCount: 0, pausedReason: null, audienceNameSnapshot: 'All',
  consentLabelSnapshot: version.label, startedAt: NOW, finishedAt: null, createdAt: NOW, ...overrides,
});

const setup = async (emails = ['member@example.test']) => {
  const definitions = new InMemoryConsentDefinitionRepository();
  await definitions.create('tenant-1', definition, version);
  const consents = new InMemoryMarketingConsentRepository();
  let quotaReader: SesMarketingQuotaReader | undefined;
  for (const email of emails) await consents.record('tenant-1', consent(email));
  const events = new InMemoryEmailEventRepository();
  return {
    definitions, consents, confirmations: new InMemoryConsentConfirmationTokenRepository(),
    suppressions: new InMemorySuppressionRepository(events), unsubscribes: new InMemoryUnsubscribeTokenRepository(events),
    sends: new InMemoryCampaignSendRepository(events), campaigns: new InMemoryCampaignRepository([campaign()]),
    layouts: new InMemoryEmailLayoutRepository(),
    audience: new InMemoryMarketingAudienceRepository(emails.map((email, index) => ({
      memberId: `member-${String(index + 1)}`, email, displayName: null, productIds: [],
    }))),
    sesSettings: new InMemoryTenantSesSettingsRepository([settings]), ses: new FakeSesMarketingSender(),
    hmac: new FakeEmailHmac(), events, outbox: new InMemoryEmailOutboxRepository(events), clock, ids, tokens,
    throttle: new InMemoryMarketingThrottleRepository(),
    scheduler: new FakeScheduler(),
    runs: new InMemorySchedulerRunRepository(),
    credentials: { resolve: async () => ok({ accessKeyId: 'AKIA', secretAccessKey: 'secret', region: 'eu-central-1' }) },
    quotaReader,
    unsubscribeBaseUrl: 'https://tenant.test/u',
  };
};

describe('marketing e-mail use-case integration', () => {
  it('records a completed tick with tenant budgets and links sends and events to the run', async () => {
    const deps = await setup();
    const result = await campaignTick(ctx, {
      campaignId: 'campaign-1',
      workerId: 'worker-1',
      tickSeconds: 1,
      trigger: 'cron',
    }, deps);
    expect(result).toMatchObject({ ok: true, value: { sent: 1, failed: 0, skipped: 0 } });
    const page = await deps.runs.listForTenant('tenant-1', { limit: 10 });
    const runs = page.items.map((item) => item.run);
    expect(runs).toHaveLength(1);
    const runId = runs[0]?.id ?? '';
    expect(await deps.runs.getWithTenants(runId)).toMatchObject({
      run: {
        kind: 'marketing_tick',
        trigger: 'cron',
        status: 'completed',
        totals: {
          campaignsTouched: 1,
          sendsAttempted: 1,
          sent: 1,
          failed: 0,
          skipped: 0,
          reEnqueued: false,
        },
      },
      tenants: [{
        tenantId: 'tenant-1',
        campaignsTouched: 1,
        batchSize: 1,
        sent: 1,
        failed: 0,
        skipped: 0,
        budgetComputed: 10,
        budgetUsed: 1,
      }],
    });
    const [send] = await deps.sends.listByCampaign('tenant-1', 'campaign-1');
    expect(send?.runId).toBe(runId);
    expect(await deps.events.listByRef('tenant-1', 'marketing', send?.id ?? '')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'accepted', meta: expect.objectContaining({ runId }) }),
      ]),
    );
  });

  it('finalizes a tick as failed when execution throws', async () => {
    const deps = await setup();
    deps.audience.afterFetch = () => {
      throw new Error('Audience unavailable');
    };
    await expect(campaignTick(ctx, {
      campaignId: 'campaign-1',
      workerId: 'worker-1',
      tickSeconds: 1,
      trigger: 'dev',
    }, deps)).rejects.toThrow('Audience unavailable');
    const page = await deps.runs.listForTenant('tenant-1', { limit: 10 });
    const runs = page.items.map((item) => item.run);
    expect(runs).toHaveLength(1);
    expect(await deps.runs.getWithTenants(runs[0]?.id ?? '')).toMatchObject({
      run: {
        trigger: 'dev',
        status: 'failed',
        error: 'Audience unavailable',
        totals: { campaignsTouched: 1, sendsAttempted: 0 },
      },
      tenants: [{ tenantId: 'tenant-1', budgetComputed: 10, budgetUsed: 0 }],
    });
  });

  it('records the exact happy broadcast lifecycle sequence', async () => {
    const deps = await setup();
    const result = await sendMarketingMessages(ctx, [{
      to: 'member@example.test',
      memberId: 'member-1',
      campaignId: 'campaign-1',
      source: 'broadcast',
      consentDefinitionId: definition.id,
      subject: 'Hello',
      bodyHtml: '<p>Content</p>',
      data: {},
    }], deps);
    if (!result.ok || result.value[0]?.status !== 'sent') throw new Error('Expected a sent marketing message');
    expect((await deps.events.listByRef('tenant-1', 'marketing', result.value[0].sendId)).map((event) => event.type))
      .toEqual(['queued', 'claimed', 'rendered', 'accepted']);
  });

  it('records an exact skip event for a suppressed broadcast recipient', async () => {
    const deps = await setup();
    await addManualSuppression(ctx, { email: 'member@example.test', sourceRef: 'staff-1' }, deps);
    const result = await sendMarketingMessages(ctx, [{
      to: 'member@example.test',
      memberId: 'member-1',
      campaignId: 'campaign-1',
      source: 'broadcast',
      consentDefinitionId: definition.id,
      subject: 'Hello',
      bodyHtml: '<p>Content</p>',
      data: {},
    }], deps);
    if (!result.ok || result.value[0]?.status !== 'skipped' || result.value[0].sendId === null) {
      throw new Error('Expected a skipped marketing message');
    }
    expect((await deps.events.listByRef('tenant-1', 'marketing', result.value[0].sendId)).map((event) => event.type))
      .toEqual(['skipped']);
  });

  it('derives send readiness instead of trusting a stale persisted flag', async () => {
    const deps = await setup();
    deps.sesSettings = new InMemoryTenantSesSettingsRepository([{ ...settings, broadcastsEnabled: false }]);
    const result = await sendMarketingMessages(ctx, [{
      to: 'member@example.test', memberId: 'member-1', campaignId: 'campaign-1', source: 'broadcast',
      consentDefinitionId: definition.id, subject: 'Hello', bodyHtml: '<p>Content</p>', data: {},
    }], deps);
    expect(result.ok).toBe(true);
    expect(deps.ses.sent).toHaveLength(1);
  });

  it('M28 enforces one shared rate bucket and the cached SES daily remainder across API requests', async () => {
    const deps = await setup(['one@example.test', 'two@example.test']);
    await deps.sesSettings.upsert('tenant-1', { ...settings, quotaRatePerSec: 1 });
    const first = await sendMarketingMessages(ctx, [{
      to: 'one@example.test', memberId: null, campaignId: null, source: 'api',
      consentDefinitionId: definition.id, subject: 'One', bodyHtml: '<p>One</p>', data: {},
    }], deps);
    const second = await sendMarketingMessages(ctx, [{
      to: 'two@example.test', memberId: null, campaignId: null, source: 'api',
      consentDefinitionId: definition.id, subject: 'Two', bodyHtml: '<p>Two</p>', data: {},
    }], deps);
    expect(first).toMatchObject({ ok: true, value: [{ status: 'sent' }] });
    expect(second).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    expect(deps.ses.sent).toHaveLength(1);

    const dailyDeps = await setup();
    await dailyDeps.sesSettings.upsert('tenant-1', { ...settings, quotaSentLast24Hours: settings.quotaDaily });
    expect(await sendMarketingMessages(ctx, [{
      to: 'member@example.test', memberId: null, campaignId: null, source: 'api',
      consentDefinitionId: definition.id, subject: 'Daily', bodyHtml: '<p>Daily</p>', data: {},
    }], dailyDeps)).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
  });

  it('refreshes SES quota before the first API send and refuses a sandbox account', async () => {
    const deps = await setup();
    await deps.sesSettings.upsert('tenant-1', {
      ...settings, quotaRefreshedAt: null, inSandbox: true,
    });
    deps.quotaReader = {
      read: async () => ok({ ratePerSecond: 20, daily: 1972, sentLast24Hours: 25, inSandbox: true }),
    };
    const result = await sendMarketingMessages(ctx, [{
      to: 'member@example.test', memberId: null, campaignId: null, source: 'api',
      consentDefinitionId: definition.id, subject: 'Sandbox', bodyHtml: '<p>Sandbox</p>', data: {},
    }], deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'broadcasts_disabled' } });
    expect(await deps.sesSettings.findByTenant('tenant-1')).toMatchObject({
      quotaRatePerSec: 20, quotaDaily: 1972, quotaSentLast24Hours: 25,
      quotaRefreshedAt: NOW, inSandbox: true,
    });
    expect(deps.ses.sent).toHaveLength(0);
  });

  it('I1 uses one parity path for broadcast and API sends, including identical refusals', async () => {
    const deps = await setup(['broadcast@example.test', 'api@example.test']);
    const broadcast = await sendMarketingMessages(ctx, [{
      to: 'broadcast@example.test', memberId: 'member-1', campaignId: 'campaign-1', source: 'broadcast',
      consentDefinitionId: definition.id, subject: 'Hello', bodyHtml: '<p>Content</p>', data: {},
    }], deps);
    const api = await sendMarketingMessages(ctx, [{
      to: 'api@example.test', memberId: 'member-2', campaignId: null, source: 'api',
      consentDefinitionId: definition.id, subject: 'Hello', bodyHtml: '<p>Content</p>', data: {},
    }], deps);
    expect(broadcast.ok && api.ok).toBe(true);
    expect(deps.ses.sent).toHaveLength(2);
    expect({ ...deps.ses.sent[0]?.headers, 'List-Unsubscribe': '<TOKEN>' }).toEqual({ ...deps.ses.sent[1]?.headers, 'List-Unsubscribe': '<TOKEN>' });
    expect(deps.ses.sent[0]?.html.replace(/token_[0-9]+/g, 'TOKEN')).toBe(deps.ses.sent[1]?.html.replace(/token_[0-9]+/g, 'TOKEN'));
    const rows = await deps.sends.listAll('tenant-1');
    const comparable = rows.map((row) => ({
      consentRowId: row.consentRowId === '' ? '' : '<CONSENT>', status: row.status, skipReason: row.skipReason,
      deliveryStatus: row.deliveryStatus, deliveryOccurredAt: row.deliveryOccurredAt,
      idempotencySource: row.idempotencySource, renderedBodyPurgedAt: row.renderedBodyPurgedAt,
      createdAt: row.createdAt, sentAt: row.sentAt,
    }));
    expect(rows.map((row) => row.source)).toEqual(['broadcast', 'api']);
    expect(comparable[0]).toEqual(comparable[1]);

    await withdrawMarketingConsent(ctx, { email: 'api@example.test', definitionId: definition.id, evidence: { collectedAt: NOW } }, deps);
    const refused = await sendMarketingMessages(ctx, [{
      to: 'api@example.test', memberId: 'member-2', campaignId: null, source: 'api', consentDefinitionId: definition.id,
      subject: 'No', bodyHtml: '<p>No</p>', data: {},
    }], deps);
    expect(refused).toMatchObject({ ok: true, value: [{ status: 'skipped', reason: 'unsubscribed' }] });
  });

  it('attaches the tenant configuration set only when tracking is enabled', async () => {
    const enabled = await setup();
    await sendMarketingMessages(ctx, [{
      to: 'member@example.test', memberId: 'member-1', campaignId: 'campaign-1',
      source: 'broadcast', consentDefinitionId: definition.id, subject: 'Tracked',
      bodyHtml: '<p>Tracked</p>', data: {},
    }], enabled);
    expect(enabled.ses.sent[0]?.configurationSet).toBe('marketing');

    const disabled = await setup();
    await disabled.sesSettings.upsert('tenant-1', { ...settings, trackingEnabled: false });
    await sendMarketingMessages(ctx, [{
      to: 'member@example.test', memberId: 'member-1', campaignId: 'campaign-1',
      source: 'broadcast', consentDefinitionId: definition.id, subject: 'Private',
      bodyHtml: '<p>Private</p>', data: {},
    }], disabled);
    expect(disabled.ses.sent[0]?.configurationSet).toBeNull();
  });

  it('I1 refuses broadcast and API messages with the same machine-readable reason matrix', async () => {
    const cases: Array<{ reason: 'suppressed' | 'unsubscribed' | 'pending_confirmation' | 'not_consented'; prepare(deps: Awaited<ReturnType<typeof setup>>, emails: string[]): Promise<void> }> = [
      { reason: 'suppressed', prepare: async (deps, emails) => { for (const email of emails) await addManualSuppression(ctx, { email, sourceRef: 'staff-1' }, deps); } },
      { reason: 'unsubscribed', prepare: async (deps, emails) => { for (const email of emails) await withdrawMarketingConsent(ctx, { email, definitionId: definition.id, evidence: { collectedAt: NOW } }, deps); } },
      { reason: 'pending_confirmation', prepare: async (deps, emails) => { for (const email of emails) await deps.consents.record('tenant-1', consent(email, 'granted', `pending-${email}`)); } },
      { reason: 'not_consented', prepare: async () => undefined },
    ];
    for (const item of cases) {
      const emails = [`broadcast-${item.reason}@example.test`, `api-${item.reason}@example.test`];
      const deps = await setup(item.reason === 'not_consented' ? [] : emails);
      await item.prepare(deps, emails);
      const result = await sendMarketingMessages(ctx, [
        { to: emails[0] ?? '', memberId: 'member-broadcast', campaignId: 'campaign-1', source: 'broadcast', consentDefinitionId: definition.id, subject: 'No', bodyHtml: '<p>No</p>', data: {} },
        { to: emails[1] ?? '', memberId: 'member-api', campaignId: null, source: 'api', consentDefinitionId: definition.id, subject: 'No', bodyHtml: '<p>No</p>', data: {} },
      ], deps);
      expect(result).toMatchObject({ ok: true, value: [{ status: 'skipped', reason: item.reason }, { status: 'skipped', reason: item.reason }] });
      expect(deps.ses.sent).toHaveLength(0);
    }
  });

  it('M28 sends every API drip step sharing a campaign when idempotency keys differ', async () => {
    const deps = await setup();
    const results = [];
    for (const idempotencySource of ['drip0-order-1', 'drip3-order-1', 'drip7-order-1']) {
      results.push(await sendMarketingMessages(ctx, [{
        to: 'member@example.test', memberId: 'member-1', campaignId: 'campaign-1', source: 'api',
        consentDefinitionId: definition.id, subject: idempotencySource, bodyHtml: '<p>Drip step</p>',
        data: {}, idempotencySource,
      }], deps));
    }
    expect(results).toMatchObject([
      { ok: true, value: [{ status: 'sent' }] },
      { ok: true, value: [{ status: 'sent' }] },
      { ok: true, value: [{ status: 'sent' }] },
    ]);
    expect(deps.ses.sent).toHaveLength(3);
    expect(await deps.sends.listByCampaign('tenant-1', 'campaign-1')).toHaveLength(3);
  });

  it('M32 composes campaign content through the tenant layout content slot', async () => {
    const deps = await setup();
    await deps.layouts.create('tenant-1', {
      id: 'layout-1', tenantId: 'tenant-1', name: 'Branded',
      bodyHtml: '<html><body><header>{{tenant.name}}</header><main>{{{content}}}</main></body></html>',
      createdAt: NOW, updatedAt: NOW,
    });
    const result = await sendMarketingMessages(ctx, [{
      to: 'member@example.test', memberId: 'member-1', campaignId: 'campaign-1', source: 'broadcast',
      consentDefinitionId: definition.id, subject: 'Hello', bodyHtml: '<p>Campaign content</p>',
      layoutId: 'layout-1', data: {},
    }], deps);
    expect(result).toMatchObject({ ok: true, value: [{ status: 'sent' }] });
    expect(deps.ses.sent[0]?.html).toContain('<header>Tenant</header><main><p>Campaign content</p>');
    expect(deps.ses.sent[0]?.html).toContain('</main></body></html>');
  });

  it('I2 and I3 re-check eligibility after fetch and again after claim', async () => {
    const deps = await setup(['first@example.test', 'later@example.test']);
    deps.audience.afterFetch = async (rows) => {
      const later = rows.find((row) => row.email === 'later@example.test');
      if (later) await addManualSuppression(ctx, { email: later.email, sourceRef: 'staff-1' }, deps);
    };
    deps.sends.afterClaim = async (send) => {
      if (send.email === 'first@example.test') {
        await withdrawMarketingConsent(ctx, { email: send.email, definitionId: definition.id, evidence: { collectedAt: NOW } }, deps);
      }
    };
    const result = await campaignTick(ctx, { campaignId: 'campaign-1', workerId: 'worker-1', tickSeconds: 1 }, deps);
    expect(result).toMatchObject({ ok: true, value: { sent: 0, skipped: 2 } });
    expect((await deps.sends.listByCampaign('tenant-1', 'campaign-1')).map((row) => row.skipReason).sort())
      .toEqual(['suppressed', 'unsubscribed']);
    const withdrawn = (await deps.sends.listByCampaign('tenant-1', 'campaign-1'))
      .find((send) => send.email === 'first@example.test');
    expect(withdrawn).toBeDefined();
    expect((await deps.events.listByRef('tenant-1', 'marketing', withdrawn?.id ?? '')).map((event) => event.type))
      .toEqual(['queued', 'claimed', 'skipped']);
  });

  it('I2 skips a recipient changed between keyset batches and records the reason', async () => {
    const deps = await setup(['first@example.test', 'later@example.test']);
    await deps.sesSettings.upsert('tenant-1', { ...settings, quotaRatePerSec: 1 });
    await deps.campaigns.update('tenant-1', { ...campaign(), toSend: 2 });
    await campaignTick(ctx, { campaignId: 'campaign-1', workerId: 'first', tickSeconds: 1 }, deps);
    await addManualSuppression(ctx, { email: 'later@example.test', sourceRef: 'staff-1' }, deps);
    const current = await deps.campaigns.findById('tenant-1', 'campaign-1');
    if (current === null) throw new Error('Campaign fixture is missing');
    await deps.campaigns.update('tenant-1', { ...current, lockedUntil: null });
    deps.throttle = new InMemoryMarketingThrottleRepository();
    const second = await campaignTick(ctx, { campaignId: 'campaign-1', workerId: 'second', tickSeconds: 1 }, deps);
    expect(second).toMatchObject({ ok: true, value: { skipped: 1 } });
    expect(await deps.sends.listByCampaign('tenant-1', 'campaign-1')).toMatchObject([
      { email: 'first@example.test', status: 'sent' },
      { email: 'later@example.test', status: 'skipped', skipReason: 'suppressed' },
    ]);
  });

  it('I4 deduplicates replayed ticks including a stale cursor after a successful send', async () => {
    const deps = await setup();
    await campaignTick(ctx, { campaignId: 'campaign-1', workerId: 'worker-1', tickSeconds: 1 }, deps);
    await deps.campaigns.update('tenant-1', campaign({ lockedUntil: null, cursorMemberId: null }));
    await campaignTick(ctx, { campaignId: 'campaign-1', workerId: 'worker-2', tickSeconds: 1 }, deps);
    expect(deps.ses.sent).toHaveLength(1);
  });

  it('I5 permits one concurrent lease holder and allows stealing an expired lease', async () => {
    const deps = await setup();
    const [first, second] = await Promise.all([
      campaignTick(ctx, { campaignId: 'campaign-1', workerId: 'one', tickSeconds: 1 }, deps),
      campaignTick(ctx, { campaignId: 'campaign-1', workerId: 'two', tickSeconds: 1 }, deps),
    ]);
    expect([first, second].filter((result) => result.ok && result.value.leased)).toHaveLength(1);
    await deps.campaigns.update('tenant-1', campaign({ lockedUntil: '1998-07-22T09:59:59.000Z' }));
    await expect(campaignTick(ctx, { campaignId: 'campaign-1', workerId: 'three', tickSeconds: 1 }, deps))
      .resolves.toMatchObject({ ok: true, value: { leased: true } });
  });

  it('I6 claims idempotency before execution, releases 4xx, retains 5xx, and sweeps TTL', async () => {
    const repository = new InMemoryAutomationIdempotencyRepository();
    const input = { key: 'same-key', method: 'POST', path: '/api/m2m/marketing/messages', requestHash: 'hash', ttlSeconds: 60 };
    const [first, duplicate] = await Promise.all([
      claimIdempotencyKey(ctx, input, { repository, ids, clock }),
      claimIdempotencyKey(ctx, input, { repository, ids, clock }),
    ]);
    expect([first, duplicate].filter((result) => result.ok)).toHaveLength(1);
    expect([first, duplicate].find((result) => !result.ok)).toMatchObject({ ok: false, error: { code: 'conflict', details: { requestMethod: 'POST' } } });
    await completeIdempotentRequest(ctx, { key: input.key, status: 400 }, { repository });
    expect((await claimIdempotencyKey(ctx, input, { repository, ids, clock })).ok).toBe(true);
    await completeIdempotentRequest(ctx, { key: input.key, status: 500 }, { repository });
    expect((await claimIdempotencyKey(ctx, input, { repository, ids, clock })).ok).toBe(false);
    expect(await repository.sweepExpired('1998-07-22T10:01:01.000Z')).toBe(1);
  });

  it('I7 auto-pauses after consecutive SES authentication failures and can resume from its cursor', async () => {
    const deps = await setup(['one@example.test', 'two@example.test', 'three@example.test']);
    await deps.sesSettings.upsert('tenant-1', { ...settings, quotaRatePerSec: 1 });
    await deps.campaigns.update('tenant-1', { ...campaign(), toSend: 3 });
    deps.ses.result = err(integrationAuth('bad SES key'));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      deps.throttle = new InMemoryMarketingThrottleRepository();
      const current = await deps.campaigns.findById('tenant-1', 'campaign-1');
      if (current === null) throw new Error('Campaign fixture is missing');
      await deps.campaigns.update('tenant-1', { ...current, lockedUntil: null });
      await campaignTick(ctx, { campaignId: 'campaign-1', workerId: `worker-${String(attempt)}`, tickSeconds: 1, errorThreshold: 3 }, deps);
    }
    expect(await deps.campaigns.findById('tenant-1', 'campaign-1')).toMatchObject({ status: 'paused', pausedReason: 'bad SES key' });
    expect((await pauseCampaign(ctx, { campaignId: 'campaign-1', resume: true }, deps)).ok).toBe(true);
  });

  it('pauses a running campaign before sending when critical reputation auto-pause is enabled', async () => {
    const deps = await setup();
    await deps.sesSettings.upsert('tenant-1', { ...settings, autoPauseOnCritical: true });
    for (let index = 0; index < 100; index += 1) {
      const occurredAt = '1998-07-21T10:00:00.000Z';
      await deps.events.append('tenant-1', emailEventSchema.parse({
        id: `accepted-reputation-${String(index)}`,
        tenantId: 'tenant-1',
        mailKind: 'marketing',
        refId: `reputation-send-${String(index)}`,
        type: 'accepted',
        occurredAt,
        createdAt: occurredAt,
        meta: { sesMessageId: `ses-reputation-${String(index)}` },
      }));
    }
    for (let index = 0; index < 10; index += 1) {
      const occurredAt = '1998-07-21T11:00:00.000Z';
      await deps.events.append('tenant-1', emailEventSchema.parse({
        id: `bounce-reputation-${String(index)}`,
        tenantId: 'tenant-1',
        mailKind: 'marketing',
        refId: `reputation-send-${String(index)}`,
        type: 'bounced',
        occurredAt,
        createdAt: occurredAt,
        meta: { classification: 'hard', rawProviderPayload: {} },
      }));
    }

    const result = await campaignTick(ctx, {
      campaignId: 'campaign-1',
      workerId: 'reputation-worker',
      tickSeconds: 1,
    }, deps);

    expect(result).toMatchObject({ ok: true, value: { leased: true, sent: 0 } });
    expect(deps.ses.sent).toHaveLength(0);
    expect(await deps.campaigns.findById('tenant-1', 'campaign-1')).toMatchObject({
      status: 'paused',
      pausedReason: 'Broadcasts paused automatically: critical email reputation threshold exceeded',
      lockedUntil: null,
      lockedBy: null,
    });
  });

  it('I7 resets the consecutive error count after a successful send', async () => {
    const deps = await setup(['one@example.test', 'two@example.test', 'three@example.test']);
    await deps.sesSettings.upsert('tenant-1', { ...settings, quotaRatePerSec: 1 });
    await deps.campaigns.update('tenant-1', { ...campaign(), toSend: 3 });
    deps.ses.result = err(integrationAuth('bad SES key'));
    await campaignTick(ctx, { campaignId: 'campaign-1', workerId: 'one', tickSeconds: 1, errorThreshold: 2 }, deps);
    let current = await deps.campaigns.findById('tenant-1', 'campaign-1');
    if (current === null) throw new Error('Campaign fixture is missing');
    deps.ses.result = ok({ messageId: 'recovered' });
    await deps.campaigns.update('tenant-1', { ...current, lockedUntil: null });
    deps.throttle = new InMemoryMarketingThrottleRepository();
    await campaignTick(ctx, { campaignId: 'campaign-1', workerId: 'two', tickSeconds: 1, errorThreshold: 2 }, deps);
    current = await deps.campaigns.findById('tenant-1', 'campaign-1');
    expect(current).toMatchObject({ status: 'running', errorCount: 0, pausedReason: null });
    if (current === null) throw new Error('Campaign fixture is missing');
    deps.ses.result = err(integrationAuth('bad SES key'));
    await deps.campaigns.update('tenant-1', { ...current, lockedUntil: null });
    deps.throttle = new InMemoryMarketingThrottleRepository();
    await campaignTick(ctx, { campaignId: 'campaign-1', workerId: 'three', tickSeconds: 1, errorThreshold: 2 }, deps);
    expect(await deps.campaigns.findById('tenant-1', 'campaign-1')).toMatchObject({ status: 'running', errorCount: 1 });
  });

  it('I8 finalizes when all claimed rows are terminal, including failures', async () => {
    const deps = await setup();
    deps.ses.result = err(integrationAuth('bad SES key'));
    await campaignTick(ctx, { campaignId: 'campaign-1', workerId: 'worker', tickSeconds: 1, errorThreshold: 99 }, deps);
    expect(await deps.campaigns.findById('tenant-1', 'campaign-1')).toMatchObject({ status: 'finished', sent: 0, failed: 1, finishedAt: NOW });
  });

  it('I8 finishes a due campaign with an empty audience', async () => {
    const deps = await setup([]);
    await deps.campaigns.update('tenant-1', campaign({ status: 'scheduled', sendAt: NOW, snapshotMaxMemberId: null, toSend: 0, startedAt: null }));
    expect(await campaignTick(ctx, { campaignId: 'campaign-1', workerId: 'worker', tickSeconds: 1 }, deps)).toMatchObject({ ok: true, value: { leased: true } });
    expect(await deps.campaigns.findById('tenant-1', 'campaign-1')).toMatchObject({ status: 'finished', startedAt: NOW, finishedAt: NOW });
  });

  it('I9 correlates verified SES events and never throws processing failures outward', async () => {
    const deps = await setup();
    await sendMarketingMessages(ctx, [{ to: 'member@example.test', memberId: 'member-1', campaignId: 'campaign-1', source: 'broadcast', consentDefinitionId: definition.id, subject: 'Hi', bodyHtml: '<p>Hi</p>', data: {} }], deps);
    const topicArn = 'arn:topic:tenant-1';
    const hard = await applyVerifiedSesEvent(ctx, { topicArn, messageId: 'fake-ses-message', kind: 'bounce', bounceType: 'Permanent', status: null, occurredAt: NOW, raw: { event: 1 } }, deps);
    expect(hard).toEqual(ok({ processed: true }));
    const send = await deps.sends.correlateBySesMessageId('tenant-1', 'fake-ses-message');
    expect((await deps.events.listByRef('tenant-1', 'marketing', send?.id ?? '')).map((item) => item.type))
      .toEqual(['queued', 'claimed', 'rendered', 'accepted', 'bounced', 'suppressed_written']);
    expect(await deps.suppressions.isSuppressed('tenant-1', deps.hmac.compute('tenant-1', 'member@example.test'))).toBe(true);
    const missing = await applyVerifiedSesEvent(ctx, { topicArn, messageId: 'unknown', kind: 'complaint', occurredAt: NOW, raw: {} }, deps);
    expect(missing).toEqual(ok({ processed: false }));
    const mismatch = await applyVerifiedSesEvent(ctx, { topicArn: 'wrong', messageId: 'unknown', kind: 'complaint', occurredAt: NOW, raw: {} }, deps);
    expect(mismatch).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('I9 records soft bounces without suppression and complaints permanently suppress', async () => {
    const deps = await setup(['soft@example.test', 'complaint@example.test']);
    await sendMarketingMessages(ctx, [{ to: 'soft@example.test', memberId: 'member-1', campaignId: null, source: 'api', consentDefinitionId: definition.id, subject: 'Hi', bodyHtml: '<p>Hi</p>', data: {} }], deps);
    await sendMarketingMessages(ctx, [{ to: 'complaint@example.test', memberId: 'member-2', campaignId: null, source: 'api', consentDefinitionId: definition.id, subject: 'Hi', bodyHtml: '<p>Hi</p>', data: {} }], deps);
    expect(await applyVerifiedSesEvent(ctx, { topicArn: settings.snsTopicArn ?? '', messageId: 'fake-ses-message', kind: 'bounce', bounceType: 'Transient', status: '4.2.2', occurredAt: NOW, raw: {} }, deps)).toEqual(ok({ processed: true }));
    expect(await deps.suppressions.isSuppressed('tenant-1', deps.hmac.compute('tenant-1', 'soft@example.test'))).toBe(false);
    expect(await applyVerifiedSesEvent(ctx, { topicArn: settings.snsTopicArn ?? '', messageId: 'fake-ses-message-2', kind: 'complaint', occurredAt: NOW, raw: {} }, deps)).toEqual(ok({ processed: true }));
    const complaint = await deps.suppressions.findActive('tenant-1', deps.hmac.compute('tenant-1', 'complaint@example.test'));
    expect(complaint).toMatchObject({ reason: 'complaint' });
    expect(await liftMarketingSuppression(ctx, { suppressionId: complaint?.id ?? '', actorId: 'staff-1' }, deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('I9 records successful SES delivery by MessageId without suppression', async () => {
    const deps = await setup();
    await sendMarketingMessages(ctx, [{ to: 'member@example.test', memberId: 'member-1', campaignId: null, source: 'api', consentDefinitionId: definition.id, subject: 'Hi', bodyHtml: '<p>Hi</p>', data: {} }], deps);
    expect(await applyVerifiedSesEvent(ctx, { topicArn: settings.snsTopicArn ?? '', messageId: 'fake-ses-message', kind: 'delivery', occurredAt: NOW, raw: {} }, deps)).toEqual(ok({ processed: true }));
    expect(await deps.sends.correlateBySesMessageId('tenant-1', 'fake-ses-message')).toMatchObject({ deliveryStatus: 'delivered', deliveryOccurredAt: NOW });
    expect(await deps.suppressions.isSuppressed('tenant-1', deps.hmac.compute('tenant-1', 'member@example.test'))).toBe(false);
  });

  it('records SES opens and clicks on the correlated marketing send', async () => {
    const deps = await setup();
    await sendMarketingMessages(ctx, [{
      to: 'member@example.test', memberId: 'member-1', campaignId: 'campaign-1',
      source: 'broadcast', consentDefinitionId: definition.id, subject: 'Hi',
      bodyHtml: '<p>Hi</p>', data: {},
    }], deps);
    const topicArn = settings.snsTopicArn ?? '';
    expect(await applyVerifiedSesEvent(ctx, {
      topicArn, messageId: 'fake-ses-message', kind: 'open',
      occurredAt: NOW, raw: { open: { ipAddress: '192.0.2.1' } },
    }, deps)).toEqual(ok({ processed: true }));
    expect(await applyVerifiedSesEvent(ctx, {
      topicArn, messageId: 'fake-ses-message', kind: 'click',
      linkUrl: 'https://tenant.test/offer', occurredAt: NOW,
      raw: { click: { link: 'https://tenant.test/offer' } },
    }, deps)).toEqual(ok({ processed: true }));
    const send = await deps.sends.correlateBySesMessageId('tenant-1', 'fake-ses-message');
    expect((await deps.events.listByRef('tenant-1', 'marketing', send?.id ?? '')).slice(-2))
      .toMatchObject([
        { type: 'opened', meta: { rawProviderPayload: { open: { ipAddress: '192.0.2.1' } } } },
        {
          type: 'clicked',
          meta: {
            linkUrl: 'https://tenant.test/offer',
            rawProviderPayload: { click: { link: 'https://tenant.test/offer' } },
          },
        },
      ]);
    expect(await applyVerifiedSesEvent(ctx, {
      topicArn, messageId: 'unknown', kind: 'open', occurredAt: NOW, raw: {},
    }, deps)).toEqual(ok({ processed: false }));
  });

  it('correlates transactional SNS complaints without writing marketing suppression', async () => {
    const deps = await setup();
    await deps.outbox.enqueue({
      id: 'outbox-transactional',
      tenantId: 'tenant-1',
      to: 'transactional@example.test',
      payload: {
        kind: 'magic-link',
        language: 'en',
        tenantName: 'Tenant',
        url: 'https://tenant.test/sign-in',
      },
      now: NOW,
    });
    await dispatchEmailBatch({
      emailOutbox: deps.outbox,
      events: deps.events,
      email: { send: async () => ok({ messageId: 'transactional-ses-id' }) },
      clock,
      logger: { error: () => undefined },
      batchSize: 1,
      attemptsCap: 3,
      backoffBaseMs: 1000,
      backoffCapMs: 10000,
      ids: deps.ids,
      runs: deps.runs,
      trigger: 'manual',
    });

    expect(await applyVerifiedSesEvent(ctx, {
      topicArn: settings.snsTopicArn ?? '',
      messageId: 'transactional-ses-id',
      kind: 'complaint',
      occurredAt: NOW,
      raw: { complaint: true },
    }, deps)).toEqual(ok({ processed: true }));
    expect(await deps.suppressions.isSuppressed(
      'tenant-1',
      deps.hmac.compute('tenant-1', 'transactional@example.test'),
    )).toBe(false);
    expect((await deps.events.listByRef(
      'tenant-1',
      'transactional',
      'outbox-transactional',
    )).map((event) => event.type)).toEqual([
      'queued',
      'claimed',
      'rendered',
      'accepted',
      'complained',
    ]);
    expect(await deps.outbox.correlateBySesMessageId?.('tenant-1', 'transactional-ses-id'))
      .toMatchObject({ deliveryStatus: 'complained', deliveryOccurredAt: NOW });
  });

  it('I10 erasure atomically keeps an HMAC tombstone, pseudonymizes sends, and preserves counters', async () => {
    const deps = await setup();
    await sendMarketingMessages(ctx, [{ to: 'member@example.test', memberId: 'member-1', campaignId: 'campaign-1', source: 'broadcast', consentDefinitionId: definition.id, subject: 'Hi', bodyHtml: '<p>Hi</p>', data: {} }], deps);
    const before = await deps.campaigns.findById('tenant-1', 'campaign-1');
    const memberErasure = {
      pseudonymize: async (tenantId: string, input: { memberId: string; tombstoneEmail: string }) => {
        await deps.sends.pseudonymizeMember(tenantId, { memberId: input.memberId, email: member.email, tombstoneEmail: input.tombstoneEmail });
        await deps.suppressions.record(tenantId, { id: ids.nextId(), tenantId, email: null, emailHmac: deps.hmac.compute(tenantId, member.email), reason: 'erasure', sourceRef: input.memberId, meta: null, createdAt: NOW, liftedAt: null, liftedBy: null });
        return { alreadyDeleted: false, authUserErased: true };
      },
    };
    const member = { id: 'member-1', tenantId: 'tenant-1', userId: 'user-1', email: 'member@example.test', displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW, deletedAt: null };
    const members = {
      findById: async () => member, findByEmail: async () => member, listWithProductIds: async () => [],
      create: async () => undefined, updateEmail: async () => member,
    };
    const erased = await removeMember(ctx, { memberId: 'member-1' }, {
      members, memberErasure, clock,
    });
    expect(erased.ok).toBe(true);
    expect(await deps.campaigns.findById('tenant-1', 'campaign-1')).toEqual(before);
    expect(await deps.consents.listByEmail('tenant-1', 'member@example.test')).toHaveLength(1);
    expect(await deps.sends.listByCampaign('tenant-1', 'campaign-1')).toMatchObject([{ memberId: null, email: 'deleted-member-1@anonymized.invalid' }]);
  });

  it('I11 records explicit DOI evidence, queues transactional confirmation, confirms, and purges stale pending', async () => {
    const deps = await setup([]);
    expect(await recordMarketingConsent(ctx, { email: 'implicit@example.test', memberId: null, definitionId: definition.id, evidence: { collectedAt: NOW }, source: 'api', confirmationBaseUrl: 'https://tenant.test/confirm' }, deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    const recorded = await recordMarketingConsent(ctx, { email: 'new@example.test', memberId: null, definitionId: definition.id, evidence: { collectedAt: NOW, proofRef: 'form-1' }, source: 'api', confirmationBaseUrl: 'https://tenant.test/confirm' }, deps);
    expect(recorded).toMatchObject({ ok: true, value: { state: 'pending_confirmation' } });
    expect(deps.outbox.items).toMatchObject([{ payload: { kind: 'marketing-consent-confirmation' } }]);
    expect(JSON.stringify(deps.outbox.items[0])).not.toContain('List-Unsubscribe');
    const confirmationToken = deps.confirmations.rows[0]?.token ?? '';
    expect((await confirmMarketingConsent(ctx, { token: confirmationToken, evidence: { collectedAt: NOW, ip: '127.0.0.1' } }, deps)).ok).toBe(true);
    expect((await confirmMarketingConsent(ctx, { token: confirmationToken, evidence: { collectedAt: NOW } }, deps)).ok).toBe(true);
    expect(await getMarketingEligibility(ctx, { email: 'new@example.test', definitionId: definition.id }, deps)).toMatchObject({ ok: true, value: { eligible: true } });
    await recordMarketingConsent(ctx, { email: 'stale@example.test', memberId: null, definitionId: definition.id, evidence: { collectedAt: '1998-06-01T00:00:00.000Z', proofRef: 'form-stale' }, source: 'api', confirmationBaseUrl: 'https://tenant.test/confirm' }, deps);
    const directDefinition = { ...definition, id: 'definition-direct', key: 'direct', doubleOptIn: false };
    await deps.definitions.create('tenant-1', directDefinition, { ...version, id: 'version-direct', definitionId: directDefinition.id });
    await deps.consents.record('tenant-1', { ...consent('direct@example.test', 'granted', 'direct-grant'), definitionId: directDefinition.id, occurredAt: '1998-06-01T00:00:00.000Z' });
    await deps.confirmations.create('tenant-1', { id: 'expired-token', tenantId: 'tenant-1', token: 'expired_token_1234567890123456', marketingConsentRowId: recorded.ok ? recorded.value.consent.id : '', createdAt: '1998-07-20T00:00:00.000Z', expiresAt: '1998-07-21T00:00:00.000Z', usedAt: null });
    expect(await confirmMarketingConsent(ctx, { token: 'expired_token_1234567890123456', evidence: { collectedAt: NOW } }, deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await runMarketingRetentionJobs(ctx, { pendingOlderThan: '1998-07-01T00:00:00.000Z', renderedBodiesOlderThan: NOW, idempotencyNow: NOW }, { ...deps, idempotency: new InMemoryAutomationIdempotencyRepository() })).toMatchObject({ ok: true, value: { pendingConsentsPurged: 1 } });
    expect(await deps.consents.listByEmail('tenant-1', 'direct@example.test')).toHaveLength(1);
  });

  it('rejects future-dated consent evidence so a later withdrawal cannot be resurrected', async () => {
    const deps = await setup([]);
    const future = await recordMarketingConsent(ctx, {
      email: 'future@example.test', memberId: null, definitionId: definition.id,
      evidence: { collectedAt: '1999-01-01T00:00:00.000Z', proofRef: 'bad-clock' },
      source: 'api', confirmationBaseUrl: 'https://tenant.test/confirm',
    }, deps);
    expect(future).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await deps.consents.listByEmail('tenant-1', 'future@example.test')).toEqual([]);
  });

  it('scans all due campaign work and runs retention for every marketing tenant', async () => {
    const dispatched: string[] = [];
    const retained: string[] = [];
    const runs = new InMemorySchedulerRunRepository();
    const result = await runScheduledMarketingJobs({
      now: NOW,
      pendingOlderThan: '1998-06-22T10:00:00.000Z',
      renderedBodiesOlderThan: '1998-06-22T10:00:00.000Z',
    }, {
      jobs: {
        listRunnableCampaigns: async () => [
          { tenantId: 'tenant-1', campaignId: 'campaign-1' },
          { tenantId: 'tenant-2', campaignId: 'campaign-2' },
        ],
        listRetentionTenantIds: async () => ['tenant-1', 'tenant-3'],
      },
      runs,
      dispatchCampaign: async (tenantId, campaignId) => {
        dispatched.push(`${tenantId}:${campaignId}`);
        return ok(undefined);
      },
      runRetention: async (tenantId) => {
        retained.push(tenantId);
        return ok(undefined);
      },
    });
    expect(result).toEqual(ok({ campaignsDispatched: 2, retentionTenantsProcessed: 2 }));
    expect(dispatched).toEqual(['tenant-1:campaign-1', 'tenant-2:campaign-2']);
    expect(retained).toEqual(['tenant-1', 'tenant-3']);
  });

  it('fails stale scheduler runs when there are no marketing retention tenants', async () => {
    const runs = new InMemorySchedulerRunRepository();
    await runs.start({
      id: 'stuck-outbox-run',
      kind: 'outbox_dispatch',
      trigger: 'cron',
      startedAt: '1998-07-22T08:00:00.000Z',
      finishedAt: null,
      durationMs: null,
      status: 'running',
      error: null,
      totals: {
        campaignsTouched: 0,
        sendsAttempted: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        reEnqueued: false,
      },
      createdAt: '1998-07-22T08:00:00.000Z',
    });

    const result = await runScheduledMarketingJobs({
      now: NOW,
      pendingOlderThan: '1998-06-22T10:00:00.000Z',
      renderedBodiesOlderThan: '1998-06-22T10:00:00.000Z',
    }, {
      jobs: {
        listRunnableCampaigns: async () => [],
        listRetentionTenantIds: async () => [],
      },
      runs,
      dispatchCampaign: async () => ok(undefined),
      runRetention: async () => ok(undefined),
    });

    expect(result).toEqual(ok({ campaignsDispatched: 0, retentionTenantsProcessed: 0 }));
    expect(await runs.getWithTenants('stuck-outbox-run')).toMatchObject({
      run: {
        status: 'failed',
        finishedAt: NOW,
        error: 'Scheduler run exceeded its timeout',
      },
    });
  });

  it('continues scheduled campaigns and retention after one tenant job fails', async () => {
    const processed: string[] = [];
    const runs = new InMemorySchedulerRunRepository();
    const result = await runScheduledMarketingJobs({
      now: NOW,
      pendingOlderThan: '1998-06-22T10:00:00.000Z',
      renderedBodiesOlderThan: '1998-06-22T10:00:00.000Z',
    }, {
      jobs: {
        listRunnableCampaigns: async () => [
          { tenantId: 'tenant-1', campaignId: 'campaign-1' },
          { tenantId: 'tenant-2', campaignId: 'campaign-2' },
        ],
        listRetentionTenantIds: async () => ['tenant-1'],
      },
      runs,
      dispatchCampaign: async (tenantId) => {
        processed.push(`campaign:${tenantId}`);
        return tenantId === 'tenant-1' ? err(integrationAuth('bad SES key')) : ok(undefined);
      },
      runRetention: async (tenantId) => {
        processed.push(`retention:${tenantId}`);
        return ok(undefined);
      },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'integration_auth' } });
    expect(processed).toEqual(['campaign:tenant-1', 'campaign:tenant-2', 'retention:tenant-1']);
  });

  it('schedules another tick when a campaign still has recipients after its budgeted batch', async () => {
    const deps = await setup(['first@example.test', 'second@example.test']);
    await deps.sesSettings.upsert('tenant-1', { ...settings, quotaRatePerSec: 1 });
    await deps.campaigns.update('tenant-1', { ...campaign(), toSend: 2 });
    const result = await campaignTick(ctx, { campaignId: 'campaign-1', workerId: 'worker', tickSeconds: 50 }, deps);
    expect(result).toMatchObject({ ok: true, value: { sent: 1 } });
    expect(deps.scheduler.scheduled).toEqual([{
      tenantId: 'tenant-1', campaignId: 'campaign-1', runAt: '1998-07-22T10:00:50.000Z',
    }]);
  });

  it('I11 does not consume a confirmation token when its pending consent row is temporarily unavailable', async () => {
    const deps = await setup([]);
    const token = 'retryable_token_123456789012345';
    await deps.confirmations.create('tenant-1', { id: 'retry-token', tenantId: 'tenant-1', token, marketingConsentRowId: 'late-consent', createdAt: NOW, expiresAt: '1998-07-23T10:00:00.000Z', usedAt: null });
    expect(await confirmMarketingConsent(ctx, { token, evidence: { collectedAt: NOW } }, deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    await deps.consents.record('tenant-1', consent('late@example.test', 'granted', 'late-consent'));
    expect(await confirmMarketingConsent(ctx, { token, evidence: { collectedAt: NOW } }, deps)).toMatchObject({ ok: true, value: { consent: { status: 'confirmed' } } });
  });

  it('I12 yields marketing while transactional outbox work is pending', async () => {
    const deps = await setup();
    deps.outbox.items.push({
      id: 'transactional-1',
      tenantId: 'tenant-1',
      to: 'x@example.test',
      payload: { kind: 'reset-password', language: 'en', actionUrl: 'https://tenant.test/reset' },
      attempts: 0,
      status: 'queued',
      sesMessageId: null,
      deliveryStatus: null,
      deliveryOccurredAt: null,
    });
    expect(await campaignTick(ctx, { campaignId: 'campaign-1', workerId: 'worker', tickSeconds: 1 }, deps)).toMatchObject({ ok: true, value: { yieldedToTransactional: true } });
    expect(deps.ses.sent).toHaveLength(0);
  });

  it('I13 keeps GET read-only and makes one-click POST idempotent with global suppression', async () => {
    const deps = await setup();
    await deps.unsubscribes.create('tenant-1', { id: 'unsubscribe-1', tenantId: 'tenant-1', token: '0123456789abcdef0123456789abcdef', email: 'member@example.test', memberId: 'member-1', campaignSendId: null, scope: 'all_marketing', createdAt: NOW, usedAt: null });
    const before = await deps.consents.listByEmail('tenant-1', 'member@example.test');
    expect((await getUnsubscribePreferences(anonymousCtx, { token: '0123456789abcdef0123456789abcdef' }, deps)).ok).toBe(true);
    expect(await deps.consents.listByEmail('tenant-1', 'member@example.test')).toEqual(before);
    expect((await unsubscribeOneClick(anonymousCtx, { token: '0123456789abcdef0123456789abcdef' }, deps)).ok).toBe(true);
    expect((await unsubscribeOneClick(anonymousCtx, { token: '0123456789abcdef0123456789abcdef' }, deps)).ok).toBe(true);
    expect((await deps.consents.listByEmail('tenant-1', 'member@example.test')).filter((row) => row.status === 'withdrawn')).toHaveLength(1);
    expect(await deps.suppressions.isSuppressed('tenant-1', deps.hmac.compute('tenant-1', 'member@example.test'))).toBe(true);
  });

  it('records unsubscribe and suppression writes against the originating message', async () => {
    const deps = await setup();
    const sent = await sendMarketingMessages(ctx, [{
      to: 'member@example.test',
      memberId: 'member-1',
      campaignId: 'campaign-1',
      source: 'broadcast',
      consentDefinitionId: definition.id,
      subject: 'Hello',
      bodyHtml: '<p>Content</p>',
      data: {},
    }], deps);
    if (!sent.ok || sent.value[0]?.status !== 'sent') throw new Error('Expected a sent marketing message');
    const token = 'global_unsubscribe_token_123456789';
    await deps.unsubscribes.create('tenant-1', {
      id: 'global-unsubscribe',
      tenantId: 'tenant-1',
      token,
      email: 'member@example.test',
      memberId: 'member-1',
      campaignSendId: sent.value[0].sendId,
      scope: 'all_marketing',
      createdAt: NOW,
      usedAt: null,
    });

    expect(await unsubscribeAllMarketing(anonymousCtx, { token }, deps)).toEqual(ok({ unsubscribed: true }));
    expect((await deps.events.listByRef(
      'tenant-1',
      'marketing',
      sent.value[0].sendId,
    )).map((event) => event.type)).toEqual([
      'queued',
      'claimed',
      'rendered',
      'accepted',
      'unsubscribed',
      'suppressed_written',
    ]);
  });

  it('saves optional preferences, queues DOI when re-subscribing, and supports global withdrawal', async () => {
    const deps = await setup();
    const token = 'preferences_token_123456789012345';
    await deps.unsubscribes.create('tenant-1', {
      id: 'unsubscribe-preferences', tenantId: 'tenant-1', token,
      email: 'member@example.test', memberId: 'member-1', campaignSendId: null,
      scope: `consent:${definition.id}`, createdAt: NOW, usedAt: null,
    });
    expect(await saveMarketingConsentPreferences(anonymousCtx, {
      token, selectedDefinitionIds: [], evidence: { collectedAt: NOW, proofRef: 'preference-page' },
      confirmationBaseUrl: 'https://tenant.test/marketing/confirm',
    }, deps)).toMatchObject({ ok: true, value: { pendingConfirmations: 0 } });
    expect(await saveMarketingConsentPreferences(anonymousCtx, {
      token, selectedDefinitionIds: [definition.id], evidence: { collectedAt: NOW, proofRef: 'preference-page' },
      confirmationBaseUrl: 'https://tenant.test/marketing/confirm',
    }, deps)).toMatchObject({ ok: true, value: { pendingConfirmations: 1 } });
    expect(deps.outbox.items).toHaveLength(1);
    expect(await unsubscribeAllMarketing(anonymousCtx, { token }, deps)).toMatchObject({ ok: true });
    expect(await unsubscribeAllMarketing(anonymousCtx, { token }, deps)).toMatchObject({ ok: true });
    expect(await deps.suppressions.isSuppressed('tenant-1', deps.hmac.compute('tenant-1', 'member@example.test'))).toBe(true);
  });

  it('supports suppression lifting, campaign CRUD gates, and retention orchestration', async () => {
    const deps = await setup();
    const added = await addManualSuppression(ctx, { email: 'member@example.test', sourceRef: 'staff-1' }, deps);
    expect(added.ok && (await liftMarketingSuppression(ctx, { suppressionId: added.value.id, actorId: 'staff-1' }, deps)).ok).toBe(true);
    const disposable = await createCampaign(ctx, { name: 'Disposable', subject: 'S', bodyHtml: '<p>B</p>', consentDefinitionId: definition.id }, deps);
    expect(disposable.ok && (await deleteCampaign(ctx, { campaignId: disposable.value.id }, deps)).ok).toBe(true);
    const invalidSchedule = await createCampaign(ctx, { name: 'Invalid schedule', subject: 'S', bodyHtml: '<p>B</p>', consentDefinitionId: definition.id }, deps);
    expect(invalidSchedule.ok && (await scheduleCampaign(ctx, { campaignId: invalidSchedule.value.id, sendAt: 'tomorrow' }, deps)).ok).toBe(false);
    const created = await createCampaign(ctx, { name: 'Draft', subject: 'S', bodyHtml: '<p>B</p>', consentDefinitionId: definition.id }, deps);
    const scheduled = created.ok ? await scheduleCampaign(ctx, { campaignId: created.value.id, sendAt: '1998-07-23T10:00:00.000Z' }, deps) : created;
    expect(scheduled).toMatchObject({ ok: true, value: { snapshotMaxMemberId: 'member-1', toSend: 1, consentLabelSnapshot: version.label } });
    expect((await listCampaigns(ctx, deps)).ok).toBe(true);
    expect(created.ok && (await getCampaign(ctx, { campaignId: created.value.id }, deps)).ok).toBe(true);
    expect(created.ok && (await cancelCampaign(ctx, { campaignId: created.value.id }, deps)).ok).toBe(true);
    expect(created.ok && (await scheduleCampaign(ctx, { campaignId: created.value.id, sendAt: '1998-07-24T10:00:00.000Z' }, deps)).ok).toBe(false);
    expect((await scheduleMarketingRetentionJobs(ctx, deps)).ok).toBe(true);
    expect(deps.scheduler.retentionTenants).toEqual(['tenant-1']);
    deps.sends.renderedBodiesAgedOut = 0;
    const retention = await runMarketingRetentionJobs(ctx, { pendingOlderThan: NOW, renderedBodiesOlderThan: NOW, idempotencyNow: NOW }, { ...deps, idempotency: new InMemoryAutomationIdempotencyRepository() });
    expect(retention).toMatchObject({ ok: true, value: { renderedBodiesPurged: 0 } });
  });

  it('derives unique and total campaign engagement from events', async () => {
    const deps = await setup(['one@example.test', 'two@example.test']);
    await sendMarketingMessages(ctx, [
      {
        to: 'one@example.test', memberId: 'member-1', campaignId: 'campaign-1',
        source: 'broadcast', consentDefinitionId: definition.id, subject: 'One',
        bodyHtml: '<p>One</p>', data: {},
      },
      {
        to: 'two@example.test', memberId: 'member-2', campaignId: 'campaign-1',
        source: 'broadcast', consentDefinitionId: definition.id, subject: 'Two',
        bodyHtml: '<p>Two</p>', data: {},
      },
    ], deps);
    const sends = await deps.sends.listByCampaign('tenant-1', 'campaign-1');
    const first = sends[0];
    const second = sends[1];
    if (first === undefined || second === undefined) throw new Error('Expected two campaign sends');
    for (const [refId, type] of [
      [first.id, 'opened'],
      [first.id, 'opened'],
      [second.id, 'opened'],
      [first.id, 'clicked'],
      [first.id, 'clicked'],
    ] as const) {
      await deps.events.append('tenant-1', emailEventSchema.parse({
        id: deps.ids.nextId(), tenantId: 'tenant-1', mailKind: 'marketing',
        refId, type, occurredAt: NOW,
        meta: type === 'clicked'
          ? { linkUrl: 'https://tenant.test/offer', rawProviderPayload: {} }
          : { rawProviderPayload: {} },
        createdAt: NOW,
      }));
    }
    expect(await listCampaignsWithEngagement(ctx, deps)).toMatchObject({
      ok: true,
      value: [{
        id: 'campaign-1',
        engagement: { uniqueOpens: 2, totalOpens: 3, uniqueClicks: 1, totalClicks: 2 },
      }],
    });
    expect(await getCampaignWithEngagement(ctx, { campaignId: 'campaign-1' }, deps)).toMatchObject({
      ok: true,
      value: {
        engagement: { uniqueOpens: 2, totalOpens: 3, uniqueClicks: 1, totalClicks: 2 },
      },
    });
  });

  it('M27 sends a tagged, untracked self-test through the rendered-output and header gates', async () => {
    const deps = await setup();
    const before = await deps.sends.listAll('tenant-1');
    expect((await testSendCampaignToSelf(ctx, { campaignId: 'campaign-1' }, deps)).ok).toBe(true);
    expect(deps.ses.sent.at(-1)?.configurationSet).toBeNull();
    expect(await deps.sends.listAll('tenant-1')).toEqual(before);
    expect(deps.ses.sent).toMatchObject([{
      to: ctx.identity.email,
      subject: '[TEST] Hello staff@example.test',
      headers: {
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        Precedence: 'bulk',
      },
    }]);
    expect(deps.ses.sent[0]?.html).toContain(settings.footerLegalName);
    expect(deps.ses.sent[0]?.html).toContain(settings.footerAddress);
  });
});
