import { createContentHash } from '../crypto/content-hash.js';

import { capabilitiesForPrincipal, type Result, type AppError } from '#core/domain/index.js';
import type { Ctx, MarketingContactDeps } from '#core/server/index.js';

import { createEmailHmac } from '../crypto/email-hmac.js';
import { createTestDatabase } from './test-database-name.js';
import { createMarketingImportTransaction, createMarketingImportTransactionRepos } from './marketing-contact-transactions.js';
import { tenants } from './schema.js';

export const DIRECTORY_NOW = '2026-09-08T10:00:00.000Z';
export const directoryCtx = (tenantId = 'directory-a'): Ctx => ({ identity: { userId: 'directory-owner', email: 'owner@example.test', name: 'Owner', emailVerified: true, image: null, tenantId, tenantSlug: tenantId, tenantName: 'Directory', staffRole: 'owner', memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false } });
export const directoryWorkerCtx = (): Ctx => ({ ...directoryCtx(), capabilities: capabilitiesForPrincipal('operator-secret') });
export const directoryValue = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};
export const createDirectoryFixture = async () => {
  const database = await createTestDatabase('together_contacts_test', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  let now = DIRECTORY_NOW;
  const infrastructure = { clock: { nowIso: () => now }, ids: { nextId: () => crypto.randomUUID() }, hmac: createEmailHmac(Buffer.alloc(32, 1).toString('base64')), contentHash: createContentHash() };
  const deps: MarketingContactDeps = { ...infrastructure, ...createMarketingImportTransactionRepos(database.db, infrastructure), transaction: createMarketingImportTransaction(database.db, infrastructure) };
  await database.db.insert(tenants).values([{ id: 'directory-a', slug: 'directory-a', name: 'Directory A', createdAt: DIRECTORY_NOW }, { id: 'directory-b', slug: 'directory-b', name: 'Directory B', createdAt: DIRECTORY_NOW }]);
  await deps.definitions.create('directory-a', { id: 'newsletter', tenantId: 'directory-a', key: 'newsletter', kind: 'optional_marketing', channel: 'email', doubleOptIn: false, documentRef: { mode: 'url', url: 'https://courses.example.org/legal' }, status: 'active', createdAt: DIRECTORY_NOW, updatedAt: DIRECTORY_NOW }, { id: 'newsletter-v1', tenantId: 'directory-a', definitionId: 'newsletter', version: 1, label: 'Newsletter consent', documentVersionRef: { mode: 'url', url: 'https://courses.example.org/legal' }, createdAt: DIRECTORY_NOW, createdBy: 'owner' });
  return { ...database, deps, setNow: (value: string) => { now = value; } };
};
