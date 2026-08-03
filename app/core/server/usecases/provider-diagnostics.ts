import {
  ok,
  type AppError,
  type IntegrationProvider,
  type ProviderDiagnostic,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { EmailPort, PaymentProvider, StorageProvider } from '../ports.js';
import { authorizeTenant } from '../authorize.js';

export interface TestIntegrationDeps {
  appBaseUrl: string;
  email: EmailPort;
  payment: PaymentProvider;
  storage: StorageProvider;
}

export const testIntegration = async (
  ctx: Ctx,
  input: { provider: IntegrationProvider },
  deps: TestIntegrationDeps,
): Promise<Result<{ diagnostic: ProviderDiagnostic }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'integration:test');
  if (!tenant.ok) return tenant;
  const tested =
    input.provider === 'storage'
      ? await deps.storage.test({ tenantId: tenant.value })
      : input.provider === 'email'
        ? await deps.email.test()
        : await deps.payment.test({ tenantId: tenant.value, appBaseUrl: deps.appBaseUrl });
  return tested.ok ? ok({ diagnostic: tested.value }) : tested;
};
