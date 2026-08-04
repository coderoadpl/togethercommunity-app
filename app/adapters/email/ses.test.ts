import type { SendEmailCommand, SendEmailCommandOutput } from '@aws-sdk/client-ses';
import { describe, expect, it } from 'vitest';

import { createSesEmailPort, type SesSender } from './ses.js';

const output = (messageId: string | undefined): SendEmailCommandOutput => ({
  MessageId: messageId,
  $metadata: {},
});

const isSendEmailOutput = (value: unknown): value is SendEmailCommandOutput =>
  typeof value === 'object' &&
  value !== null &&
  'MessageId' in value &&
  (typeof value.MessageId === 'string' || value.MessageId === undefined) &&
  '$metadata' in value &&
  typeof value.$metadata === 'object' &&
  value.$metadata !== null;

const recordingSender = (result: SendEmailCommandOutput | Error | Record<string, unknown>) => {
  const commands: SendEmailCommand[] = [];
  const sender: SesSender = {
    healthcheck: async () => {
      if (!(result instanceof Error) && 'MessageId' in result) return;
      throw result;
    },
    send: async (command) => {
      commands.push(command);
      if (!isSendEmailOutput(result)) throw result;
      return result;
    },
  };
  return { sender, commands };
};

const message = {
  to: 'student@together.dev',
  subject: 'Sign in to Acme',
  html: '<p>Hello</p>',
  text: 'Hello',
};

describe('createSesEmailPort', () => {
  it('sends a SendEmailCommand shaped from the message and returns the SES message id', async () => {
    const { sender, commands } = recordingSender(output('ses-message-1'));
    const port = createSesEmailPort({ from: 'Together <kontakt@together.dev>' }, sender);

    const result = await port.send(message);

    expect(result).toEqual({ ok: true, value: { messageId: 'ses-message-1' } });
    expect(commands).toHaveLength(1);
    expect(commands[0]?.input).toEqual({
      Source: 'Together <kontakt@together.dev>',
      Destination: { ToAddresses: ['student@together.dev'] },
      Message: {
        Subject: { Data: 'Sign in to Acme', Charset: 'UTF-8' },
        Body: {
          Html: { Data: '<p>Hello</p>', Charset: 'UTF-8' },
          Text: { Data: 'Hello', Charset: 'UTF-8' },
        },
      },
    });
    expect(commands[0]?.input).not.toHaveProperty('ConfigurationSetName');
  });

  it('fails when SES omits the correlation MessageId', async () => {
    const { sender } = recordingSender(output(undefined));
    const port = createSesEmailPort({ from: 'Together <kontakt@together.dev>' }, sender);

    expect(await port.send(message)).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('returns an internal AppError when the SES client throws', async () => {
    const { sender } = recordingSender(new Error('throttled'));
    const port = createSesEmailPort({ from: 'Together <kontakt@together.dev>' }, sender);

    const result = await port.send(message);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal');
      expect(result.error.message).toContain('throttled');
    }
  });

  it('exposes healthcheck and test through the shared provider diagnostic contract', async () => {
    const { sender } = recordingSender(output('unused'));
    const port = createSesEmailPort({ from: 'Together <kontakt@together.dev>' }, sender);

    await expect(port.healthcheck()).resolves.toEqual({ ok: true, value: { healthy: true } });
    await expect(port.test()).resolves.toEqual({
      ok: true,
      value: { code: 'email.available', message: 'SES accepted the connection settings.' },
    });
  });

  it.each([
    { name: 'ExpiredTokenException' },
    { name: 'InvalidSignatureException' },
    { name: 'AuthFailure' },
    { $metadata: { httpStatusCode: 403 } },
  ])('classifies SES authentication failures without exposing provider text', async (failure) => {
    const { sender } = recordingSender(failure);
    const port = createSesEmailPort({ from: 'Together <kontakt@together.dev>' }, sender);

    await expect(port.test()).resolves.toEqual({
      ok: false,
      error: { code: 'integration_auth', message: 'SES rejected the credentials.' },
    });
  });
});
