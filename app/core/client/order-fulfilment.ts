import type { QueryFunctionContext } from '@tanstack/query-core';
import { unwrap, type ApiClient } from './http.js';

export const shipOrderMutation = (api: ApiClient) => ({
  mutationFn: async (input: Parameters<ApiClient['shipOrder']>[0]) => unwrap(await api.shipOrder(input)),
});

export const correctOrderDeliveryMutation = (api: ApiClient) => ({
  mutationFn: async (input: Parameters<ApiClient['correctOrderDelivery']>[0]) => unwrap(await api.correctOrderDelivery(input)),
});

export const correctOrderPersonalizationMutation = (api: ApiClient) => ({
  mutationFn: async (input: Parameters<ApiClient['correctOrderPersonalization']>[0]) => unwrap(await api.correctOrderPersonalization(input)),
});

export const packingListQuery = (api: ApiClient, input: Parameters<ApiClient['ordersPackingList']>[0]) => ({
  queryKey: ['sales', 'packing-list', input] as const,
  staleTime: 0,
  gcTime: 0,
  queryFn: async ({ signal }: QueryFunctionContext) => unwrap(await api.ordersPackingList(input, signal)),
});
