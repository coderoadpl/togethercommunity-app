import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { emailEventSchema, type Campaign, type CampaignSend, type ConsentDefinition, type ConsentDefinitionVersion, type EmailLayout, type MarketingConsent, type Suppression, type TenantDocument, type TenantDocumentVersion } from '#core/domain/index.js';

import type { Db } from './client.js';
import { createEmailEventRepository } from './email-events.js';
import { createEmailSendRepository } from './email-sends.js';
import { createSchedulerRunRepository } from './scheduler-runs.js';
import {
  createAutomationIdempotencyRepository,
  createCampaignRepository,
  createCampaignSendRepository,
  createConsentDefinitionRepository,
  createEmailLayoutRepository,
  createMarketingJobRepository,
  createMarketingConsentRepository,
  createMarketingThrottleRepository,
  createSuppressionRepository,
  createTenantDocumentRepository,
} from './marketing-repositories.js';
import { emailOutbox, schedulerRuns, tenantSesSettings, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const NOW = '2026-07-22T00:00:00.000Z';
let db: Db;
let testUrl: string;
let closeTestDatabase: () => Promise<void>;

afterAll(async () => {
  await closeTestDatabase();
});

beforeAll(async () => {
  const testDatabase = await createTestDatabase('together_marketing_repositories_test', baseUrl);
  db = testDatabase.db;
  testUrl = testDatabase.url;
  closeTestDatabase = testDatabase.close;
  await db.insert(tenants).values([
    { id: 'tenant-a', slug: 'tenant-a', name: 'A', createdAt: NOW },
    { id: 'tenant-b', slug: 'tenant-b', name: 'B', createdAt: NOW },
  ]);
}, 60_000);

const definition = (tenantId: string): ConsentDefinition => ({
  id: `definition-${tenantId}`, tenantId, key: 'newsletter', kind: 'optional_marketing',
  channel: 'email', doubleOptIn: true, documentRef: { mode: 'url', url: 'https://example.test/legal' },
  status: 'active', createdAt: NOW, updatedAt: NOW,
});

const version = (tenantId: string): ConsentDefinitionVersion => ({
  id: `version-${tenantId}`, tenantId, definitionId: `definition-${tenantId}`, version: 1,
  label: 'Newsletter', documentVersionRef: { mode: 'url', url: 'https://example.test/legal' },
  createdAt: NOW, createdBy: 'staff',
});

const campaign = (tenantId: string): Campaign => ({
  id: `campaign-${tenantId}`, tenantId, name: 'Campaign', subject: 'Subject', bodyHtml: '<p>Body</p>',
  bodySource: '<p>Body</p>', layoutId: null, consentDefinitionId: `definition-${tenantId}`,
  audienceFilter: null, status: 'running', sendAt: null, snapshotMaxMemberId: null,
  cursorMemberId: null, toSend: 0, sent: 0, failed: 0, lockedUntil: null, lockedBy: null,
  errorCount: 0, pausedReason: null, audienceNameSnapshot: null, consentLabelSnapshot: null,
  startedAt: NOW, finishedAt: null, createdAt: NOW,
});

describe('marketing database repositories', () => {
  it('selects SES identities that have never been checked or exceeded the cadence', async () => {
    await db.insert(tenantSesSettings).values([
      {
        tenantId: 'tenant-a',
        fromAddress: 'news@tenant-a.test',
        fromName: 'Tenant A',
        identity: 'tenant-a.test',
        webhookToken: 'tenant-a-webhook-token-123456',
      },
      {
        tenantId: 'tenant-b',
        fromAddress: 'news@tenant-b.test',
        fromName: 'Tenant B',
        identity: 'tenant-b.test',
        identityCheckedAt: '2026-07-22T00:00:00.000Z',
        webhookToken: 'tenant-b-webhook-token-123456',
      },
    ]);

    await expect(
      createMarketingJobRepository(db).listSesIdentityRefreshTenantIds(
        '2026-07-21T23:59:59.999Z',
      ),
    ).resolves.toEqual(['tenant-a']);
    await expect(
      createMarketingJobRepository(db).listSesTenantIds(NOW),
    ).resolves.toEqual(['tenant-a', 'tenant-b']);
    await expect(
      createMarketingJobRepository(db).listSesTenantIds(
        '2026-07-21T23:59:59.999Z',
      ),
    ).resolves.toEqual(['tenant-a']);
  });

  it('lists and summarizes scheduler runs with global and tenant scopes', async () => {
    const repository = createSchedulerRunRepository(db);
    const start = async (id: string, kind: 'marketing_tick' | 'outbox_dispatch', startedAt: string) => {
      await repository.start({
        id,
        kind,
        trigger: 'cron',
        startedAt,
        finishedAt: null,
        durationMs: null,
        status: 'running',
        error: null,
        totals: {
          campaignsTouched: 0, sendsAttempted: 0, sent: 0, failed: 0, skipped: 0, reEnqueued: false,
        },
        createdAt: startedAt,
      });
    };
    await start('run-db-new', 'marketing_tick', '2026-07-22T02:00:00.000Z');
    await start('run-db-old', 'outbox_dispatch', '2026-07-21T02:00:00.000Z');
    await repository.finalize('run-db-new', {
      finishedAt: '2026-07-22T02:00:01.000Z',
      durationMs: 1000,
      status: 'completed',
      error: null,
      totals: {
        campaignsTouched: 1, sendsAttempted: 4, sent: 3, failed: 1, skipped: 0, reEnqueued: false,
      },
      tenants: [{
        id: 'run-db-new-tenant-a', runId: 'run-db-new', tenantId: 'tenant-a',
        campaignsTouched: 1, batchSize: 4, sent: 3, failed: 1, skipped: 0,
        budgetComputed: 10, budgetUsed: 4, errors: ['rejected'], createdAt: '2026-07-22T02:00:01.000Z',
      }],
    });
    await repository.finalize('run-db-old', {
      finishedAt: '2026-07-21T02:00:01.000Z',
      durationMs: 1000,
      status: 'failed',
      error: 'dispatch failed',
      totals: {
        campaignsTouched: 0, sendsAttempted: 1, sent: 0, failed: 1, skipped: 0, reEnqueued: false,
      },
      tenants: [{
        id: 'run-db-old-tenant-b', runId: 'run-db-old', tenantId: 'tenant-b',
        campaignsTouched: 0, batchSize: 1, sent: 0, failed: 1, skipped: 0,
        budgetComputed: 10, budgetUsed: 1, errors: ['dispatch failed'], createdAt: '2026-07-21T02:00:01.000Z',
      }],
    });

    expect(await repository.listPage({ kind: 'marketing_tick', status: 'completed', limit: 1 }))
      .toMatchObject({ runs: [{ id: 'run-db-new', totals: { sent: 3, failed: 1 } }] });
    expect(await repository.listForTenant('tenant-a', { limit: 25 }))
      .toMatchObject({ items: [{ run: { id: 'run-db-new' }, tenant: { sent: 3, failed: 1 } }] });
    expect(await repository.getForTenant('tenant-b', 'run-db-new')).toBeNull();
    expect(await repository.summarizeForTenant('tenant-a', '2026-07-22T00:00:00.000Z'))
      .toMatchObject({
        runsLast24Hours: 1,
        sentLast24Hours: 3,
        failedLast24Hours: 1,
        lastRun: { id: 'run-db-new' },
      });
  });

  it('allows only one concurrent worker to finalize a scheduler run', async () => {
    const repository = createSchedulerRunRepository(db);
    await repository.start({
      id: 'run-finalize-race',
      kind: 'marketing_tick',
      trigger: 'cron',
      startedAt: '2026-07-22T03:00:00.000Z',
      finishedAt: null,
      durationMs: null,
      status: 'running',
      error: null,
      totals: {
        campaignsTouched: 0, sendsAttempted: 0, sent: 0, failed: 0, skipped: 0,
        reEnqueued: false,
      },
      createdAt: '2026-07-22T03:00:00.000Z',
    });
    const finalize = (status: 'completed' | 'failed') =>
      repository.finalize('run-finalize-race', {
        finishedAt: '2026-07-22T03:00:01.000Z',
        durationMs: 1000,
        status,
        error: status === 'failed' ? 'worker failed' : null,
        totals: {
          campaignsTouched: 1, sendsAttempted: 1, sent: status === 'completed' ? 1 : 0,
          failed: status === 'failed' ? 1 : 0, skipped: 0, reEnqueued: false,
        },
        tenants: [],
      });
    const outcomes = await Promise.all([finalize('completed'), finalize('failed')]);
    expect(outcomes.filter((outcome) => outcome !== null)).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === null)).toHaveLength(1);
  });

  it('marks only stale running scheduler jobs as failed', async () => {
    const repository = createSchedulerRunRepository(db);
    const start = (id: string, startedAt: string) => repository.start({
      id,
      kind: 'outbox_dispatch',
      trigger: 'cron',
      startedAt,
      finishedAt: null,
      durationMs: null,
      status: 'running',
      error: null,
      totals: {
        campaignsTouched: 0, sendsAttempted: 0, sent: 0, failed: 0, skipped: 0,
        reEnqueued: false,
      },
      createdAt: startedAt,
    });
    await start('run-stale', '2026-07-22T01:00:00.000Z');
    await start('run-fresh', '2026-07-22T04:00:00.000Z');
    await expect(repository.failStale({
      startedBefore: '2026-07-22T02:00:00.000Z',
      finishedAt: '2026-07-22T05:00:00.000Z',
      error: 'scheduler run timed out',
    })).resolves.toBe(1);
    await expect(repository.getWithTenants('run-stale')).resolves.toMatchObject({
      run: { status: 'failed', error: 'scheduler run timed out' },
    });
    await expect(repository.getWithTenants('run-fresh')).resolves.toMatchObject({
      run: { status: 'running', error: null },
    });
  });

  it('tenant-scopes definitions and claims a campaign lease with compare-and-set', async () => {
    const definitions = createConsentDefinitionRepository(db);
    await definitions.create('tenant-a', definition('tenant-a'), version('tenant-a'));
    await definitions.create('tenant-b', definition('tenant-b'), version('tenant-b'));
    expect((await definitions.list('tenant-a')).map((item) => item.tenantId)).toEqual(['tenant-a']);

    const campaigns = createCampaignRepository(db);
    await campaigns.create('tenant-a', campaign('tenant-a'));
    const first = campaigns.acquireLease('tenant-a', 'campaign-tenant-a', {
      workerId: 'worker-a', now: NOW, lockedUntil: '2026-07-22T00:01:00.000Z',
    });
    const second = campaigns.acquireLease('tenant-a', 'campaign-tenant-a', {
      workerId: 'worker-b', now: NOW, lockedUntil: '2026-07-22T00:01:00.000Z',
    });
    const outcomes = await Promise.all([first, second]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(await campaigns.findById('tenant-a', 'campaign-tenant-a')).toMatchObject({
      lockedBy: outcomes[0] ? 'worker-a' : 'worker-b',
      lockedUntil: '2026-07-22T00:01:00.000Z',
    });
    expect(await campaigns.findById('tenant-b', 'campaign-tenant-a')).toBeNull();
  });

  it('claims idempotency keys by unique insert and returns original metadata on reuse', async () => {
    const repository = createAutomationIdempotencyRepository(db);
    const record = {
      id: 'idem-1', tenantId: 'tenant-a', key: 'request-1', requestMethod: 'POST',
      requestPath: '/api/m2m/marketing/messages', requestHash: 'hash', claimedAt: NOW,
      expiresAt: '2026-07-23T00:00:00.000Z',
    };
    expect(await repository.claim('tenant-a', record)).toBeNull();
    expect(await repository.claim('tenant-a', { ...record, id: 'idem-2' })).toEqual(record);
    expect(await repository.claim('tenant-b', { ...record, id: 'idem-3', tenantId: 'tenant-b' })).toBeNull();
  });

  it('atomically shares SES rate and daily quota claims across workers', async () => {
    const repository = createMarketingThrottleRepository(db);
    const input = {
      requested: 1, now: NOW, ratePerSecond: 1, dailyQuota: 2,
      sentLast24Hours: 0, quotaSnapshotAt: NOW,
    };
    const concurrent = await Promise.all([
      repository.claim('tenant-a', input),
      repository.claim('tenant-a', input),
    ]);
    expect(concurrent.filter(Boolean)).toHaveLength(1);
    expect(await repository.claim('tenant-a', {
      ...input, now: '2026-07-22T00:00:01.000Z',
    })).toBe(true);
    expect(await repository.claim('tenant-a', {
      ...input, now: '2026-07-22T00:00:02.000Z',
    })).toBe(false);
  });

  it('appends suppression lifecycle history in the same repository operation', async () => {
    const repository = createSuppressionRepository(db);
    const suppression: Suppression = {
      id: 'suppression-event-a',
      tenantId: 'tenant-a',
      email: 'member@example.test',
      emailHmac: 'email-hmac-a',
      reason: 'hard_bounce',
      sourceRef: 'send-event-a',
      meta: { bounceType: 'Permanent' },
      createdAt: NOW,
      liftedAt: null,
      liftedBy: null,
    };
    const event = emailEventSchema.parse({
      id: 'suppression-written-event-a',
      tenantId: 'tenant-a',
      mailKind: 'marketing',
      refId: 'send-event-a',
      type: 'suppressed_written',
      occurredAt: NOW,
      meta: { reason: 'hard_bounce' },
      createdAt: NOW,
    });

    expect(await repository.record('tenant-a', suppression, event)).toBe(true);
    expect((await createEmailEventRepository(db).listByRef(
      'tenant-a',
      'marketing',
      'send-event-a',
    )).map((item) => item.type)).toEqual(['suppressed_written']);
  });

  it('orders same-timestamp email events by append order', async () => {
    const repository = createEmailEventRepository(db);
    const event = (id: string, type: 'queued' | 'claimed') => emailEventSchema.parse({
      id,
      tenantId: 'tenant-a',
      mailKind: 'marketing',
      refId: 'same-timestamp-send',
      type,
      occurredAt: NOW,
      meta: null,
      createdAt: NOW,
    });

    await repository.append('tenant-a', event('z-queued-event', 'queued'));
    await repository.append('tenant-a', event('a-claimed-event', 'claimed'));

    expect((await repository.listByRef(
      'tenant-a',
      'marketing',
      'same-timestamp-send',
    )).map((item) => item.type)).toEqual(['queued', 'claimed']);
  });

  it('allows distinct API drip steps in one campaign and still deduplicates broadcast recipients', async () => {
    const tenantId = 'tenant-drip';
    await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Drip', createdAt: NOW });
    const definitions = createConsentDefinitionRepository(db);
    await definitions.create(tenantId, definition(tenantId), version(tenantId));
    const campaigns = createCampaignRepository(db);
    await campaigns.create(tenantId, campaign(tenantId));
    const consent: MarketingConsent = {
      id: 'consent-drip', tenantId, memberId: null, email: 'buyer@example.test',
      definitionId: `definition-${tenantId}`, definitionVersion: 1, wordingSnapshot: 'Newsletter',
      documentRefSnapshot: { mode: 'url', url: 'https://example.test/legal' }, status: 'confirmed',
      previousId: null, source: 'api', evidence: { collectedAt: NOW, proofRef: 'checkout' }, occurredAt: NOW,
    };
    await createMarketingConsentRepository(db).record(tenantId, consent);
    const sends = createCampaignSendRepository(db);
    const send = (id: string, source: CampaignSend['source'], idempotencySource: string | null): CampaignSend => ({
      id, tenantId, campaignId: `campaign-${tenantId}`, source, memberId: null, email: consent.email,
      subject: 'Campaign subject',
      consentRowId: consent.id, unsubscribeTokenId: null, status: 'pending', skipReason: null,
      sesMessageId: null, deliveryStatus: null, deliveryOccurredAt: null, idempotencySource,
      renderedBodyPurgedAt: null, createdAt: NOW, sentAt: null,
    });
    expect(await sends.claimRecipient(tenantId, send('api-1', 'api', 'drip0-order-1'))).toBe(true);
    expect(await sends.claimRecipient(tenantId, send('api-2', 'api', 'drip3-order-1'))).toBe(true);
    expect(await sends.claimRecipient(tenantId, send('api-3', 'api', 'drip7-order-1'))).toBe(true);
    expect(await sends.claimRecipient(tenantId, send('broadcast-1', 'broadcast', null))).toBe(true);
    expect(await sends.claimRecipient(tenantId, send('broadcast-2', 'broadcast', null))).toBe(false);
  });

  it('derives unique and total engagement independently of send keyset pages', async () => {
    const tenantId = 'tenant-engagement';
    await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Engagement', createdAt: NOW });
    await createConsentDefinitionRepository(db).create(tenantId, definition(tenantId), version(tenantId));
    await createCampaignRepository(db).create(tenantId, campaign(tenantId));
    await createMarketingConsentRepository(db).record(tenantId, {
      id: 'consent-engagement', tenantId, memberId: null, email: 'a@example.test',
      definitionId: `definition-${tenantId}`, definitionVersion: 1, wordingSnapshot: 'Newsletter',
      documentRefSnapshot: { mode: 'url', url: 'https://example.test/legal' },
      status: 'confirmed', previousId: null, source: 'api',
      evidence: { collectedAt: NOW, proofRef: 'fixture' }, occurredAt: NOW,
    });
    const sends = createCampaignSendRepository(db);
    const send = (id: string, email: string): CampaignSend => ({
      id, tenantId, campaignId: `campaign-${tenantId}`, source: 'broadcast',
      memberId: null, email, subject: 'Campaign subject',
      consentRowId: 'consent-engagement', unsubscribeTokenId: null, status: 'sent',
      skipReason: null, sesMessageId: `ses-${id}`, deliveryStatus: null,
      deliveryOccurredAt: null, idempotencySource: null, renderedBodyPurgedAt: null,
      createdAt: NOW, sentAt: NOW,
    });
    await sends.claimRecipient(tenantId, send('engagement-a', 'a@example.test'));
    await sends.claimRecipient(tenantId, send('engagement-b', 'b@example.test'));
    const events = createEmailEventRepository(db);
    for (const [id, refId, type] of [
      ['open-a-1', 'engagement-a', 'opened'],
      ['open-a-2', 'engagement-a', 'opened'],
      ['open-b-1', 'engagement-b', 'opened'],
      ['click-a-1', 'engagement-a', 'clicked'],
      ['click-a-2', 'engagement-a', 'clicked'],
    ] as const) {
      await events.append(tenantId, emailEventSchema.parse({
        id, tenantId, mailKind: 'marketing', refId, type, occurredAt: NOW,
        meta: type === 'clicked'
          ? { linkUrl: 'https://example.test/offer', rawProviderPayload: {} }
          : { rawProviderPayload: {} },
        createdAt: NOW,
      }));
    }
    const firstPage = await sends.listPage(tenantId, { campaignId: `campaign-${tenantId}`, limit: 1 });
    expect(firstPage.nextCursor).not.toBeNull();
    expect(await sends.engagementStats(tenantId, [`campaign-${tenantId}`])).toEqual(new Map([[
      `campaign-${tenantId}`,
      { uniqueOpens: 2, totalOpens: 3, uniqueClicks: 1, totalClicks: 2 },
    ]]));
  });

  it('counts reputation from the sent cohort instead of accepted-event fixtures', async () => {
    const tenantId = 'tenant-reputation';
    await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Reputation', createdAt: NOW });
    await createConsentDefinitionRepository(db).create(tenantId, definition(tenantId), version(tenantId));
    await createCampaignRepository(db).create(tenantId, campaign(tenantId));
    const consent: MarketingConsent = {
      id: 'consent-reputation', tenantId, memberId: null, email: 'member@example.test',
      definitionId: `definition-${tenantId}`, definitionVersion: 1, wordingSnapshot: 'Newsletter',
      documentRefSnapshot: { mode: 'url', url: 'https://example.test/legal' },
      status: 'confirmed', previousId: null, source: 'api',
      evidence: { collectedAt: NOW, proofRef: 'fixture' }, occurredAt: NOW,
    };
    await createMarketingConsentRepository(db).record(tenantId, consent);
    const sends = createCampaignSendRepository(db);
    const send = (id: string, sentAt: string): CampaignSend => ({
      id, tenantId, campaignId: `campaign-${tenantId}`, source: 'api',
      memberId: null, email: `${id}@example.test`, subject: 'Reputation',
      consentRowId: consent.id, unsubscribeTokenId: null, status: 'sent',
      skipReason: null, sesMessageId: `ses-${id}`, deliveryStatus: null,
      deliveryOccurredAt: null, idempotencySource: null, renderedBodyPurgedAt: null,
      createdAt: sentAt, sentAt,
    });
    await sends.claimRecipient(tenantId, send('recent-hard', '2026-07-21T00:00:00.000Z'));
    await sends.claimRecipient(tenantId, send('recent-complaint', '2026-07-20T00:00:00.000Z'));
    await sends.claimRecipient(tenantId, send('old-hard', '2026-07-10T00:00:00.000Z'));
    const events = createEmailEventRepository(db);
    for (const [id, refId, type, occurredAt] of [
      ['hard-late', 'recent-hard', 'bounced', '2026-07-22T00:00:00.000Z'],
      ['complaint-recent', 'recent-complaint', 'complained', '2026-07-21T00:00:00.000Z'],
      ['hard-old-send', 'old-hard', 'bounced', '2026-07-21T00:00:00.000Z'],
    ] as const) {
      await events.append(tenantId, emailEventSchema.parse({
        id, tenantId, mailKind: 'marketing', refId, type, occurredAt,
        meta: type === 'bounced'
          ? { classification: 'hard', rawProviderPayload: {} }
          : { rawProviderPayload: {} },
        createdAt: occurredAt,
      }));
    }
    await events.append(tenantId, emailEventSchema.parse({
      id: 'accepted-without-send', tenantId, mailKind: 'marketing',
      refId: 'missing-send', type: 'accepted', occurredAt: NOW,
      meta: { sesMessageId: 'missing' }, createdAt: NOW,
    }));

    expect(await events.reputationCounts(tenantId, {
      since: '2026-07-15T00:00:00.000Z',
      until: '2026-07-22T00:00:00.000Z',
    })).toEqual({ sends: 2, hardBounces: 1, complaints: 1 });
  });

  it('lists tenant-scoped transactional and marketing sends with one stable keyset', async () => {
    const tenantId = 'tenant-send-view';
    await db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Send view', createdAt: NOW });
    await createConsentDefinitionRepository(db).create(tenantId, definition(tenantId), version(tenantId));
    await createCampaignRepository(db).create(tenantId, campaign(tenantId));
    const consent: MarketingConsent = {
      id: 'consent-send-view', tenantId, memberId: null, email: 'member@example.test',
      definitionId: `definition-${tenantId}`, definitionVersion: 1, wordingSnapshot: 'Newsletter',
      documentRefSnapshot: { mode: 'url', url: 'https://example.test/legal' }, status: 'confirmed',
      previousId: null, source: 'api', evidence: { collectedAt: NOW, proofRef: 'fixture' }, occurredAt: NOW,
    };
    await createMarketingConsentRepository(db).record(tenantId, consent);
    await db.insert(schedulerRuns).values({
      id: 'run-send-view',
      kind: 'marketing_tick',
      trigger: 'cron',
      startedAt: NOW,
      finishedAt: '2026-07-22T00:00:01.000Z',
      durationMs: 1000,
      status: 'completed',
      error: null,
      totals: {
        campaignsTouched: 1, sendsAttempted: 2, sent: 2, failed: 0, skipped: 0, reEnqueued: false,
      },
      createdAt: NOW,
    });
    await createCampaignSendRepository(db).claimRecipient(tenantId, {
      id: 'marketing-send-view', runId: 'run-send-view', tenantId,
      campaignId: `campaign-${tenantId}`, source: 'broadcast',
      memberId: null, email: consent.email, subject: 'Campaign subject', consentRowId: consent.id,
      unsubscribeTokenId: null, status: 'sent', skipReason: null, sesMessageId: 'ses-marketing-view',
      deliveryStatus: 'delivered', deliveryOccurredAt: '2026-07-22T02:01:00.000Z',
      idempotencySource: null, renderedBodyPurgedAt: null, createdAt: '2026-07-22T02:00:00.000Z',
      sentAt: '2026-07-22T02:00:30.000Z',
    });
    await db.insert(emailOutbox).values({
      id: 'transactional-send-view', tenantId, kind: 'welcome-set-password', to: ' Member@Example.Test ',
      payload: {
        kind: 'welcome-set-password', language: 'en', tenantName: 'Send view',
        actionUrl: 'https://example.test/set-password',
      },
      status: 'sent', attempts: 1, nextAttemptAt: '2026-07-22T03:00:00.000Z', lastError: null,
      createdAt: '2026-07-22T03:00:00.000Z', sentAt: '2026-07-22T03:00:30.000Z',
      sesMessageId: 'ses-transactional-view', deliveryStatus: null, deliveryOccurredAt: null,
    });
    await createEmailEventRepository(db).append(tenantId, emailEventSchema.parse({
      id: 'transactional-send-view-accepted',
      tenantId,
      mailKind: 'transactional',
      refId: 'transactional-send-view',
      type: 'accepted',
      occurredAt: '2026-07-22T03:00:30.000Z',
      meta: { sesMessageId: 'ses-transactional-view', runId: 'run-send-view' },
      createdAt: '2026-07-22T03:00:30.000Z',
    }));

    const repository = createEmailSendRepository(db);
    const first = await repository.listPage(tenantId, { limit: 1 });
    expect(first.sends.map(({ kind, id }) => ({ kind, id }))).toEqual([
      { kind: 'transactional', id: 'transactional-send-view' },
    ]);
    expect(first.nextCursor).not.toBeNull();
    if (first.nextCursor === null) throw new Error('Expected another unified send page');
    const second = await repository.listPage(tenantId, { cursor: first.nextCursor, limit: 1 });
    expect(second.sends.map(({ kind, id }) => ({ kind, id }))).toEqual([
      { kind: 'marketing', id: 'marketing-send-view' },
    ]);
    expect(await repository.listByEmailAcrossKinds(tenantId, ' MEMBER@example.test ')).toHaveLength(2);
    expect((await repository.listPage(tenantId, { runId: 'run-send-view', limit: 25 })).sends)
      .toHaveLength(2);
    expect((await repository.listPage(tenantId, { runId: 'other-run', limit: 25 })).sends)
      .toHaveLength(0);
    expect(await repository.findById('tenant-b', 'marketing', 'marketing-send-view')).toBeNull();
  });

  it('indexes normalized exact recipient lookups for both send projections', async () => {
    const client = new pg.Client({ connectionString: testUrl });
    await client.connect();
    const rows = await (async () => {
      try {
        const result = await client.query<{ indexname: string }>(`
          select indexname
          from pg_indexes
          where schemaname = 'public'
            and indexname in (
              'campaign_sends_tenant_email_created_id_idx',
              'email_outbox_tenant_normalized_to_created_id_idx'
            )
          order by indexname
        `);
        return result.rows;
      } finally {
        await client.end();
      }
    })();

    expect(rows.map((row) => row.indexname)).toEqual([
      'campaign_sends_tenant_email_created_id_idx',
      'email_outbox_tenant_normalized_to_created_id_idx',
    ]);
  });

  it('stores only tenant-scoped layouts with one content slot', async () => {
    const repository = createEmailLayoutRepository(db);
    const layout: EmailLayout = {
      id: 'layout-a', tenantId: 'tenant-a', name: 'Default', bodyHtml: '<main>{{{content}}}</main>',
      createdAt: NOW, updatedAt: NOW,
    };
    await repository.create('tenant-a', layout);
    expect(await repository.findById('tenant-a', layout.id)).toEqual(layout);
    expect(await repository.findById('tenant-b', layout.id)).toBeNull();
    expect(await repository.list('tenant-a')).toEqual([layout]);
    expect(await repository.update('tenant-a', { ...layout, name: 'Newsletter' })).toEqual({ ...layout, name: 'Newsletter' });
    await expect(repository.create('tenant-a', { ...layout, id: 'invalid', bodyHtml: '<main>No slot</main>' }))
      .rejects.toThrow();
  });

  it('keeps published hosted document versions immutable and edits only the active draft', async () => {
    const repository = createTenantDocumentRepository(db);
    const document: TenantDocument = {
      id: 'document-a', tenantId: 'tenant-a', slug: 'privacy', title: 'Privacy', status: 'draft',
      createdAt: NOW, updatedAt: NOW,
    };
    const first: TenantDocumentVersion = {
      id: 'document-version-a-1', tenantId: 'tenant-a', documentId: document.id, version: 1,
      content: '# First', publishedAt: null, createdAt: NOW, createdBy: 'staff',
    };
    await repository.create('tenant-a', document, first);
    expect(await repository.publishDraft('tenant-a', document.id, NOW)).not.toBeNull();
    expect(await repository.findPublishedVersionById('tenant-a', first.id)).toMatchObject({
      document: { slug: 'privacy' },
      version: { id: first.id, version: 1 },
    });
    expect(await repository.findPublishedVersionById('tenant-b', first.id)).toBeNull();
    const second: TenantDocumentVersion = {
      ...first, id: 'document-version-a-2', version: 2, content: '# Second', createdAt: '2026-07-22T01:00:00.000Z',
    };
    await repository.saveDraft('tenant-a', { ...document, status: 'published' }, second);
    await repository.saveDraft('tenant-a', { ...document, status: 'published' }, { ...second, content: '# Revised second' });
    expect((await repository.listVersions('tenant-a', document.id)).map(({ version, content, publishedAt }) => ({ version, content, publishedAt }))).toEqual([
      { version: 1, content: '# First', publishedAt: NOW },
      { version: 2, content: '# Revised second', publishedAt: null },
    ]);
    expect(await repository.findById('tenant-b', document.id)).toBeNull();
  });
});
