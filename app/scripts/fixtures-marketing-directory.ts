import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ApiClient } from '#core/client/index.js';
import { MARKETING_IMPORT_ATTESTATION_VERSION } from '#core/client/index.js';
import { fixtureKey } from '../apps/web/src/stories/fixture-key.js';
import type { Result, AppError } from '#core/domain/index.js';

const unwrap = <T>(result: Result<T, AppError>): T => { if (!result.ok) throw new Error(result.error.message); return result.value; };
type Capture = (name: string, route: string, extra: (api: ApiClient) => Promise<void>, expectedErrors?: Record<string, AppError['code']>) => Promise<void>;
const aliases = new Map<string, string>();
const alias = (id: string, value: string) => { aliases.set(id, value); return id; };

export const normalizeMarketingDirectoryFixture = (input: unknown): unknown => {
  const scan = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(scan); return; }
    const record = z.record(z.unknown()).parse(value);
    const receipt = z.object({ contactId: z.string().nullable(), consentRowId: z.string().nullable(), normalizedPayload: z.object({ email: z.string() }).nullable() }).safeParse(record);
    if (receipt.success && receipt.data.normalizedPayload) {
      const suffix = createHash('sha256').update(receipt.data.normalizedPayload.email).digest('hex').slice(0, 12);
      if (receipt.data.contactId) alias(receipt.data.contactId, `contact-${suffix}`);
      if (receipt.data.consentRowId) alias(receipt.data.consentRowId, `consent-${suffix}`);
    }
    if (typeof record['id'] === 'string') {
      if (typeof record['email'] === 'string') alias(record['id'], `contact-${createHash('sha256').update(record['email']).digest('hex').slice(0, 12)}`);
      else if (typeof record['subjectId'] === 'string') alias(record['id'], `event-${aliases.get(record['subjectId']) ?? record['subjectId']}-${String(record['sequence'])}`);
    }
    Object.values(record).forEach(scan);
  };
  scan(input);
  let json = JSON.stringify(input);
  for (const [id, name] of aliases) json = json.replaceAll(id, name);
  json = json.replaceAll(/[a-f0-9]{64}/g, 'a'.repeat(64));
  const normalized: unknown = JSON.parse(json);
  const sortCollections = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(sortCollections); return; }
    const record = z.record(z.unknown()).parse(value);
    for (const key of ['contacts', 'lists']) {
      const collection = record[key];
      if (Array.isArray(collection)) collection.sort((left: unknown, right: unknown) => {
        const a = z.object({ id: z.string() }).safeParse(left);
        const b = z.object({ id: z.string() }).safeParse(right);
        return a.success && b.success ? a.data.id.localeCompare(b.data.id, 'en') : 0;
      });
    }
    Object.values(record).forEach(sortCollections);
  };
  sortCollections(normalized);
  return normalized;
};

export const recordMarketingDirectoryFixtures = async (api: ApiClient, tick: () => Promise<void>, capture: Capture): Promise<void> => {
  const lists = async (client: ApiClient) => { await client.listMarketingLists({ limit: 100 }); };
  const consents = async (client: ApiClient) => { await client.listMarketingConsentDefinitions(); };
  const contacts = async (client: ApiClient) => { await lists(client); await consents(client); await client.listMarketingContacts({ limit: 50, archived: false }); };
  await capture('panel-marketing-contacts-empty', '/panel/marketing/contacts', contacts);
  await capture('panel-marketing-lists-empty', '/panel/marketing/lists', async (client) => { await client.listMarketingLists({ limit: 50, archived: false }); });
  await capture('panel-marketing-list-new', '/panel/marketing/lists/new', async () => undefined);
  await capture('panel-marketing-contact-import', '/panel/marketing/contacts/import', consents);
  await capture('panel-marketing-suppression-import', '/panel/marketing/contacts/import?kind=suppressions', async () => undefined);
  const definition = unwrap(await api.createMarketingConsentDefinition({ key: 'directory-news', label: 'Email news and product updates', doubleOptIn: false, documentRef: { mode: 'url', url: 'https://courses.example.org/privacy' } })).definition;
  if (!definition) throw new Error('Missing fixture consent definition');
  alias(definition.id, 'definition-directory-news');
  const staticList = unwrap(await api.createMarketingList({ key: 'newsletter', name: 'Newsletter' })).list;
  const dynamicList = unwrap(await api.createMarketingList({ key: 'launch', name: 'Launch contacts', rule: { kind: 'tag', tags: ['launch'], match: 'any' } })).list;
  alias(staticList.id, 'list-newsletter'); alias(dynamicList.id, 'list-launch');
  const attestation: Parameters<ApiClient['commitMarketingContactImport']>[0]['attestation'] = { accepted: true as const, version: MARKETING_IMPORT_ATTESTATION_VERSION, locale: 'en' as const, note: 'Synthetic newsletter export; permission evidence is retained in the demo archive.' };
  const suppression = unwrap(await api.uploadMarketingContactImport({ csv: 'email,reason,at\nblocked@example.org,unsubscribe,2026-06-01T10:00:00Z', metadata: { kind: 'suppressions', datasetVersion: 'together-marketing-contacts/v1', fileName: 'suppressions.csv', idempotencyKey: 'fixture-suppressions' } }));
  alias(suppression.import.id, 'import-suppressions');
  await capture('panel-marketing-suppression-preview', `/panel/marketing/contacts/import?importId=${suppression.import.id}`, async (client) => { await client.getMarketingContactImport({ importId: suppression.import.id }); await client.validateMarketingContactImport({ importId: suppression.import.id }); });
  unwrap(await api.commitMarketingContactImport({ importId: suppression.import.id, validationHash: suppression.validationHash, attestation }));
  await tick();
  await capture('panel-marketing-suppression-result', `/panel/marketing/contacts/import?importId=${suppression.import.id}`, async (client) => { await client.getMarketingContactImport({ importId: suppression.import.id }); });
  const preview = unwrap(await api.uploadMarketingContactImport({ csv: 'email,name,tags,lists,consentAt\nanna@example.org,Anna Example,launch,newsletter,2026-06-01T10:00:00Z\nblocked@example.org,Blocked Contact,launch,newsletter,2026-06-01T10:00:00Z\n ANNA@example.org ,Anna Example,news,newsletter,2026-06-01T10:00:00Z\ninvalid,Invalid Address,,,', metadata: { kind: 'contacts', datasetVersion: 'together-marketing-contacts/v1', fileName: 'contacts.csv', consentDefinitionId: definition.id, idempotencyKey: 'fixture-contacts' } }));
  alias(preview.import.id, 'import-contacts');
  const importRoute = `/panel/marketing/contacts/import?importId=${preview.import.id}`;
  await capture('panel-marketing-contact-preview', importRoute, async (client) => { await consents(client); await client.getMarketingContactImport({ importId: preview.import.id }); await client.validateMarketingContactImport({ importId: preview.import.id }); });
  unwrap(await api.commitMarketingContactImport({ importId: preview.import.id, validationHash: preview.validationHash, attestation, invalidRows: 'skip_invalid' }));
  await capture('panel-marketing-contact-queued', importRoute, async (client) => { await client.getMarketingContactImport({ importId: preview.import.id }); });
  await tick();
  await capture('panel-marketing-contact-result', importRoute, async (client) => { await client.getMarketingContactImport({ importId: preview.import.id }); await client.getMarketingContactImportRows({ importId: preview.import.id, offset: 0, limit: 200 }); });
  const projected = unwrap(await api.listMarketingContacts({ consentDefinitionId: definition.id, limit: 50 })).contacts;
  const allowedView = projected.find((contact) => contact.email === 'anna@example.org');
  const suppressedView = projected.find((contact) => contact.email === 'blocked@example.org');
  if (allowedView?.consentState !== 'active' || allowedView.suppressionReason !== null || !allowedView.listKeys.includes('newsletter') || suppressedView?.consentState !== 'none' || suppressedView.suppressionReason !== 'unsubscribe_global') throw new Error('Directory projections disagree with imported evidence');
  const linked = unwrap(await api.upsertMarketingContact({ email: 'creator@together.dev', displayName: 'Studio Owner', source: 'member' })).contact;
  if (linked.memberId === null) throw new Error('Seeded account was not linked to its contact');
  await capture('panel-marketing-contacts', '/panel/marketing/contacts', async (client) => { await contacts(client); await client.listMarketingContacts({ limit: 50, archived: false, consentDefinitionId: definition.id }); });
  const listDetail = async (client: ApiClient, listId: string) => { await consents(client); await client.getMarketingList({ listId }); await client.getMarketingListContacts({ listId, limit: 20 }); };
  await capture('panel-marketing-lists', '/panel/marketing/lists', async (client) => { await client.listMarketingLists({ limit: 50, archived: false }); await client.getMarketingList({ listId: staticList.id }); await client.getMarketingList({ listId: dynamicList.id }); });
  await capture('panel-marketing-list-static', `/panel/marketing/lists/${staticList.id}`, async (client) => listDetail(client, staticList.id));
  await capture('panel-marketing-list-dynamic', `/panel/marketing/lists/${dynamicList.id}`, async (client) => listDetail(client, dynamicList.id));
  const products = unwrap(await api.listProducts()).products;
  const product = products[0];
  if (!product) throw new Error('Missing seeded product');
  for (const rule of [{ kind: 'product_grant', productIds: [product.id], state: 'ever' }, { kind: 'consent_definition', definitionId: definition.id, state: 'active' }] as const) {
    const saved = unwrap(await api.createMarketingList({ key: rule.kind, name: rule.kind === 'product_grant' ? 'Product access' : 'Active permission', rule: rule.kind === 'product_grant' ? { ...rule, productIds: [...rule.productIds] } : rule })).list;
    alias(saved.id, `list-${rule.kind}`);
    await capture(`panel-marketing-list-${rule.kind.replaceAll('_', '-')}`, `/panel/marketing/lists/${saved.id}`, async (client) => { await listDetail(client, saved.id); if (rule.kind === 'product_grant') await client.listProducts(); });
  }
  const contact = unwrap(await api.listMarketingContacts({ search: 'anna@example.org', limit: 100 })).contacts[0];
  if (!contact) throw new Error('Missing recorded contact');
  alias(contact.id, `contact-${createHash('sha256').update(contact.email).digest('hex').slice(0, 12)}`);
  await capture('panel-marketing-contact-detail', `/panel/marketing/contacts/${contact.id}`, async (client) => { await client.getMarketingContact({ contactId: contact.id }); await client.listMarketingContacts({ id: contact.id, archived: false, limit: 1 }); await lists(client); await consents(client); });
  for (const [method, routePath, input] of [
    ['getMarketingContact', '/panel/marketing/contacts/missing', { contactId: 'missing' }],
    ['getMarketingList', '/panel/marketing/lists/missing', { listId: 'missing' }],
    ['getMarketingContactImport', '/panel/marketing/contacts/import?importId=missing', { importId: 'missing' }],
  ] as const) {
    await capture(`panel-marketing-${method === 'getMarketingContact' ? 'contact' : method === 'getMarketingList' ? 'list' : 'import'}-error`, routePath, async (client) => {
      if (method === 'getMarketingContact') await client.getMarketingContact(input);
      else if (method === 'getMarketingList') await client.getMarketingList(input);
      else await client.getMarketingContactImport(input);
    }, { [fixtureKey(method, [input])]: 'not_found' });
  }
  const failureList = unwrap(await api.createMarketingList({ key: 'retired', name: 'Retired list' })).list;
  alias(failureList.id, 'list-retired');
  const failure = unwrap(await api.uploadMarketingContactImport({ csv: 'email,lists\nfailure@example.org,retired', metadata: { kind: 'contacts', datasetVersion: 'together-marketing-contacts/v1', fileName: 'failure.csv', idempotencyKey: 'fixture-failure' } }));
  alias(failure.import.id, 'import-failure');
  unwrap(await api.commitMarketingContactImport({ importId: failure.import.id, validationHash: failure.validationHash, attestation }));
  unwrap(await api.archiveMarketingList({ listId: failureList.id, expectedRevision: failureList.revision }));
  await tick();
  const failureRoute = `/panel/marketing/contacts/import?importId=${failure.import.id}`;
  await capture('panel-marketing-contact-failed', failureRoute, async (client) => { await client.getMarketingContactImport({ importId: failure.import.id }); });
  unwrap(await api.cancelMarketingContactImport({ importId: failure.import.id }));
  await capture('panel-marketing-contact-cancelled', failureRoute, async (client) => { await client.getMarketingContactImport({ importId: failure.import.id }); });
  const large = unwrap(await api.uploadMarketingContactImport({ csv: 'email\n' + Array.from({ length: 201 }, (_, index) => `pending-${index}@example.org`).join('\n'), metadata: { kind: 'contacts', datasetVersion: 'together-marketing-contacts/v1', fileName: 'processing.csv', idempotencyKey: 'fixture-processing' } }));
  alias(large.import.id, 'import-processing');
  unwrap(await api.commitMarketingContactImport({ importId: large.import.id, validationHash: large.validationHash, attestation }));
  await tick();
  await capture('panel-marketing-contact-processing', `/panel/marketing/contacts/import?importId=${large.import.id}`, async (client) => { await client.getMarketingContactImport({ importId: large.import.id }); });
  await tick();
  await capture('panel-marketing-contact-completed', `/panel/marketing/contacts/import?importId=${large.import.id}`, async (client) => { await client.getMarketingContactImport({ importId: large.import.id }); });

};
