import {
  err,
  integrationUnavailable,
  ok,
  storageListPageSchema,
  storageOrphanReportInputSchema,
  validation,
  type AppError,
  type Result,
  type StorageObjectClassification,
  type StorageOrphanReport,
  type StorageReferenceInventory,
} from '#core/domain/index.js';

import type { Clock, StorageProvider, StorageReferenceRepository, TenantSecretResolver } from '../ports.js';
import { resolveStorageConfiguration } from './storage-assets.js';

type JsonDocument = StorageReferenceInventory['currentDocuments'][number];

const collectReferences = (tenantId: string, documents: JsonDocument[]): Set<string> => {
  const keys = new Set<string>();
  const visit = (value: JsonDocument): void => {
    if (typeof value === 'string') {
      if (value.startsWith(`${tenantId}/`) || value.startsWith(`image-assets/${tenantId}/`)
        || value.startsWith('lesson-attachments/') || value.startsWith('product-downloads/')) {
        keys.add(value);
      }
      for (const match of value.matchAll(/\/api\/public\/assets\/(course-cover|product-cover|logo-dark|logo|favicon|share-image|avatar)\/([0-9a-f-]{36}\.(?:png|jpg|webp|svg|ico))/gi)) {
        keys.add(`image-assets/${tenantId}/${match[1]}/${match[2]}`);
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value !== null && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  documents.forEach(visit);
  return keys;
};

export const reportStorageOrphans = async (
  input: unknown,
  deps: {
    references: StorageReferenceRepository;
    storage: Pick<StorageProvider, 'list'>;
    secretResolver: TenantSecretResolver;
    clock: Clock;
  },
): Promise<Result<StorageOrphanReport, AppError>> => {
  const parsed = storageOrphanReportInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid storage report request', parsed.error.flatten()));
  const { tenantId, graceHours, maxPages } = parsed.data;
  const configuration = await resolveStorageConfiguration(tenantId, deps.secretResolver);
  if (!configuration.ok) return configuration;
  const inventory = await deps.references.readInventory(tenantId);
  const current = collectReferences(tenantId, inventory.currentDocuments);
  const history = collectReferences(tenantId, inventory.historyDocuments);
  const pending = new Set<string>();
  for (const attachment of inventory.attachments) {
    (attachment.status === 'pending' ? pending : current).add(attachment.storageKey);
  }
  for (const download of inventory.downloads) {
    const references = download.status === 'pending' ? pending
      : download.supersededAt === null ? current : history;
    references.add(download.storageKey);
  }
  const prefixes = [...new Set([
    `image-assets/${tenantId}/`,
    `image-asset-candidates/${tenantId}/`,
    `${tenantId}/lesson-attachments/`,
    `${tenantId}/product-downloads/`,
    ...inventory.lessonIds.map((id) => `lesson-attachments/${id}/`),
    ...inventory.productIds.map((id) => `product-downloads/${id}/`),
  ])];
  const report: StorageOrphanReport = {
    tenantId,
    generatedAt: deps.clock.nowIso(),
    graceHours,
    complete: true,
    pagesScanned: 0,
    summary: {
      referenced: 0,
      'referenced-by-history': 0,
      pending: 0,
      'within-grace-period': 0,
      'unreferenced-candidate': 0,
      'unknown-owner': 0,
    },
    objects: [],
    limitations: [
      'Report only: candidates are not proof that deletion is safe; references can change during the scan.',
      'Only the currently configured bucket and tenant namespaces are scanned.',
      'Legacy prefixes are discovered only from this tenant’s database rows; sibling keys without exact references have unknown ownership.',
      'Legacy objects whose resource rows and history were removed cannot be attributed or discovered by this tenant report.',
      'Replaced covers and branding images are retained. Branding replacements have no content-history snapshots.',
    ],
  };
  const cutoff = Date.parse(report.generatedAt) - graceHours * 3600_000;
  const seen = new Set<string>();
  for (const prefix of prefixes) {
    let continuationToken: string | null = null;
    const tokens = new Set<string>();
    do {
      if (report.pagesScanned >= maxPages
        || Date.parse(deps.clock.nowIso()) - Date.parse(report.generatedAt) >= 5 * 60_000) {
        report.complete = false;
        report.limitations.push('Scan budget exhausted; the summary covers only objects scanned so far.');
        return ok(report);
      }
      const listed = await deps.storage.list({ configuration: configuration.value, prefix, continuationToken, limit: 1000 });
      if (!listed.ok) return listed;
      const page = storageListPageSchema.safeParse(listed.value);
      if (!page.success || page.data.objects.some((object) => !object.key.startsWith(prefix))) {
        return err(integrationUnavailable('Storage returned an invalid or out-of-scope listing.'));
      }
      report.pagesScanned += 1;
      for (const object of page.data.objects) {
        if (seen.has(object.key)) continue;
        seen.add(object.key);
        const ownedNamespace = object.key.startsWith(`image-assets/${tenantId}/`)
          || object.key.startsWith(`image-asset-candidates/${tenantId}/`)
          || object.key.startsWith(`${tenantId}/`);
        const classification: StorageObjectClassification = current.has(object.key) ? 'referenced'
          : history.has(object.key) ? 'referenced-by-history'
          : pending.has(object.key) ? 'pending'
          : !ownedNamespace ? 'unknown-owner'
          : Date.parse(object.lastModified) >= cutoff ? 'within-grace-period'
          : 'unreferenced-candidate';
        report.summary[classification] += 1;
        report.objects.push({ ...object, classification });
      }
      continuationToken = page.data.continuationToken;
      if (continuationToken !== null) {
        if (tokens.has(continuationToken)) return err(integrationUnavailable('Storage repeated a listing continuation token.'));
        tokens.add(continuationToken);
      }
    } while (continuationToken !== null);
  }
  return ok(report);
};
