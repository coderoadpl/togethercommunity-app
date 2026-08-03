import {
  GetAccountSendingEnabledCommand,
  SendEmailCommand,
  SESClient,
  type SendEmailCommandOutput,
} from '@aws-sdk/client-ses';

import { err, internal, ok, type AppError, type Result } from '#core/domain/index.js';
import type { EmailPort } from '#core/server/index.js';

export interface SesEmailSettings {
  from: string;
  region?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  configurationSet?: string | null;
}

export interface SesSender {
  send(command: SendEmailCommand): Promise<SendEmailCommandOutput>;
  healthcheck(): Promise<void>;
}

const defaultSender = (settings: SesEmailSettings): SesSender => {
  const client = new SESClient({
    ...(settings.region === undefined ? {} : { region: settings.region }),
    ...(settings.credentials === undefined ? {} : { credentials: settings.credentials }),
  });
  return {
    send: (command) => client.send(command),
    healthcheck: async () => {
      await client.send(new GetAccountSendingEnabledCommand({}));
    },
  };
};

export const createSesEmailPort = (
  settings: SesEmailSettings,
  sender: SesSender = defaultSender(settings),
): EmailPort => {
  const healthcheck = async (): Promise<Result<{ healthy: true }, AppError>> => {
    try {
      await sender.healthcheck();
      return ok({ healthy: true });
    } catch (cause) {
      return err(internal(`Could not connect to SES: ${String(cause)}`));
    }
  };
  return {
    healthcheck,
    test: async () => {
      const healthy = await healthcheck();
      return healthy.ok
        ? ok({ code: 'email.available', message: 'SES accepted the connection settings.' })
        : healthy;
    },
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
          return err(internal('SES accepted the email without returning a MessageId'));
        }
        return ok({ messageId: output.MessageId });
      } catch (cause) {
        return err(internal(`Could not send SES email: ${String(cause)}`));
      }
    },
  };
};
