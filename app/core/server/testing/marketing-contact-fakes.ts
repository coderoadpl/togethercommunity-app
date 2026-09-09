import type { MarketingContactDeps } from '../marketing-contact-ports.js';
import type { Ctx } from '../context.js';

const unexpected = (): never => { throw new Error('Unexpected directory dependency call'); };
export const marketingContactCtx = (): Ctx => ({ identity: { userId: 'owner', email: 'owner@example.test', name: 'Owner', emailVerified: true, image: null, tenantId: 'tenant-a', tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner', memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false } });
export const marketingContactDeps = (overrides: Partial<MarketingContactDeps> = {}): MarketingContactDeps => ({
  contacts: { lockAddress: unexpected, findById: unexpected, findByEmail: unexpected, listPage: unexpected, upsertByEmail: unexpected, update: unexpected, archive: unexpected },
  lists: { findById: unexpected, findByKey: unexpected, listPage: unexpected, save: unexpected, addMembers: unexpected, removeMembers: unexpected, validateRule: unexpected, counts: unexpected },
  imports: { findById: unexpected, findByKey: unexpected, save: unexpected, runnable: unexpected, rows: unexpected, nextRow: unexpected, rowsPage: unexpected, hasLists: unexpected, saveRow: unexpected, lock: unexpected, saveCsv: unexpected, readCsv: unexpected, clearStagedRows: unexpected, purgeStaging: unexpected },
  directoryEvents: { append: unexpected, list: unexpected },
  definitions: { create: unexpected, findById: unexpected, list: unexpected, update: unexpected, appendVersion: unexpected, listVersions: unexpected },
  consents: { record: unexpected, listByEmail: unexpected, latestByEmail: unexpected, findById: unexpected, purgeStalePending: unexpected },
  suppressions: { record: unexpected, findActive: unexpected, isSuppressed: unexpected, lift: unexpected, findById: unexpected, list: unexpected },
  memberSync: { next: unexpected, complete: unexpected },
  transaction: { run: unexpected }, clock: { nowIso: () => '2026-09-08T10:00:00.000Z' }, ids: { nextId: () => 'generated-id' }, hmac: { compute: unexpected }, contentHash: { sha256: (value) => typeof value === 'string' ? value : new TextDecoder().decode(value) },
  ...overrides,
});
