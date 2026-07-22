import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Campaign, ConsentDefinition, ConsentDefinitionVersion } from '@core/domain/index.js';

import { createDb, type Db } from './client.js';
import {
  createAutomationIdempotencyRepository,
  createCampaignRepository,
  createConsentDefinitionRepository,
} from './marketing-repositories.js';
import { tenants } from './schema.js';

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
});
