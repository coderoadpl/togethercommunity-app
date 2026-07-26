import type { SendEmailCommand, SendEmailCommandOutput } from '@aws-sdk/client-ses';
import { describe, expect, it } from 'vitest';

import { createSesEmailPort, type SesSender } from './ses.js';

const output = (messageId: string | undefined): SendEmailCommandOutput => ({
  MessageId: messageId,
  $metadata: {},
});

const recordingSender = (result: SendEmailCommandOutput | Error) => {
  const commands: SendEmailCommand[] = [];
  const sender: SesSender = {
    send: async (command) => {
      commands.push(command);
      if (result instanceof Error) throw result;
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
});
