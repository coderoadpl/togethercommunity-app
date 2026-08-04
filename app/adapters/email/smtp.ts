import nodemailer from 'nodemailer';

import { err, integrationAuth, integrationUnavailable, ok, type AppError, type Result } from '#core/domain/index.js';
import type { EmailPort } from '#core/server/index.js';

export interface SmtpEmailSettings {
  host: string;
  port: number;
  user?: string;
  password?: string;
  secure: boolean;
  from: string;
}

interface SmtpTransport {
  verify(): Promise<unknown>;
  sendMail(input: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    headers?: Record<string, string>;
  }): Promise<{ messageId: string }>;
}

export type SmtpTransportFactory = (settings: {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
}) => SmtpTransport;

const smtpConnectionFailure = (cause: unknown): AppError => {
  if (typeof cause === 'object' && cause !== null) {
    const code = 'code' in cause ? cause.code : null;
    const responseCode = 'responseCode' in cause ? cause.responseCode : null;
    if (code === 'EAUTH' || [454, 534, 535, 538].includes(Number(responseCode))) {
      return integrationAuth('SMTP rejected the credentials.');
    }
  }
  return integrationUnavailable('Could not connect to SMTP.');
};

export const createSmtpEmailPort = (
  settings: SmtpEmailSettings,
  createTransport: SmtpTransportFactory = nodemailer.createTransport,
): EmailPort => {
  const transport = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    ...(settings.user === undefined || settings.password === undefined
      ? {}
      : { auth: { user: settings.user, pass: settings.password } }),
  });
  const healthcheck = async (): Promise<Result<{ healthy: true }, AppError>> => {
    try {
      await transport.verify();
      return ok({ healthy: true });
    } catch (cause) {
      return err(smtpConnectionFailure(cause));
    }
  };
  return {
    healthcheck,
    test: async () => {
      const healthy = await healthcheck();
      return healthy.ok
        ? ok({ code: 'email.available', message: 'SMTP accepted the connection settings.' })
        : healthy;
    },
    send: async (message) => {
      try {
        const sent = await transport.sendMail({
          from: settings.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.headers === undefined ? {} : { headers: message.headers }),
        });
        return ok({ messageId: sent.messageId });
      } catch (cause) {
        return {
          ok: false,
          error: integrationUnavailable(`Could not send SMTP e-mail: ${String(cause)}`),
        };
      }
    },
  };
};
