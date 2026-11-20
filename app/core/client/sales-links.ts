import type { QueryFunctionContext } from '@tanstack/query-core';
import { unwrap, type ApiClient } from './http.js';

export const salesLinkScopes = {
  all: () => ['sales-links'] as const,
  list: (tenantId: string) => [...salesLinkScopes.all(), tenantId] as const,
};

export const salesLinkActions = (api: ApiClient) => ({
  list: (tenantId: string) => ({ queryKey: salesLinkScopes.list(tenantId), queryFn: async ({ signal }: QueryFunctionContext) => unwrap(await api.listSalesLinks({}, signal)) }),
  publicOffer: (slug: string, variants: readonly string[] = []) => ({ queryKey: [...salesLinkScopes.all(), 'public', slug, [...variants]] as const, queryFn: async ({ signal }: QueryFunctionContext) => unwrap(await api.getPublicSalesLink({ slug, variant: [...variants] }, signal)) }),
  create: { mutationFn: async (input: Parameters<ApiClient['createSalesLink']>[0]) => unwrap(await api.createSalesLink(input)) },
  update: { mutationFn: async (input: Parameters<ApiClient['updateSalesLink']>[0]) => unwrap(await api.updateSalesLink(input)) },
  remove: { mutationFn: async (input: Parameters<ApiClient['deleteSalesLink']>[0]) => unwrap(await api.deleteSalesLink(input)) },
  invalidates: (tenantId: string) => ({ queryKey: salesLinkScopes.list(tenantId) }),
});
