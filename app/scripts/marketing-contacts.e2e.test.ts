import { generateKeyPairSync, sign } from 'node:crypto';
import { execFile } from 'node:child_process';
import { listenMarketingTestApp } from '../apps/server/testing/marketing-contact-test-app.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiClient } from '#core/client/index.js';
import { MARKETING_IMPORT_ATTESTATION_VERSION, type ContactCampaignAudience } from '#core/domain/index.js';
import { campaignTick, dispatchMarketingOutbox, processMarketingSnsInbox } from '#core/server/index.js';
import { createSnsVerifier } from '#adapters/crypto/sns.js';
import { createContactCampaignFixture } from '#adapters/db/marketing-contact-campaign-test-fixture.js';
import { deliveryWorkerCtx, deliveryWebhookCtx, DELIVERY_NOW } from '#adapters/db/marketing-delivery-test-fixture.js';
import { directoryValue } from '#adapters/db/marketing-contact-test-fixture.js';
import { marketingOutbox, campaignSends, marketingCampaignAudienceContacts, marketingContacts, marketingListMemberships, members, tenantAdmins, user, emailEvents, marketingSnsInbox } from '#adapters/db/schema.js';

import { buildApp } from '../apps/server/src/app.js';
import { createDeps } from '../apps/server/src/composition.js';
import { envSchema } from '../apps/server/src/env.js';

let fixture: Awaited<ReturnType<typeof createContactCampaignFixture>>;
beforeAll(async () => { fixture = await createContactCampaignFixture(); }, 60_000);
afterAll(async () => { await fixture?.close(); });

describe('contacts CSV to campaign delivery', () => {
  it('imports without accounts, freezes overlapping lists, skips suppressions and records signed feedback exactly once', async () => {
    const env = envSchema.parse({ NODE_ENV: 'test', DATABASE_URL: fixture.url, REALTIME_TRANSPORT: 'in-process', APP_BASE_DOMAIN: 'example.org', APP_BASE_URL: 'https://platform.example.org', SECRETS_MASTER_KEY: Buffer.alloc(32, 1).toString('base64'), CRON_SECRET: 'contacts-worker-secret' });
    const configured = createDeps(env, { db: fixture.db, clock: fixture.deps.clock });
    if (configured.marketing === undefined) throw new Error('Marketing configuration missing');
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const sns = createSnsVerifier({ fetchText: async () => keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() });
    const app = buildApp({ ...configured,
      marketingContacts: fixture.directory,
      authPort: { ...configured.authPort, getAuthenticatedUser: async () => ({ sessionId: 'session', userId: 'existing-account', email: 'member@example.test', name: 'Owner', emailVerified: true, image: null }) },
      marketing: { ...configured.marketing, contactAudienceDeps: fixture.deps.contactAudienceDeps, scheduler: fixture.deps.scheduler, marketingCredentials: fixture.deps.credentials, marketingSes: fixture.deps.ses, sns, quotaReader: undefined },
    });
    const baseUrl = 'https://delivery-a.example.org';
    const api = createApiClient({ baseUrl, fetchImpl: async (url, init) => {
      const headers = new Headers(init?.headers); headers.set('host', 'delivery-a.example.org');
      return app.request(new Request(url, { ...init, headers }));
    } });
    await fixture.db.insert(user).values({ id: 'existing-account', email: 'member@example.test', name: 'Member', emailVerified: true, createdAt: new Date(DELIVERY_NOW), updatedAt: new Date(DELIVERY_NOW) });
    await fixture.db.insert(tenantAdmins).values({ id: 'owner-grant', tenantId: 'delivery-a', userId: 'existing-account', role: 'owner' });
    await fixture.db.insert(members).values({ id: 'existing-member', tenantId: 'delivery-a', userId: 'existing-account', email: 'member@example.test', displayName: 'Member', createdAt: DELIVERY_NOW });
    await fixture.directory.contacts.upsertByEmail('delivery-a', { email: 'member@example.test', displayName: 'Member' });
    const importCsv = async (csv: string, kind: 'contacts' | 'suppressions', key: string) => {
      const preview = directoryValue(await api.uploadMarketingContactImport({ csv, metadata: { datasetVersion: 'together-marketing-contacts/v1', kind, fileName: `${kind}.csv`, idempotencyKey: key, ...(kind === 'contacts' ? { consentDefinitionId: 'consent' } : {}) } }));
      expect(preview.canCommit).toBe(true);
      directoryValue(await api.commitMarketingContactImport({ importId: preview.import.id, validationHash: preview.validationHash, attestation: { accepted: true, version: MARKETING_IMPORT_ATTESTATION_VERSION, locale: 'en', note: 'Synthetic newsletter export; consent evidence retained in test records.' } }));
      const worker = await app.request('/api/internal/marketing/imports/tick', { headers: { authorization: 'Bearer contacts-worker-secret' } });
      expect(worker.status).toBe(200);
      return directoryValue(await api.getMarketingContactImport({ importId: preview.import.id })).import;
    };
    await importCsv('email,reason,at\nblocked@example.test,manual,2025-02-03T10:00:00Z\n', 'suppressions', 'suppression');
    const csv = 'email,name,lists\nmember@example.test,Member,news\nfirst@example.test,First,news|launch\nsecond@example.test,Second,launch\nblocked@example.test,Blocked,news\n FIRST@EXAMPLE.TEST ,First,launch\n';
    const imported = await importCsv(csv, 'contacts', 'contacts');
    expect(imported.resultCounts).toMatchObject({ created: 3, unchanged: 1, duplicateRows: 1, membershipsAdded: 5, consentsRecorded: 3, consentBlockedBySuppression: 1 });
    expect(imported.attestedBy).toEqual({ kind: 'user', userId: 'existing-account' });
    expect(imported.attestedAt).toBe(DELIVERY_NOW);
    expect(await fixture.db.select().from(marketingContacts)).toHaveLength(4);
    expect(await fixture.db.select().from(user)).toHaveLength(1);
    expect(await fixture.db.select().from(members)).toHaveLength(1);
    expect(await fixture.directory.contacts.findByEmail('delivery-a', 'member@example.test')).toMatchObject({ memberId: 'existing-member' });
    const lists = directoryValue(await api.listMarketingLists({})).lists;
    const audience: ContactCampaignAudience = { version: 2, includeLists: lists.map((list) => list.id), excludeLists: [], excludeProductIds: [], includeMembersWithConsent: false };
    const preview = directoryValue(await api.previewMarketingAudience({ audience, consentDefinitionId: 'consent' }));
    expect(preview).toMatchObject({ count: 3, candidateCount: 4, skipped: { suppressed: 1 } });
    const campaign = directoryValue(await api.createMarketingCampaign({ name: 'List campaign', subject: 'Hello {{contact.name}}', bodyHtml: '<p>Read <a href="https://courses.example.org/course">the course</a>.</p>', consentDefinitionId: 'consent', audience })).campaign;
    const server = listenMarketingTestApp(app);
    try {
      await new Promise<void>((resolve) => { if (server.listening) resolve(); else server.once('listening', resolve); });
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('Missing server address');
      const cli = async (...args: string[]): Promise<unknown> => JSON.parse(await new Promise<string>((resolve, reject) => execFile(process.execPath, ['--import', 'tsx', 'apps/cli/src/main.ts', '--json', '--api-url', `http://127.0.0.1:${address.port}`, '--tenant', 'delivery-a', 'campaign', ...args], { timeout: 20_000 }, (error, output) => error ? reject(error) : resolve(output))));
      expect(await cli('audience', 'set', '--campaign', campaign.id, '--audience', JSON.stringify(audience))).toMatchObject({ ok: true, data: { campaign: { audienceVersion: 2 } } });
      expect(await cli('audience', 'preview', '--campaign', campaign.id)).toMatchObject({ ok: true, data: { count: 3, candidateCount: 4 } });
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
    const scheduled = directoryValue(await api.scheduleMarketingCampaign({ campaignId: campaign.id, sendAt: DELIVERY_NOW })).campaign;
    expect(scheduled).toMatchObject({ candidateCount: 4, toSend: 3, audienceVersion: 2 });
    const snapshot = await fixture.db.select().from(marketingCampaignAudienceContacts);
    expect(snapshot).toHaveLength(4);
    const tick = { campaignId: campaign.id, workerId: 'enumerator', tickSeconds: 50 };
    directoryValue(await campaignTick(deliveryWorkerCtx(), tick, { ...fixture.deps, marketingOutbox: { ...fixture.deps.marketingOutbox, claim: async () => null } }));
    const outbox = await fixture.db.select().from(marketingOutbox);
    expect(outbox).toHaveLength(3);
    for (const row of outbox) {
      expect(row.status).toBe('pending');
      expect(row.payload?.text).toContain('the course (https://courses.example.org/course)');
      expect(row.payload?.text).toContain('Unsubscribe: https://courses.example.org/u/');
      expect(row.payload?.html).toContain('https://courses.example.org/u/');
      expect(row.payload?.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(row.payload?.headers['List-Unsubscribe']).toMatch(/^<https:\/\/courses.example.org\/u\//);
      expect(row.payload?.replyTo).toBe('reply@example.test');
    }
    const sends = await fixture.db.select().from(campaignSends);
    expect(sends).toHaveLength(4);
    expect(sends.find((send) => send.email === 'blocked@example.test')).toMatchObject({ status: 'skipped', skipReason: 'suppressed', consentRowId: null });
    expect(sends.every((send) => send.contactId !== null && send.audienceSnapshotId === scheduled.audienceSnapshotId)).toBe(true);
    directoryValue(await api.addMarketingSuppression({ email: 'second@example.test', sourceRef: null }));
    const dispatched = directoryValue(await dispatchMarketingOutbox(deliveryWorkerCtx(), { workerId: 'sender', deadlineAt: '2026-09-09T10:00:50.000Z', maxSends: 10 }, fixture.deps));
    expect(dispatched).toEqual({ sent: 2, skipped: 1, failed: 0, uncertain: 0 });
    expect(fixture.sent).toHaveLength(2);
    const sent = (await fixture.deps.sends.listByCampaign('delivery-a', campaign.id)).find((send) => send.status === 'sent');
    if (sent === undefined || sent.contactId == null) throw new Error('Missing sent contact');
    const message = JSON.stringify({ eventType: 'Delivery', mail: { messageId: sent.sesMessageId }, delivery: { timestamp: fixture.deps.clock.nowIso() } });
    const unsigned = { Type: 'Notification', MessageId: 'contact-feedback', TopicArn: 'topic-a', Message: message, Timestamp: fixture.deps.clock.nowIso(), SignatureVersion: '2', SigningCertURL: 'https://sns.eu-central-1.amazonaws.com/cert.pem' };
    const canonical = ['Message', message, 'MessageId', unsigned.MessageId, 'Timestamp', unsigned.Timestamp, 'TopicArn', unsigned.TopicArn, 'Type', unsigned.Type].join('\n') + '\n';
    const rawBody = JSON.stringify({ ...unsigned, Signature: sign('RSA-SHA256', Buffer.from(canonical), keys.privateKey).toString('base64') });
    for (let replay = 0; replay < 2; replay += 1) {
      const feedback = await app.request('/api/webhooks/ses/delivery-webhook-token-123456', { method: 'POST', body: rawBody });
      expect(feedback.status).toBe(200);
      directoryValue(await processMarketingSnsInbox(deliveryWebhookCtx(), { workerId: 'feedback', deadlineAt: '2026-09-09T10:01:00.000Z', maxEvents: 10 }, { ...fixture.deps, sns }));
    }
    expect(await fixture.db.select().from(marketingSnsInbox)).toHaveLength(1);
    expect((await fixture.db.select().from(emailEvents)).filter((event) => event.type === 'delivered')).toHaveLength(1);
    expect(directoryValue(await api.listEmailSends({ contactId: sent.contactId })).sends).toMatchObject([{ id: sent.id, contactId: sent.contactId, deliveryStatus: 'delivered' }]);
    const replay = await importCsv(csv, 'contacts', 'contacts-replay');
    expect(replay.resultCounts.membershipsAdded).toBe(0);
    fixture.setNow('2026-09-09T10:00:51.000Z');
    directoryValue(await campaignTick(deliveryWorkerCtx(), { ...tick, workerId: 'replay' }, fixture.deps));
    expect(await fixture.db.select().from(marketingContacts)).toHaveLength(4);
    expect(await fixture.db.select().from(marketingListMemberships)).toHaveLength(5);
    expect(await fixture.db.select().from(campaignSends)).toHaveLength(4);
    expect(directoryValue(await api.getMarketingCampaign(campaign.id)).campaign).toMatchObject({ status: 'finished', sent: 2, skipped: 2, toSend: 3, candidateCount: 4 });
    expect(fixture.sent).toHaveLength(2);
  }, 60_000);
});
