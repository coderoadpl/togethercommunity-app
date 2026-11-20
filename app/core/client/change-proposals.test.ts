import { QueryClient } from '@tanstack/query-core';
import { describe, expect, it, vi } from 'vitest';

import { SHOP_ASSETS_ROUTES, SHOP_CATALOG_ROUTES, SHOP_PROPOSAL_ROUTES, SHOP_SETTINGS_ROUTES } from '#core/contract/index.js';
import { shopSettingsSchema } from '#core/domain/index.js';

import { createApiClient, createShopManagementClient, isProposedChange } from './http.js';
import {
  approveChangeProposalInvalidates,
  approveChangeProposalMutation,
  changeProposalQuery,
  changeProposalsInvalidates,
  changeProposalsQuery,
  productPricesQuery,
  productsQuery,
  productStockQuery,
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
  id: 'proposal-1', groupId: null, groupPosition: null, operation: 'product.update', target: { kind: 'product', id: 'product-1' },
  input: { id: 'product-1', title: 'Renamed' }, effect: { title: { before: 'Handbook', after: 'Renamed' } }, status: 'pending',
  proposedBy: { keyId: 'key-1', keyName: 'Catalogue agent', issuerUserId: 'owner-1', keyState: 'active' },
  createdAt: '2026-11-15T10:00:00.000Z', expiresAt: '2026-12-15T10:00:00.000Z', decidedByUserId: null, decidedAt: null,
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
      await client.createProductPrice({ productId: 'product-1', kind: 'one_time', amountCents: 4900 }),
      await client.deactivateProductPrice({ id: 'price-1' }),
      await client.enableProductStock({ productId: 'product-1', onHand: 3, lowStockThreshold: null }),
      await client.adjustProductStock({ productId: 'product-1', delta: 1, reason: 'delivery' }),
      await client.setProductStockThreshold({ productId: 'product-1', lowStockThreshold: 1 }),
    ];
    expect(results).toHaveLength(Object.values(SHOP_CATALOG_ROUTES).filter((route) => route.method !== 'GET').length);
    for (const result of results) expect(result).toEqual({ ok: true, value: { outcome: 'proposed', proposal: receipt } });
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

describe('owner change proposal client', () => {
  it('lists, shows and rejects change proposals through the session routes', async () => {
    const requests: Array<{ url: string; method: string | undefined; body: BodyInit | null | undefined }> = [];
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async (url, init) => {
      requests.push({ url: String(url), method: init?.method, body: init?.body });
      const path = new URL(String(url)).pathname;
      return Response.json({ ok: true, data: path === '/api/change-proposals'
        ? { proposals: [ownerView], nextCursor: null }
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

  it('describes the owner queries and the reject mutation under one invalidation prefix', async () => {
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async (url) => Response.json({ ok: true, data: new URL(String(url)).pathname === '/api/change-proposals'
      ? { proposals: [], nextCursor: null }
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
    ]) expect(covered(queryKey), JSON.stringify(queryKey)).toBe(true);
  });
});
