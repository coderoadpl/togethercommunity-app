import type { QueryFunctionContext } from '@tanstack/query-core';
import { unwrap, type ApiClient } from './http.js';

export const salesLinkActions = (api: ApiClient) => ({
  list: (tenantId: string) => ({ queryKey: ['sales-links', tenantId] as const, queryFn: async ({ signal }: QueryFunctionContext) => unwrap(await api.listSalesLinks({}, signal)) }),
  publicOffer: (slug: string) => ({ queryKey: ['sales-links', 'public', slug] as const, queryFn: async ({ signal }: QueryFunctionContext) => unwrap(await api.getPublicSalesLink({ slug }, signal)) }),
  create: { mutationFn: async (input: Parameters<ApiClient['createSalesLink']>[0]) => unwrap(await api.createSalesLink(input)) },
  update: { mutationFn: async (input: Parameters<ApiClient['updateSalesLink']>[0]) => unwrap(await api.updateSalesLink(input)) },
  remove: { mutationFn: async (input: Parameters<ApiClient['deleteSalesLink']>[0]) => unwrap(await api.deleteSalesLink(input)) },
  invalidates: (tenantId: string) => ({ queryKey: ['sales-links', tenantId] as const }),
});
