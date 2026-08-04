import { appError, ok, type TransactionalEmailTransport } from '#core/domain/index.js';

import type {
  EmailPort,
  PlatformTransactionalPool,
  TransactionalEmailSender,
  TransactionalEmailTransportResolver,
} from '../ports.js';

export interface LayeredTransactionalEmailDeps {
  tenantSes: TransactionalEmailTransportResolver;
  smtp: TransactionalEmailTransportResolver;
  resend: TransactionalEmailTransportResolver;
  platform: EmailPort;
  pool: PlatformTransactionalPool;
  platformLimit: number;
}

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
    const tenantSes = await deps.tenantSes.resolve(message.tenantId);
    if (tenantSes !== null) return sendWith('tenant-ses', tenantSes, message);
    const smtp = await deps.smtp.resolve(message.tenantId);
    if (smtp !== null) return sendWith('smtp', smtp, message);
    const resend = await deps.resend.resolve(message.tenantId);
    if (resend !== null) return sendWith('resend', resend, message);
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
