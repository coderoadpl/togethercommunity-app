import {
  DEFAULT_LANGUAGE,
  emailTransportTest,
  integrationNotConfigured,
  ok,
  type AppError,
  type EmailIntegrationTransport,
  type IntegrationProvider,
  type ProviderDiagnostic,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  EmailIntegrationTransportResolver,
  EmailPort,
  PaymentProvider,
  StorageProvider,
  TransactionalEmailSender,
} from '../ports.js';
import { authorizeTenant } from '../authorize.js';

export interface TestIntegrationDeps {
  appBaseUrl: string;
  email: EmailPort;
  emailSender: TransactionalEmailSender;
  emailTransports: EmailIntegrationTransportResolver;
  payment: PaymentProvider;
  storage: StorageProvider;
}

const testEmailTransport = async (
  ctx: Ctx,
  tenantId: string,
  transport: EmailIntegrationTransport | undefined,
  deps: TestIntegrationDeps,
): Promise<Result<ProviderDiagnostic, AppError>> => {
  const email = transport === undefined
    ? deps.email
    : await deps.emailTransports.resolve(tenantId, transport);
  if (email === null) {
    return { ok: false, error: integrationNotConfigured(`${transport ?? 'email'} is not fully configured`) };
  }
  const diagnostic = await email.test();
  if (!diagnostic.ok) return diagnostic;
  const message = {
    to: ctx.identity.email,
    ...emailTransportTest(DEFAULT_LANGUAGE, { transport: transport ?? 'platform' }),
  };
  const sent = transport === undefined
    ? await deps.emailSender.send({ tenantId, ...message })
    : await email.send(message);
  return sent.ok ? diagnostic : sent;
};

export const testIntegration = async (
  ctx: Ctx,
  input: { provider: IntegrationProvider; emailTransport?: EmailIntegrationTransport | undefined },
  deps: TestIntegrationDeps,
): Promise<Result<{ diagnostic: ProviderDiagnostic }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'integration:test');
  if (!tenant.ok) return tenant;
  const tested =
    input.provider === 'storage'
      ? await deps.storage.test({ tenantId: tenant.value })
      : input.provider === 'email'
        ? await testEmailTransport(ctx, tenant.value, input.emailTransport, deps)
        : await deps.payment.test({ tenantId: tenant.value, appBaseUrl: deps.appBaseUrl });
  return tested.ok ? ok({ diagnostic: tested.value }) : tested;
};
