import type { QueryFunctionContext } from '@tanstack/query-core';
import { unwrap, type ApiClient } from './http.js';

export const partnerProgramActions = (api: ApiClient) => ({
  list: (tenantId: string) => ({ queryKey: ['partner-programs', tenantId] as const, queryFn: async ({ signal }: QueryFunctionContext) => unwrap(await api.listPartnerPrograms({}, signal)) }),
  detail: (id: string) => ({ queryKey: ['partner-programs', 'detail', id] as const, queryFn: async ({ signal }: QueryFunctionContext) => unwrap(await api.getPartnerProgram({ id }, signal)) }),
  create: { mutationFn: async (input: Parameters<ApiClient['createPartnerProgram']>[0]) => unwrap(await api.createPartnerProgram(input)) },
  update: { mutationFn: async (input: Parameters<ApiClient['updatePartnerProgram']>[0]) => unwrap(await api.updatePartnerProgram(input)) },
  assign: { mutationFn: async (input: Parameters<ApiClient['assignPartner']>[0]) => unwrap(await api.assignPartner(input)) },
  updatePartner: { mutationFn: async (input: Parameters<ApiClient['updatePartner']>[0]) => unwrap(await api.updatePartner(input)) },
  createCode: { mutationFn: async (input: Parameters<ApiClient['createPartnerCode']>[0]) => unwrap(await api.createPartnerCode(input)) },
  updateCode: { mutationFn: async (input: Parameters<ApiClient['updatePartnerCode']>[0]) => unwrap(await api.updatePartnerCode(input)) },
  invalidates: () => ({ queryKey: ['partner-programs'] as const }),
});
