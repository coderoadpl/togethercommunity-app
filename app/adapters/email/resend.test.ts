import { describe, expect, it, vi } from 'vitest';

import { createResendEmailPort, type ResendHttpClient, type ResendHttpResponse } from './resend.js';

const response = (status: number, body: unknown): ResendHttpResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const settings = {
  apiKey: 're_test_123',
  from: 'Creator <creator@example.test>',
  apiBaseUrl: 'https://resend.example.test',
};

describe('Resend transactional e-mail adapter', () => {
  it('uses the Resend API for healthcheck and the shared diagnostic contract', async () => {
    const request = vi.fn(async () => response(200, { data: [] }));
    const email = createResendEmailPort(settings, { request });

    await expect(email.healthcheck()).resolves.toEqual({ ok: true, value: { healthy: true } });
    await expect(email.test()).resolves.toEqual({
      ok: true,
      value: { code: 'email.available', message: 'Resend accepted the API key.' },
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith({
      url: 'https://resend.example.test/domains?limit=1',
      method: 'GET',
      headers: {
        authorization: 'Bearer re_test_123',
        'content-type': 'application/json',
      },
    });
  });

  it('maps an EmailPort message to Resend and returns its message id', async () => {
    const request = vi.fn(async () => response(200, { id: 'resend-message-1' }));
    const email = createResendEmailPort(settings, { request });

    await expect(email.send({
      to: 'creator@example.test',
      subject: 'Together test',
      html: '<p>It works.</p>',
      text: 'It works.',
      headers: { 'X-Test': 'yes' },
    })).resolves.toEqual({ ok: true, value: { messageId: 'resend-message-1' } });

    expect(request).toHaveBeenCalledWith({
      url: 'https://resend.example.test/emails',
      method: 'POST',
      headers: {
        authorization: 'Bearer re_test_123',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Creator <creator@example.test>',
        to: ['creator@example.test'],
        subject: 'Together test',
        html: '<p>It works.</p>',
        text: 'It works.',
        headers: { 'X-Test': 'yes' },
      }),
    });
  });

  it('maps provider errors without leaking the API key', async () => {
    const client: ResendHttpClient = {
      request: async () => response(401, { message: 'API key is invalid' }),
    };
    const email = createResendEmailPort(settings, client);

    const sent = await email.send({
      to: 'creator@example.test',
      subject: 'Together test',
      html: '<p>It works.</p>',
      text: 'It works.',
    });

    expect(sent).toMatchObject({
      ok: false,
      error: { code: 'integration_unavailable', message: 'Resend rejected the request: API key is invalid' },
    });
    expect(JSON.stringify(sent)).not.toContain(settings.apiKey);
  });

  it('rejects malformed success payloads at the provider boundary', async () => {
    const email = createResendEmailPort(settings, {
      request: async () => response(200, { messageId: 'wrong-field' }),
    });

    await expect(email.send({
      to: 'creator@example.test',
      subject: 'Together test',
      html: '<p>It works.</p>',
      text: 'It works.',
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'integration_unavailable' },
    });
  });
});
