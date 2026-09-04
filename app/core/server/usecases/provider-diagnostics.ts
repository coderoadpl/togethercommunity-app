import {
  emailTransportTest,
  integrationNotConfigured,
  ok,
  resolveEmailLanguage,
  type AppError,
  type EmailIntegrationTransport,
  type IntegrationProvider,
  type ProviderDiagnostic,
  type Result,
  type TransactionalEmailTransport,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  EmailIntegrationTransportResolver,
  EmailPort,
  PaymentProvider,
  StorageProvider,
  TenantRepository,
  TransactionalEmailSender,
} from '../ports.js';
import { authorizeTenant } from '../authorize.js';
import { resolveTenantTransactionalTransport } from './layered-transactional-email.js';

export interface TestIntegrationDeps {
  appBaseUrl: string;
  corsOrigins?: string[] | undefined;
  email: EmailPort;
  emailSender: TransactionalEmailSender;
  emailTransports: EmailIntegrationTransportResolver;
  payment: PaymentProvider;
  storage: StorageProvider;
  tenants: Pick<TenantRepository, 'findSettings'>;
}

type TestedTransport = EmailIntegrationTransport | TransactionalEmailTransport;

const resolveTestedTransport = async (
  tenantId: string,
  transport: EmailIntegrationTransport | undefined,
  deps: TestIntegrationDeps,
): Promise<{ transport: TestedTransport; email: EmailPort } | null> => {
  if (transport === undefined) {
    const tenant = await resolveTenantTransactionalTransport(tenantId, deps.emailTransports);
    return tenant ?? { transport: 'platform', email: deps.email };
  }
  const email = await deps.emailTransports.resolve(tenantId, transport);
  return email === null ? null : { transport, email };
};

const testEmailTransport = async (
  ctx: Ctx,
  tenantId: string,
  input: { transport: EmailIntegrationTransport | undefined; language: string | undefined },
  deps: TestIntegrationDeps,
): Promise<Result<ProviderDiagnostic, AppError>> => {
  const tested = await resolveTestedTransport(tenantId, input.transport, deps);
  if (tested === null) {
    return { ok: false, error: integrationNotConfigured(`${input.transport ?? 'email'} is not fully configured`) };
  }
  const diagnostic = await tested.email.test();
  if (!diagnostic.ok) return diagnostic;
  const settings = await deps.tenants.findSettings(tenantId);
  const language = resolveEmailLanguage(
    ctx.identity.memberLanguage,
    input.language,
    settings?.defaultLanguage,
  );
  const message = {
    to: ctx.identity.email,
    ...emailTransportTest(language, { transport: tested.transport }),
  };
  const sent = input.transport === undefined
    ? await deps.emailSender.send({ tenantId, ...message })
    : await tested.email.send(message);
  return sent.ok ? ok({ ...diagnostic.value, details: { transport: tested.transport } }) : sent;
};

export const testIntegration = async (
  ctx: Ctx,
  input: {
    provider: IntegrationProvider;
    emailTransport?: EmailIntegrationTransport | undefined;
    language?: string | undefined;
  },
  deps: TestIntegrationDeps,
): Promise<Result<{ diagnostic: ProviderDiagnostic }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'integration:test');
  if (!tenant.ok) return tenant;
  const tested =
    input.provider === 'storage'
      ? await deps.storage.test({ tenantId: tenant.value, corsOrigins: deps.corsOrigins })
      : input.provider === 'email'
        ? await testEmailTransport(
            ctx,
            tenant.value,
            { transport: input.emailTransport, language: input.language },
            deps,
          )
        : await deps.payment.test({ tenantId: tenant.value, appBaseUrl: deps.appBaseUrl });
  return tested.ok ? ok({ diagnostic: tested.value }) : tested;
};
