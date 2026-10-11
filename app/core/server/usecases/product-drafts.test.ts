import { describe, expect, it, vi } from 'vitest';

import { err, integrationUnavailable, ok, productDownloadAssetSchema } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { ProductDraftDeletion } from '../product-draft-ports.js';
import { deleteProductDraft, type ProductDraftDeps } from './product-drafts.js';

const ctx: Ctx = { identity: { userId: 'owner', email: 'owner@example.test', name: 'Owner', emailVerified: true, tenantAccess: 'staff', tenantId: 'workspace', tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner', memberId: null, image: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false } };
const asset = productDownloadAssetSchema.parse({ id: 'asset', lineageId: 'asset', tenantId: 'workspace', productId: 'draft', fileName: 'guide.pdf', contentType: 'application/pdf', sizeBytes: 100, storageKey: 'product-downloads/draft/asset/guide.pdf', status: 'ready', createdAt: '2026-10-11T12:00:00.000Z' });
const depsFor = (result: ProductDraftDeletion) => {
  const sequence: string[] = [];
  const deleteDraft = vi.fn(async () => { sequence.push('committed'); return result; });
  const remove = vi.fn(async () => { sequence.push('storage'); return ok({ deleted: true as const }); });
  const deps: ProductDraftDeps = {
    productDrafts: { deleteDraft },
    logger: { error: vi.fn() },
    secretResolver: { resolve: async () => ok(JSON.stringify({ provider: 'minio', endpoint: 'https://storage.example.test', region: 'us-east-1', bucket: 'files', accessKeyId: 'test-key', secretAccessKey: 'test-secret' })) },
    storage: {
      objectUrl: (configuration, key) => new URL(`${configuration.endpoint}/${configuration.bucket}/${key}`),
      delete: remove,
      getObject: async () => ok(new Uint8Array()),
      probe: async () => ok({ code: 'storage.available', message: 'Available' }),
      probeCors: async () => [],
      presignPut: () => ok('https://storage.example.test'),
      presignGet: () => ok('https://storage.example.test'),
      head: async () => ok({ sizeBytes: 100 }),
      healthcheck: async () => ok({ healthy: true }),
      test: async () => ok({ code: 'storage.available', message: 'Available' }),
    },
  };
  return { deps, sequence, deleteDraft, remove };
};

describe('deleteProductDraft', () => {
  it.each([
    ['published', 'published'],
    ['unknown_history', 'publication history'],
    ['orders', 'orders'],
    ['grants', 'grants'],
    ['sales_links', 'sales link'],
    ['checkout_snapshots', 'checkout snapshot'],
  ] as const)('refuses %s with a specific validation reason', async (reason, message) => {
    const { deps, remove } = depsFor({ kind: 'refused', reason });
    expect(await deleteProductDraft(ctx, { productId: 'draft' }, deps)).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining(message) } });
    expect(remove).not.toHaveBeenCalled();
  });

  it('authorizes before touching the repository', async () => {
    const { deps, deleteDraft } = depsFor({ kind: 'deleted', assets: [] });
    const member = { identity: { ...ctx.identity, tenantAccess: 'member' as const, staffRole: null, memberId: 'member' } };
    expect(await deleteProductDraft(member, { productId: 'draft' }, deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(deleteDraft).not.toHaveBeenCalled();
  });

  it('returns not found for a missing tenant-scoped draft', async () => {
    const { deps, deleteDraft } = depsFor({ kind: 'not_found' });
    expect(await deleteProductDraft(ctx, { productId: 'draft' }, deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(deleteDraft).toHaveBeenCalledWith('workspace', 'draft');
  });

  it('removes stored download objects only after the transaction commits', async () => {
    const { deps, sequence, remove } = depsFor({ kind: 'deleted', assets: [asset] });
    expect(await deleteProductDraft(ctx, { productId: 'draft' }, deps)).toEqual(ok({ deleted: true }));
    expect(sequence).toEqual(['committed', 'storage']);
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining(asset.storageKey) }));
  });

  it.each(['result', 'rejection', 'configuration'] as const)('logs %s cleanup failure without undoing the deletion', async (failure) => {
    const { deps } = depsFor({ kind: 'deleted', assets: [asset] });
    if (failure === 'result') deps.storage.delete = async () => err(integrationUnavailable('Storage unavailable'));
    if (failure === 'rejection') deps.storage.delete = async () => { throw new Error('Storage unavailable'); };
    if (failure === 'configuration') deps.secretResolver.resolve = async () => err(integrationUnavailable('Storage unavailable'));
    expect(await deleteProductDraft(ctx, { productId: 'draft' }, deps)).toEqual(ok({ deleted: true }));
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('Storage unavailable'));
  });
});
