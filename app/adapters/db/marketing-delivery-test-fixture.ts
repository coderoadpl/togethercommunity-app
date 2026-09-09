import { capabilitiesForPrincipal, ok } from '#core/domain/index.js';
import type { Ctx } from '#core/server/index.js';

import { createEmailHmac } from '../crypto/email-hmac.js';
import { createHtmlToText } from '../email/html-to-text.js';
import { createMarketingDeliveryRepos, createMarketingDeliveryTransaction } from './marketing-delivery-transactions.js';
import { createConsentDefinitionRepository, createEmailLayoutRepository, createMarketingConsentRepository, createMarketingThrottleRepository } from './marketing-repositories.js';
import { tenants, tenantSesSettings } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

export const DELIVERY_NOW = '2026-09-09T10:00:00.000Z';
export const deliveryCtx = (tenantId = 'delivery-a'): Ctx => ({
  identity: { userId: 'owner', email: 'owner@example.test', name: 'Owner', emailVerified: true, image: null, tenantId,
    tenantSlug: tenantId, tenantName: 'Example', staffRole: 'owner', memberId: null, memberDisplayName: null, memberBannedAt: null,
    memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false },
});
export const deliveryWorkerCtx = (tenantId = 'delivery-a'): Ctx => ({ ...deliveryCtx(tenantId), capabilities: capabilitiesForPrincipal('operator-secret') });
export const deliveryWebhookCtx = (tenantId = 'delivery-a'): Ctx => ({ ...deliveryCtx(tenantId), capabilities: capabilitiesForPrincipal('webhook') });

export const createDeliveryFixture = async () => {
  const database = await createTestDatabase('together_delivery_test', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  let now = Date.parse(DELIVERY_NOW);
  const sent: Array<{ to: string; html: string; text: string; replyTo?: string }> = [];
  const deps = {
    ...createMarketingDeliveryRepos(database.db), delivery: createMarketingDeliveryTransaction(database.db),
    definitions: createConsentDefinitionRepository(database.db), consents: createMarketingConsentRepository(database.db), layouts: createEmailLayoutRepository(database.db),
    hmac: createEmailHmac(Buffer.alloc(32, 1).toString('base64')), clock: { nowIso: () => new Date(now).toISOString() },
    ids: { nextId: () => crypto.randomUUID() }, tokens: { nextToken: () => crypto.randomUUID().replaceAll('-', '') },
    htmlToText: createHtmlToText(), waiter: { wait: async (ms: number) => { now += ms; } },
    credentials: { resolve: async () => ok({ accessKeyId: 'test', secretAccessKey: 'test', region: 'eu-central-1' }) },
    ses: { send: async (message: { to: string; html: string; text: string; replyTo?: string }) => { sent.push(message); now += 100; return ok({ messageId: `ses-${String(sent.length)}` }); } },
    throttle: createMarketingThrottleRepository(database.db), quotaReader: undefined,
    unsubscribeBaseUrl: async () => 'https://courses.example.org/u',
    sns: { verify: async () => { throw new Error('Receipt was already verified'); }, confirmSubscription: async () => ok(undefined) },
  };
  await database.db.insert(tenants).values([{ id: 'delivery-a', slug: 'delivery-a', name: 'Example A', createdAt: DELIVERY_NOW }, { id: 'delivery-b', slug: 'delivery-b', name: 'Example B', createdAt: DELIVERY_NOW }]);
  await database.db.insert(tenantSesSettings).values({ tenantId: 'delivery-a', fromAddress: 'sender@example.test', fromName: 'Example', replyTo: 'reply@example.test', identity: 'example.test', identityVerifiedAt: DELIVERY_NOW, webhookToken: 'delivery-webhook-token-123456', configurationSet: 'marketing', snsTopicArn: 'topic-a', webhookVerifiedAt: DELIVERY_NOW, quotaRefreshedAt: DELIVERY_NOW, quotaRatePerSec: 5, quotaDaily: 10000, inSandbox: false, broadcastsEnabled: true, footerLegalName: 'Example Company', footerAddress: '123 Example Street' });
  await deps.definitions.create('delivery-a', { id: 'consent', tenantId: 'delivery-a', key: 'updates', kind: 'optional_marketing', channel: 'email', doubleOptIn: false, documentRef: { mode: 'url', url: 'https://courses.example.org/legal' }, status: 'active', createdAt: DELIVERY_NOW, updatedAt: DELIVERY_NOW }, { id: 'consent-v1', tenantId: 'delivery-a', definitionId: 'consent', version: 1, label: 'Course updates', documentVersionRef: { mode: 'url', url: 'https://courses.example.org/legal' }, createdAt: DELIVERY_NOW, createdBy: 'owner' });
  const consent = async (email: string) => deps.consents.record('delivery-a', {
    id: crypto.randomUUID(), tenantId: 'delivery-a', memberId: null, email, definitionId: 'consent', definitionVersion: 1,
    wordingSnapshot: 'Course updates', documentRefSnapshot: { mode: 'url', url: 'https://courses.example.org/legal' }, status: 'granted', previousId: null, source: 'api', evidence: { collectedAt: DELIVERY_NOW }, occurredAt: DELIVERY_NOW,
  });
  return { ...database, deps, sent, consent, setNow: (value: string) => { now = Date.parse(value); } };
};
