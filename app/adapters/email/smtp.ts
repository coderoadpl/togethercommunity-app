import nodemailer from 'nodemailer';

import { integrationUnavailable, ok } from '#core/domain/index.js';
import type { EmailPort } from '#core/server/index.js';

export interface SmtpEmailSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
  from: string;
}

export interface SmtpTransport {
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
  auth: { user: string; pass: string };
}) => SmtpTransport;

export const createSmtpEmailPort = (
  settings: SmtpEmailSettings,
  createTransport: SmtpTransportFactory = nodemailer.createTransport,
): EmailPort => {
  const transport = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: settings.password },
  });
  return {
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
