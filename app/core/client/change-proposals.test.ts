import { QueryClient } from '@tanstack/query-core';
import { describe, expect, it, vi } from 'vitest';

import { API_ROUTES, SHOP_ASSETS_ROUTES, SHOP_CATALOG_ROUTES, SHOP_DOWNLOAD_ROUTES, SHOP_PROPOSAL_ROUTES, SHOP_SETTINGS_ROUTES } from '#core/contract/index.js';
import { shopSettingsSchema } from '#core/domain/index.js';

import { createApiClient, createShopManagementClient, isProposedChange } from './http.js';
import {
  approveChangeProposalGroupMutation,
  approveChangeProposalInvalidates,
  approveChangeProposalMutation,
  changeProposalGroupQuery,
  changeProposalQuery,
  changeProposalsInvalidates,
  changeProposalsQuery,
  changeProposalSummaryQuery,
  productDownloadAssetsQuery,
  productPricesQuery,
  productsQuery,
  productStockQuery,
  rejectChangeProposalGroupMutation,
  rejectChangeProposalMutation,
  tenantSettingsQuery,
} from './queries.js';
import { salesLinkActions } from './sales-links.js';

const receipt = {
  id: 'proposal-1', status: 'pending', operation: 'product.update', target: { kind: 'product', id: 'product-1' }, groupId: null,
  createdAt: '2026-11-15T10:00:00.000Z', expiresAt: '2026-12-15T10:00:00.000Z', input: { id: 'product-1', title: 'Renamed' },
  decisionNote: null, appliedResourceId: null, failureCode: null,
};
const ownerView = {
  id: 'proposal-1', groupId: null, groupTitle: null, groupPosition: null, operation: 'product.update', target: { kind: 'product', id: 'product-1' },
  targetLabel: 'Handbook', targetPrice: null,
  input: { id: 'product-1', title: 'Renamed' }, effect: { title: { before: 'Handbook', after: 'Renamed' } }, status: 'pending',
  proposedBy: { keyId: 'key-1', keyName: 'Catalogue agent', keyState: 'active', issuerUserId: 'owner-1', issuerEmail: 'owner@acme.example.test', issuerIsVerifiedOwner: true,
    issuerIsFormerTeamMember: false },
  createdAt: '2026-11-15T10:00:00.000Z', expiresAt: '2026-12-15T10:00:00.000Z', decidedByUserId: null, decidedByEmail: null,
  decidedByIsFormerTeamMember: false, decidedAt: null,
  decisionNote: null, appliedResourceId: null, failureCode: null, failureMessage: null,
};
const product = {
  id: 'product-1', tenantId: 'acme', type: 'physical', slug: 'handbook', title: 'Handbook', description: '',
  coverUrl: null, priceCents: 4900, currency: 'PLN', published: false, visibility: 'listed', deliveryMethod: 'pickup',
  parcelTemplate: 'medium', compliance: null, variantGroup: null, variantLabel: null, accessItems: [], checkoutConsentDefinitionIds: [],
  vatRate: null, vatExemptionBasis: null, legacyId: null, createdAt: '2026-11-15T10:00:00.000Z',
};

const urlOf = (input: Parameters<typeof fetch>[0]): URL =>
  new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

describe('shop management client with a propose-mode key', () => {
  it('returns the receipt of a 202 as a proposed outcome on every catalogue mutation', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true, data: { outcome: 'proposed', proposal: receipt } }, { status: 202 }));
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', tenant: 'acme', fetchImpl });
    const results = [
      await client.createProduct({ title: 'Handbook', type: 'physical', priceCents: 4900 }),
      await client.updateProduct({ id: 'product-1', title: 'Renamed' }),
      await client.publishProduct({ id: 'product-1' }),
      await client.unpublishProduct({ id: 'product-1' }),
      await client.deleteProductDraft({ productId: 'product-1' }),
      await client.setProductAccess({ id: 'product-1', accessItems: [] }),
      await client.createProductPrice({ productId: 'product-1', kind: 'one_time', amountCents: 4900 }),
      await client.deactivateProductPrice({ id: 'price-1' }),
      await client.enableProductStock({ productId: 'product-1', onHand: 3, lowStockThreshold: null }),
      await client.adjustProductStock({ productId: 'product-1', delta: 1, reason: 'delivery' }),
      await client.setProductStockThreshold({ productId: 'product-1', lowStockThreshold: 1 }),
    ];
    expect(results).toHaveLength(Object.values(SHOP_CATALOG_ROUTES).filter((route) => route.method !== 'GET').length);
    for (const result of results) expect(result).toEqual({ ok: true, value: { outcome: 'proposed', proposal: receipt } });
  });

  it('says that an image a propose-mode key uploaded is quarantined until an approved proposal attaches it', async () => {
    const digest = 'a'.repeat(64);
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === 'storage.example.test') return new Response(null);
      if (url.pathname === SHOP_CATALOG_ROUTES.updateProduct.path) {
        return Response.json({ ok: true, data: { outcome: 'proposed', proposal: receipt } }, { status: 202 });
      }
      return Response.json({ ok: true, data: url.pathname.endsWith('/upload')
        ? { key: 'image-asset-candidates/acme/product-cover/1.png', servePath: null, quarantined: true, upload: { url: 'https://storage.example.test/candidate', headers: { 'content-type': 'image/png' }, expiresAt: '2026-11-15T10:15:00.000Z' } }
        : { url: `/api/public/assets/product-cover/${digest}.png`, quarantined: true } });
    });
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', fetchImpl });
    const uploaded = await client.uploadProductCover({ kind: 'product-cover', fileName: 'cover.png', contentType: 'image/png', sizeBytes: 4, body: new Uint8Array(4) });
    expect(uploaded).toEqual({ ok: true, value: { url: `/api/public/assets/product-cover/${digest}.png`, quarantined: true } });
    if (!uploaded.ok) throw new Error('upload failed');
    const attached = await client.updateProduct({ id: 'product-1', coverUrl: uploaded.value.url });
    expect(attached.ok && isProposedChange(attached.value)).toBe(true);
  });

  it('returns the receipt of a 202 as a proposed outcome on the sales-link and settings mutations', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      seen.push(`${init?.method ?? 'GET'} ${urlOf(input).pathname}`);
      return Response.json({ ok: true, data: { outcome: 'proposed', proposal: receipt } }, { status: 202 });
    });
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', tenant: 'acme', fetchImpl });
    const link = { slug: 'spring', title: 'Spring', heading: 'Spring sale', productIds: ['product-1'] };
    const results = [
      await client.createSalesLink(link),
      await client.updateSalesLink({ ...link, id: 'link-1', expectedRevision: 1 }),
      await client.deleteSalesLink({ id: 'link-1' }),
      await client.updateSettings({ name: 'Acme shop' }),
    ];
    for (const result of results) expect(result).toEqual({ ok: true, value: { outcome: 'proposed', proposal: receipt } });
    expect(seen).toEqual([
      `POST ${SHOP_ASSETS_ROUTES.createSalesLink.path}`,
      `POST ${SHOP_ASSETS_ROUTES.updateSalesLink.path.replace(':id', 'link-1')}`,
      `DELETE ${SHOP_ASSETS_ROUTES.deleteSalesLink.path.replace(':id', 'link-1')}`,
      `POST ${SHOP_SETTINGS_ROUTES.updateSettings.path}`,
    ]);
  });

  it('returns the receipt of a 202 as a proposed outcome on the file attach, replace and remove calls, with the group header when given', async () => {
    const seen: Array<{ call: string; group: string | null }> = [];
    const fileReceipt = { ...receipt, operation: 'download.add', input: { productId: 'product-1', stagedFileId: 'staged-1' } };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      seen.push({ call: `${init?.method ?? 'GET'} ${urlOf(input).pathname}`, group: new Headers(init?.headers).get('x-proposal-group') });
      return Response.json({ ok: true, data: { outcome: 'proposed', proposal: fileReceipt } }, { status: 202 });
    });
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', tenant: 'acme', fetchImpl });
    const results = [
      await client.addProductDownload({ productId: 'product-1', stagedFileId: 'staged-1' }, undefined, { groupId: 'group-1' }),
      await client.replaceProductDownload({ productId: 'product-1', replacesAssetId: 'asset-1', stagedFileId: 'staged-1' }),
      await client.removeProductDownload({ productId: 'product-1', assetId: 'asset-1' }, undefined, { groupId: 'group-1' }),
    ];
    for (const result of results) expect(result).toEqual({ ok: true, value: { outcome: 'proposed', proposal: fileReceipt } });
    expect(seen).toEqual([
      { call: `POST ${SHOP_DOWNLOAD_ROUTES.addProductDownload.path}`, group: 'group-1' },
      { call: `POST ${SHOP_DOWNLOAD_ROUTES.replaceProductDownload.path}`, group: null },
      { call: `POST ${SHOP_DOWNLOAD_ROUTES.removeProductDownload.path}`, group: 'group-1' },
    ]);
  });

  it('marks a live file attach as applied and keeps the attached file', async () => {
    const asset = {
      id: 'staged-1', lineageId: 'staged-1', versionNumber: 1, versionNote: null, supersededAt: null, productId: 'product-1', fileName: 'workbook.pdf',
      contentType: 'application/pdf', sizeBytes: 4, status: 'ready', createdAt: '2026-11-15T10:00:00.000Z', personalisationSizeExceeded: false,
    };
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true, data: { asset } }));
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', fetchImpl });
    expect(await client.addProductDownload({ productId: 'product-1', stagedFileId: 'staged-1' })).toEqual({ ok: true, value: { outcome: 'applied', asset } });
  });

  it('marks a live sales-link deletion and settings update as applied', async () => {
    const settings = shopSettingsSchema.parse({ name: 'Acme shop', supportEmail: 'help@acme.example.test' });
    const fetchImpl = vi.fn<typeof fetch>(async (input) => Response.json({ ok: true, data: urlOf(input).pathname === SHOP_SETTINGS_ROUTES.updateSettings.path ? { settings } : { deleted: true } }));
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', fetchImpl });
    expect(await client.deleteSalesLink({ id: 'link-1' })).toEqual({ ok: true, value: { outcome: 'applied', deleted: true } });
    expect(await client.updateSettings({ name: 'Acme shop' })).toEqual({ ok: true, value: { outcome: 'applied', settings } });
  });

  it('refuses a live settings answer that is not the shop settings', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true, data: { settings: { bogus: true } } }));
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', fetchImpl });
    expect(await client.updateSettings({ name: 'Acme shop' })).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('marks a live answer as applied and keeps its resource', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true, data: { product } }));
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', fetchImpl });
    const result = await client.publishProduct({ id: 'product-1' });
    if (!result.ok) throw new Error(result.error.message);
    expect(isProposedChange(result.value)).toBe(false);
    expect(result.value).toMatchObject({ outcome: 'applied', product: { id: 'product-1' } });
  });

  it('marks a live answer about what a product grants as applied and keeps the product', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true, data: { product: { ...product, accessItems: [{ level: 'course', courseId: 'course-1' }] } } }));
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', fetchImpl });
    const result = await client.setProductAccess({ id: 'product-1', accessItems: [{ level: 'course', courseId: 'course-1' }] });
    if (!result.ok) throw new Error(result.error.message);
    expect(isProposedChange(result.value)).toBe(false);
    expect(result.value).toMatchObject({ outcome: 'applied', product: { accessItems: [{ level: 'course', courseId: 'course-1' }] } });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(`https://platform.example.test${SHOP_CATALOG_ROUTES.setProductAccess.path}`);
  });

  it('refuses a 202 body that is not a key receipt', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true, data: { outcome: 'proposed', proposal: { ...receipt, effect: {} } } }, { status: 202 }));
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', fetchImpl });
    expect(await client.updateProduct({ id: 'product-1', title: 'Renamed' })).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('lists, shows and withdraws the key\'s own proposals with the key headers only', async () => {
    const seen: { method: string; url: URL; headers: Headers; body: unknown }[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      seen.push({ method: init?.method ?? 'GET', url, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
      return Response.json({ ok: true, data: url.pathname === SHOP_PROPOSAL_ROUTES.listProposals.path ? { proposals: [receipt], nextCursor: null } : { proposal: receipt } });
    });
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', tenant: 'acme', fetchImpl });
    const results = [
      await client.listProposals({ status: 'pending', limit: 10 }),
      await client.getProposal('proposal/1'),
      await client.withdrawProposal('proposal/1'),
    ];
    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(seen.map((call) => `${call.method} ${call.url.pathname}${call.url.search}`)).toEqual([
      'GET /api/m2m/shop/proposals?status=pending&limit=10',
      'GET /api/m2m/shop/proposals/proposal%2F1',
      'POST /api/m2m/shop/proposals/proposal%2F1/withdraw',
    ]);
    expect(seen[2]?.body).toEqual({});
    for (const call of seen) {
      expect(call.headers.get('x-api-key')).toBe('shop-secret');
      expect(call.headers.has('authorization')).toBe(false);
      expect(call.headers.has('cookie')).toBe(false);
    }
  });
});

const groupReceipt = {
  id: 'group-1', title: 'Spring launch', status: 'open', createdAt: '2026-11-15T10:00:00.000Z', expiresAt: '2026-12-15T10:00:00.000Z',
  items: [{ ...receipt, groupId: 'group-1' }],
};

describe('shop management client with a proposal group', () => {
  it('sends the group header on every proposable mutation given a group id, and returns the group with the receipt', async () => {
    const seen: Headers[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      seen.push(new Headers(init?.headers));
      return Response.json({ ok: true, data: { outcome: 'proposed', proposal: groupReceipt.items[0], group: groupReceipt } }, { status: 202 });
    });
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', fetchImpl });
    const group = { groupId: 'group-1' };
    const link = { slug: 'spring', title: 'Spring', heading: 'Spring sale', productIds: ['$proposal:proposal-0'] };
    const results = [
      await client.createProduct({ title: 'Handbook', type: 'physical', priceCents: 4900 }, undefined, group),
      await client.updateProduct({ id: 'product-1', title: 'Renamed' }, undefined, group),
      await client.publishProduct({ id: '$proposal:proposal-0' }, undefined, group),
      await client.unpublishProduct({ id: 'product-1' }, undefined, group),
      await client.deleteProductDraft({ productId: 'product-1' }, undefined, group),
      await client.setProductAccess({ id: '$proposal:proposal-0', accessItems: [{ level: 'course', courseId: 'course-1' }] }, undefined, group),
      await client.createProductPrice({ productId: '$proposal:proposal-0', kind: 'one_time', amountCents: 4900 }, undefined, group),
      await client.deactivateProductPrice({ id: 'price-1' }, undefined, group),
      await client.enableProductStock({ productId: 'product-1', onHand: 3, lowStockThreshold: null }, undefined, group),
      await client.adjustProductStock({ productId: 'product-1', delta: 1, reason: 'delivery' }, undefined, group),
      await client.setProductStockThreshold({ productId: 'product-1', lowStockThreshold: 1 }, undefined, group),
      await client.createSalesLink(link, undefined, group),
      await client.updateSalesLink({ ...link, id: 'link-1', expectedRevision: 1 }, undefined, group),
      await client.deleteSalesLink({ id: 'link-1' }, undefined, group),
      await client.updateSettings({ name: 'Acme shop' }, undefined, group),
    ];
    expect(results).toHaveLength(15);
    for (const result of results) expect(result).toMatchObject({ ok: true, value: { outcome: 'proposed', group: { id: 'group-1' } } });
    for (const headers of seen) expect(headers.get('x-proposal-group')).toBe('group-1');
    await client.publishProduct({ id: 'product-1' });
    expect(seen.at(-1)?.has('x-proposal-group')).toBe(false);
  });

  it('creates, shows and withdraws a group of the key', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      seen.push(`${init?.method ?? 'GET'} ${urlOf(input).pathname} ${typeof init?.body === 'string' ? init.body : ''}`);
      return Response.json({ ok: true, data: { group: groupReceipt } });
    });
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', fetchImpl });
    expect(await client.createProposalGroup({ title: 'Spring launch' })).toMatchObject({ ok: true, value: { group: { id: 'group-1' } } });
    expect(await client.getProposalGroup('group/1')).toMatchObject({ ok: true });
    expect(await client.withdrawProposalGroup('group-1')).toMatchObject({ ok: true });
    expect(seen).toEqual([
      'POST /api/m2m/shop/proposals/groups {"title":"Spring launch"}',
      'GET /api/m2m/shop/proposals/groups/group%2F1 ',
      'POST /api/m2m/shop/proposals/groups/group-1/withdraw {}',
    ]);
  });

  it('refuses a group receipt that carries an effect', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ ok: true, data: { group: { ...groupReceipt, items: [{ ...receipt, effect: {} }] } } }));
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', fetchImpl });
    expect(await client.getProposalGroup('group-1')).toMatchObject({ ok: false, error: { code: 'internal' } });
  });
});

const ownerGroup = {
  id: 'group-1', title: 'Spring launch', status: 'open',
  proposedBy: { keyId: 'key-1', keyName: 'Catalogue agent', issuerUserId: 'owner-1', issuerEmail: 'owner@acme.example.test', issuerIsVerifiedOwner: true, issuerIsFormerTeamMember: false, keyState: 'active' },
  createdAt: '2026-11-15T10:00:00.000Z', expiresAt: '2026-12-15T10:00:00.000Z',
  items: [{ ...ownerView, groupId: 'group-1', groupTitle: 'Spring launch', groupPosition: 1, events: [] }],
};

describe('owner change proposal group client', () => {
  it('reads, approves with the shown item ids and rejects a group through the session routes', async () => {
    const requests: string[] = [];
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async (url, init) => {
      requests.push(`${init?.method ?? 'GET'} ${new URL(String(url)).pathname} ${typeof init?.body === 'string' ? init.body : ''}`);
      return Response.json({ ok: true, data: { group: ownerGroup } });
    } });
    expect(await api.getChangeProposalGroup({ id: 'group-1' })).toMatchObject({ ok: true, value: { group: { items: [{ effect: ownerView.effect }] } } });
    expect(await api.approveChangeProposalGroup({ id: 'group-1', itemIds: ['proposal-1'] })).toMatchObject({ ok: true });
    expect(await api.rejectChangeProposalGroup({ id: 'group-1', note: 'Not now' })).toMatchObject({ ok: true });
    expect(await api.rejectChangeProposalGroup({ id: 'group/1' })).toMatchObject({ ok: true });
    expect(requests).toEqual([
      'GET /api/change-proposals/groups/group-1 ',
      'POST /api/change-proposals/groups/group-1/approve {"itemIds":["proposal-1"]}',
      'POST /api/change-proposals/groups/group-1/reject {"note":"Not now"}',
      'POST /api/change-proposals/groups/group%2F1/reject {}',
    ]);
  });

  it('describes the group query and the group decisions under the proposal prefix', async () => {
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async () => Response.json({ ok: true, data: { group: { ...ownerGroup, status: 'applied' } } }) });
    const prefix = changeProposalsInvalidates().queryKey;
    const detail = changeProposalGroupQuery(api, 'group-1');
    const approve = approveChangeProposalGroupMutation(api);
    const reject = rejectChangeProposalGroupMutation(api);
    for (const key of [detail.queryKey, approve.mutationKey, reject.mutationKey]) expect(key.slice(0, prefix.length)).toEqual([...prefix]);
    expect(approve.mutationKey).not.toEqual(approveChangeProposalMutation(api).mutationKey);
    await expect(approve.mutationFn({ id: 'group-1', itemIds: ['proposal-1'] }, { client: new QueryClient(), meta: undefined, mutationKey: approve.mutationKey }))
      .resolves.toMatchObject({ group: { status: 'applied' } });
    const filters = approveChangeProposalInvalidates().map((filter) => filter.queryKey);
    expect(filters.some((filter) => filter.every((part, index) => detail.queryKey[index] === part))).toBe(true);
  });
});

describe('owner change proposal client', () => {
  it('lists, shows and rejects change proposals through the session routes', async () => {
    const requests: Array<{ url: string; method: string | undefined; body: BodyInit | null | undefined }> = [];
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async (url, init) => {
      requests.push({ url: String(url), method: init?.method, body: init?.body });
      const path = new URL(String(url)).pathname;
      return Response.json({ ok: true, data: path === '/api/change-proposals'
        ? { proposals: [ownerView], nextCursor: null, hasMore: false }
        : path.endsWith('/reject') ? { proposal: { ...ownerView, status: 'rejected' } }
          : path.endsWith('/approve') ? { proposal: { ...ownerView, status: 'applied', appliedResourceId: 'product-1' } }
            : { proposal: { ...ownerView, events: [] } } });
    } });
    expect(await api.listChangeProposals({ status: 'pending' })).toMatchObject({ ok: true, value: { proposals: [{ id: 'proposal-1' }] } });
    expect(await api.getChangeProposal({ id: 'proposal-1' })).toMatchObject({ ok: true, value: { proposal: { effect: ownerView.effect, events: [] } } });
    expect(await api.rejectChangeProposal({ id: 'proposal-1', note: 'Not now' })).toMatchObject({ ok: true, value: { proposal: { status: 'rejected' } } });
    expect(await api.rejectChangeProposal({ id: 'proposal-1' })).toMatchObject({ ok: true });
    expect(await api.approveChangeProposal({ id: 'proposal/1' })).toMatchObject({ ok: true, value: { proposal: { status: 'applied' } } });
    expect(requests).toEqual([
      { url: 'http://localhost:48730/api/change-proposals?status=pending', method: 'GET', body: null },
      { url: 'http://localhost:48730/api/change-proposals/proposal-1', method: 'GET', body: null },
      { url: 'http://localhost:48730/api/change-proposals/proposal-1/reject', method: 'POST', body: JSON.stringify({ note: 'Not now' }) },
      { url: 'http://localhost:48730/api/change-proposals/proposal-1/reject', method: 'POST', body: JSON.stringify({}) },
      { url: 'http://localhost:48730/api/change-proposals/proposal%2F1/approve', method: 'POST', body: JSON.stringify({}) },
    ]);
  });

  it('asks for a short-lived link to a proposed file by proposal and file id, and reads the answer without keeping it', async () => {
    const requested: string[] = [];
    const download = { url: 'https://storage.example.test/acme/file?X-Amz-Signature=1', expiresAt: '2026-11-15T10:01:00.000Z', fileName: 'workbook.pdf', sizeBytes: 4 };
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async (url) => {
      requested.push(String(url));
      return Response.json({ ok: true, data: { download } });
    } });
    expect(await api.getChangeProposalFileLink({ id: 'proposal/1', fileId: 'staged/1' })).toEqual({ ok: true, value: { download } });
    expect(requested).toEqual([`http://localhost:48730${API_ROUTES.changeProposalFile.path.replace(':id', 'proposal%2F1').replace(':fileId', 'staged%2F1')}`]);
  });

  it('asks for the decided proposals by status, keeps that page apart in the cache and reads whether more pages exist', async () => {
    const requested: string[] = [];
    const decided = { ...ownerView, status: 'expired' };
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async (url) => {
      requested.push(String(url));
      return Response.json({ ok: true, data: { proposals: [decided], nextCursor: 'proposal-1', hasMore: true } });
    } });
    expect(await api.listChangeProposals({ status: 'decided', limit: 50, cursor: 'proposal-0' }))
      .toEqual({ ok: true, value: { proposals: [decided], nextCursor: 'proposal-1', hasMore: true } });
    expect(requested).toEqual(['http://localhost:48730/api/change-proposals?status=decided&limit=50&cursor=proposal-0']);
    expect(changeProposalsQuery(api, { status: 'decided', limit: 50 }).queryKey)
      .not.toEqual(changeProposalsQuery(api, { limit: 50 }).queryKey);
  });

  it('describes the owner queries and the reject mutation under one invalidation prefix', async () => {
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async (url) => Response.json({ ok: true, data: new URL(String(url)).pathname === '/api/change-proposals'
      ? { proposals: [], nextCursor: null, hasMore: false }
      : { proposal: { ...ownerView, status: 'rejected' } } }) });
    const list = changeProposalsQuery(api, { status: 'pending' });
    const detail = changeProposalQuery(api, 'proposal-1');
    const reject = rejectChangeProposalMutation(api);
    const prefix = changeProposalsInvalidates().queryKey;
    expect(list.queryKey.slice(0, prefix.length)).toEqual([...prefix]);
    expect(detail.queryKey.slice(0, prefix.length)).toEqual([...prefix]);
    expect(reject.mutationKey.slice(0, prefix.length)).toEqual([...prefix]);
    await expect(reject.mutationFn({ id: 'proposal-1' }, { client: new QueryClient(), meta: undefined, mutationKey: reject.mutationKey }))
      .resolves.toMatchObject({ proposal: { status: 'rejected' } });
  });

  it('describes the approve mutation under the proposal prefix and refreshes every resource an approval can change', async () => {
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async () => Response.json({ ok: true, data: { proposal: { ...ownerView, status: 'stale' } } }) });
    const approve = approveChangeProposalMutation(api);
    const prefix = changeProposalsInvalidates().queryKey;
    expect(approve.mutationKey.slice(0, prefix.length)).toEqual([...prefix]);
    await expect(approve.mutationFn({ id: 'proposal-1' }, { client: new QueryClient(), meta: undefined, mutationKey: approve.mutationKey }))
      .resolves.toMatchObject({ proposal: { status: 'stale' } });
    const filters = approveChangeProposalInvalidates().map((filter) => filter.queryKey);
    const covered = (queryKey: readonly unknown[]) => filters.some((filter) => filter.every((part, index) => queryKey[index] === part));
    for (const queryKey of [
      changeProposalsQuery(api).queryKey,
      productsQuery(api).queryKey,
      salesLinkActions(api).list('acme').queryKey,
      tenantSettingsQuery(api).queryKey,
      productPricesQuery(api, 'product-1').queryKey,
      productStockQuery(api, 'product-1').queryKey,
      productDownloadAssetsQuery(api, 'product-1').queryKey,
    ]) expect(covered(queryKey), JSON.stringify(queryKey)).toBe(true);
  });
});

describe('owner change proposal summary client', () => {
  it('reads the pending counts and whether the workspace has proposals in one request and refuses an answer with other fields', async () => {
    const requests: string[] = [];
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async (url, init) => {
      requests.push(`${init?.method ?? 'GET'} ${new URL(String(url)).pathname}`);
      return Response.json({ ok: true, data: { pending: 3, pendingGroups: 1, hasProposals: true } });
    } });
    expect(await api.getChangeProposalSummary()).toEqual({ ok: true, value: { pending: 3, pendingGroups: 1, hasProposals: true } });
    expect(requests).toEqual(['GET /api/change-proposals/summary']);

    const leaky = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async () => Response.json({ ok: true, data: { pending: 3, pendingGroups: 1, hasProposals: true, proposals: [] } }) });
    expect(await leaky.getChangeProposalSummary()).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('refuses a summary without the has-proposals answer or with a non-boolean one', async () => {
    for (const data of [{ pending: 0, pendingGroups: 0 }, { pending: 0, pendingGroups: 0, hasProposals: 'yes' }]) {
      const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async () => Response.json({ ok: true, data }) });
      expect(await api.getChangeProposalSummary(), JSON.stringify(data)).toMatchObject({ ok: false, error: { code: 'internal' } });
    }
  });

  it('keeps the summary under the prefix every decision invalidates', async () => {
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async () => Response.json({ ok: true, data: { pending: 0, pendingGroups: 0, hasProposals: false } }) });
    const summary = changeProposalSummaryQuery(api);
    const covers = (filters: ReadonlyArray<{ queryKey: readonly unknown[] }>) =>
      filters.some((filter) => filter.queryKey.every((part, index) => summary.queryKey[index] === part));
    expect(covers([changeProposalsInvalidates()])).toBe(true);
    expect(covers(approveChangeProposalInvalidates())).toBe(true);
    for (const mutation of [approveChangeProposalMutation(api), rejectChangeProposalMutation(api), approveChangeProposalGroupMutation(api), rejectChangeProposalGroupMutation(api)]) {
      expect(mutation.mutationKey.slice(0, changeProposalsInvalidates().queryKey.length)).toEqual([...changeProposalsInvalidates().queryKey]);
    }
    expect(summary.queryKey).not.toEqual(changeProposalsQuery(api).queryKey);
  });
});
