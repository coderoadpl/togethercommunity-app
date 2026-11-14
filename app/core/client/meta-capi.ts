import type { QueryFunctionContext } from '@tanstack/query-core';
import { unwrap, type ApiClient } from './http.js';

export const metaCapiActions = (api: ApiClient) => ({
  consents: {
    queryKey: ['meta-capi-consents'] as const,
    queryFn: async ({ signal }: QueryFunctionContext) => unwrap(await api.metaCapiConsents(signal)),
  },
  decide: {
    mutationFn: async (input: Parameters<ApiClient['publicMetaCapiConsent']>[0]) => unwrap(await api.publicMetaCapiConsent(input)),
  },
  withdraw: {
    mutationFn: async (input: { orderId: string }) => unwrap(await api.withdrawMetaCapiConsent(input)),
  },
});
