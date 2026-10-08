import type { QueryFunctionContext } from '@tanstack/query-core';
import { unwrap, type ApiClient } from './http.js';

export const orderVerificationQuery = (api: ApiClient, reference: string) => ({
  queryKey: ['order-verification', reference] as const,
  staleTime: 0,
  refetchOnMount: 'always' as const,
  queryFn: async ({ signal }: QueryFunctionContext) => unwrap(await api.verifyOrder({ reference }, signal)),
});
export const issueOrderLineMutation = (api: ApiClient) => ({
  mutationFn: async (input: Parameters<ApiClient['issueOrderLine']>[0]) => unwrap(await api.issueOrderLine(input)),
});

export const orderVerificationInvalidates = () => ({ queryKey: ['order-verification'] as const });
