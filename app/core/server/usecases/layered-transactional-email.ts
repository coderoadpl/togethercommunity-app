import {
  appError,
  isSmokeTenant,
  ok,
  type EmailIntegrationTransport,
  type TransactionalEmailTransport,
} from '#core/domain/index.js';

import type {
  EmailIntegrationTransportResolver,
  EmailPort,
  PlatformTransactionalPool,
  TransactionalEmailSender,
} from '../ports.js';

export interface LayeredTransactionalEmailDeps {
  transports: EmailIntegrationTransportResolver;
  platform: EmailPort;
  pool: PlatformTransactionalPool;
  platformLimit: number;
  /** Set on production only: swallows the smoke tenant's transactional mail. */
  smokeTenantSink?: EmailPort;
}

const TENANT_TRANSPORT_ORDER: readonly {
  integration: EmailIntegrationTransport;
  transactional: TransactionalEmailTransport;
}[] = [
  { integration: 'ses', transactional: 'tenant-ses' },
  { integration: 'smtp', transactional: 'smtp' },
  { integration: 'resend', transactional: 'resend' },
];

export const resolveTenantTransactionalTransport = async (
  tenantId: string,
  transports: EmailIntegrationTransportResolver,
): Promise<{ transport: TransactionalEmailTransport; email: EmailPort } | null> => {
  for (const { integration, transactional } of TENANT_TRANSPORT_ORDER) {
    const email = await transports.resolve(tenantId, integration);
    if (email !== null) return { transport: transactional, email };
  }
  return null;
};

const sendWith = async (
  transport: TransactionalEmailTransport,
  email: EmailPort,
  message: Parameters<TransactionalEmailSender['send']>[0],
) => {
  const sent = await email.send(message);
  return sent.ok
    ? ok({ ...sent.value, transport })
    : {
        ok: false as const,
        error: appError(sent.error.code, sent.error.message, {
          transport,
          cause: sent.error.details,
        }),
      };
};

export const createLayeredTransactionalEmailSender = (
  deps: LayeredTransactionalEmailDeps,
): TransactionalEmailSender => ({
  send: async (message) => {
    if (message.tenantId === null) return sendWith('platform', deps.platform, message);
    // The sink is a platform-owned transport, so it reports as one; no tenant integration ran.
    if (deps.smokeTenantSink !== undefined && isSmokeTenant(message.tenantId)) {
      return sendWith('platform', deps.smokeTenantSink, message);
    }
    const tenant = await resolveTenantTransactionalTransport(message.tenantId, deps.transports);
    if (tenant !== null) return sendWith(tenant.transport, tenant.email, message);
    if (message.tenantTransportRequired === true) {
      return {
        ok: false,
        error: appError(
          'integration_not_configured',
          'A tenant SES, SMTP or Resend transport is required for API-submitted e-mail',
        ),
      };
    }
    const reserved = await deps.pool.reserve(message.tenantId, deps.platformLimit);
    if (!reserved) {
      return {
        ok: false,
        error: appError(
          'transactional_platform_cap_reached',
          'Transactional platform sending pool exhausted; configure tenant SES, SMTP or Resend',
        ),
      };
    }
    const sent = await sendWith('platform', deps.platform, message);
    await deps.pool.settle(message.tenantId, sent.ok);
    return sent;
  },
});
