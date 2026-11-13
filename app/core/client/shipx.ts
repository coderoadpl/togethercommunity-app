import type { QueryFunctionContext } from '@tanstack/query-core';
import { unwrap, type ApiClient } from './http.js';

const shipxScopes = {
  order: (orderId: string) => ['sales', 'shipx', orderId] as const,
  settings: () => ['shipx-settings'] as const,
};

export const shipxShipmentQuery = (api: ApiClient, orderId: string) => ({
  queryKey: shipxScopes.order(orderId),
  queryFn: async ({ signal }: QueryFunctionContext) => unwrap(await api.shipxShipment({ orderId }, signal)),
});

export const createShipxShipmentMutation = (api: ApiClient) => ({
  mutationFn: async (orderId: string) => unwrap(await api.shipxCreate({ orderId })),
});

export const discardShipxAttemptMutation = (api: ApiClient) => ({
  mutationFn: async (orderId: string) => unwrap(await api.shipxDiscard({ orderId })),
});

export const downloadShipxLabelMutation = (api: ApiClient) => ({
  mutationFn: async (orderId: string) => unwrap(await api.shipxLabel({ orderId })),
});

export const shipxShipmentInvalidates = (orderId: string) => ({ queryKey: shipxScopes.order(orderId) });

export const shipxSettingsQuery = (api: ApiClient) => ({
  queryKey: shipxScopes.settings(),
  queryFn: async ({ signal }: QueryFunctionContext) => unwrap(await api.shipxSettings(signal)),
});

export const configureShipxMutation = (api: ApiClient) => ({
  mutationFn: async (input: Parameters<ApiClient['shipxConfigure']>[0]) => unwrap(await api.shipxConfigure(input)),
});

export const shipxSettingsInvalidates = () => ({ queryKey: shipxScopes.settings() });
