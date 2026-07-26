import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { emailEventSchema, type Campaign, type CampaignSend, type ConsentDefinition, type ConsentDefinitionVersion, type EmailLayout, type MarketingConsent, type Suppression, type TenantDocument, type TenantDocumentVersion } from '@core/domain/index.js';

import { createDb, type Db } from './client.js';
import { createEmailEventRepository } from './email-events.js';
import { createEmailSendRepository } from './email-sends.js';
import {
  createAutomationIdempotencyRepository,
  createCampaignRepository,
  createCampaignSendRepository,
  createConsentDefinitionRepository,
  createEmailLayoutRepository,
  createMarketingConsentRepository,
  createMarketingThrottleRepository,
  createSuppressionRepository,
  createTenantDocumentRepository,
} from './marketing-repositories.js';
import { emailOutbox, tenants } from './schema.js';

const TEST_DB = 'together_marketing_repositories_test';
const baseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const testUrl = (() => { const url = new URL(baseUrl); url.pathname = `/${TEST_DB}`; return url.toString(); })();
const NOW = '2026-07-22T00:00:00.000Z';
let db: Db;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  const pool = new pg.Pool({ connectionString: testUrl });
  await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  await pool.end();
  db = createDb('node-postgres', testUrl);
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
    expect(await Promise.all([first, second])).toEqual([true, false]);
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
    await createCampaignSendRepository(db).claimRecipient(tenantId, {
      id: 'marketing-send-view', tenantId, campaignId: `campaign-${tenantId}`, source: 'broadcast',
      memberId: null, email: consent.email, subject: 'Campaign subject', consentRowId: consent.id,
      unsubscribeTokenId: null, status: 'sent', skipReason: null, sesMessageId: 'ses-marketing-view',
      deliveryStatus: 'delivered', deliveryOccurredAt: '2026-07-22T02:01:00.000Z',
      idempotencySource: null, renderedBodyPurgedAt: null, createdAt: '2026-07-22T02:00:00.000Z',
      sentAt: '2026-07-22T02:00:30.000Z',
    });
    await db.insert(emailOutbox).values({
      id: 'transactional-send-view', tenantId, kind: 'welcome-set-password', to: consent.email,
      payload: {
        kind: 'welcome-set-password', language: 'en', tenantName: 'Send view',
        actionUrl: 'https://example.test/set-password',
      },
      status: 'sent', attempts: 1, nextAttemptAt: '2026-07-22T03:00:00.000Z', lastError: null,
      createdAt: '2026-07-22T03:00:00.000Z', sentAt: '2026-07-22T03:00:30.000Z',
      sesMessageId: 'ses-transactional-view', deliveryStatus: null, deliveryOccurredAt: null,
    });

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
    expect(await repository.listByEmailAcrossKinds(tenantId, consent.email)).toHaveLength(2);
    expect(await repository.findById('tenant-b', 'marketing', 'marketing-send-view')).toBeNull();
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
