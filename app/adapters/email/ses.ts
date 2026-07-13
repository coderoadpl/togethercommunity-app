import { SendEmailCommand, SESClient, type SendEmailCommandOutput } from '@aws-sdk/client-ses';

import { internal, ok, type AppError, type Result } from '@core/domain/index.js';
import type { EmailPort } from '@core/server/index.js';

export interface SesEmailSettings {
  from: string;
}

export interface SesSender {
  send(command: SendEmailCommand): Promise<SendEmailCommandOutput>;
}

const messageIdFrom = (output: SendEmailCommandOutput): string | null => output.MessageId ?? null;

export const createSesEmailPort = (
  settings: SesEmailSettings,
  sender: SesSender = new SESClient({}),
): EmailPort => ({
  send: async (message): Promise<Result<{ messageId: string | null }, AppError>> => {
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
        }),
      );
      return ok({ messageId: messageIdFrom(output) });
    } catch (cause) {
      return { ok: false, error: internal(`Could not send SES email: ${String(cause)}`) };
    }
  },
});
