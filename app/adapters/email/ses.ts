import { SendEmailCommand, SESClient, type SendEmailCommandOutput } from '@aws-sdk/client-ses';

import { internal, ok, type AppError, type Result } from '@core/domain/index.js';
import type { EmailPort } from '@core/server/index.js';

export interface SesEmailSettings {
  from: string;
  region?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  configurationSet?: string | null;
}

export interface SesSender {
  send(command: SendEmailCommand): Promise<SendEmailCommandOutput>;
}

export const createSesEmailPort = (
  settings: SesEmailSettings,
  sender: SesSender = new SESClient({
    ...(settings.region === undefined ? {} : { region: settings.region }),
    ...(settings.credentials === undefined ? {} : { credentials: settings.credentials }),
  }),
): EmailPort => ({
  send: async (message): Promise<Result<{ messageId: string }, AppError>> => {
    try {
      const output = await sender.send(
        new SendEmailCommand({
          Source: settings.from,
          Destination: { ToAddresses: [message.to] },
          Message: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: message.html, Charset: 'UTF-8' },
              Text: { Data: message.text, Charset: 'UTF-8' },
            },
          },
          ...(settings.configurationSet === undefined || settings.configurationSet === null
            ? {}
            : { ConfigurationSetName: settings.configurationSet }),
        }),
      );
      if (output.MessageId === undefined || output.MessageId === '') {
        return { ok: false, error: internal('SES accepted the email without returning a MessageId') };
      }
      return ok({ messageId: output.MessageId });
    } catch (cause) {
      return { ok: false, error: internal(`Could not send SES email: ${String(cause)}`) };
    }
  },
});
