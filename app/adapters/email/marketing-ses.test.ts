import { describe, expect, it } from 'vitest';

import { createSesMarketingSender, readSesQuota, type RawSesClient } from './marketing-ses.js';

describe('SES marketing sender', () => {
  it('sends a hygienic raw MIME message with tenant credentials and wrapped lines', async () => {
    let raw = '';
    const client: RawSesClient = {
      sendRaw: async (input) => {
        raw = new TextDecoder().decode(input.raw);
        return { messageId: 'ses-1' };
      },
      getQuota: async () => ({ maxSendRate: 14, max24HourSend: 50_000, sentLast24Hours: 12 }),
    };
    const sender = createSesMarketingSender(() => client);
    const result = await sender.send({
      credentials: { accessKeyId: 'AKIA', secretAccessKey: 'secret', region: 'eu-central-1' },
      from: { address: 'news@example.test', name: 'Example' },
      to: 'member@example.test',
      subject: 'A'.repeat(180),
      html: `<p>${'hello '.repeat(80)}</p>`,
      text: 'hello',
      headers: {
        'List-Unsubscribe': '<https://example.test/u/token>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      configurationSet: 'marketing',
    });

    expect(result).toEqual({ ok: true, value: { messageId: 'ses-1' } });
    expect(raw).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n');
    const headerBlock = raw.split('\r\n\r\n')[0] ?? '';
    expect(headerBlock).not.toContain('\r\n\r\n');
    expect(raw.split('\r\n').every((line) => line.length <= 998)).toBe(true);
  });

  it('rejects header injection before contacting SES', async () => {
    let called = false;
    const client: RawSesClient = {
      sendRaw: async () => { called = true; return { messageId: 'bad' }; },
      getQuota: async () => ({ maxSendRate: 1, max24HourSend: 1, sentLast24Hours: 0 }),
    };
    const result = await createSesMarketingSender(() => client).send({
      credentials: { accessKeyId: 'a', secretAccessKey: 'b', region: 'eu-central-1' },
      from: { address: 'news@example.test', name: 'Example' },
      to: 'member@example.test', subject: 'subject', html: '<p>x</p>', text: 'x',
      headers: { 'X-Test': 'safe\r\nBcc: stolen@example.test' }, configurationSet: null,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(called).toBe(false);
  });

  it('derives the cached throttle values and sandbox state from GetSendQuota', async () => {
    const client: RawSesClient = {
      sendRaw: async () => ({ messageId: 'unused' }),
      getQuota: async () => ({ maxSendRate: 2.5, max24HourSend: 200, sentLast24Hours: 7.9 }),
    };
    await expect(readSesQuota(
      { accessKeyId: 'a', secretAccessKey: 'b', region: 'eu-central-1' },
      () => client,
    )).resolves.toEqual({
      ok: true,
      value: { ratePerSecond: 2.5, daily: 200, sentLast24Hours: 7, inSandbox: true },
    });
  });
});
