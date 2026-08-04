import { describe, expect, it, vi } from 'vitest';

import { createSmtpEmailPort } from './smtp.js';

const settings = {
  host: 'smtp.example.test',
  port: 465,
  user: 'creator@example.test',
  password: 'secret',
  secure: true,
  from: 'Creator <creator@example.test>',
};

describe('SMTP transactional e-mail adapter', () => {
  it('maps the EmailPort message to Nodemailer', async () => {
    const sendMail = vi.fn(async () => ({ messageId: '<smtp-message@example.test>' }));
    const createTransport = vi.fn(() => ({ verify: async () => true, sendMail }));
    const email = createSmtpEmailPort(settings, createTransport);

    const sent = await email.send({
      to: 'member@example.test',
      subject: 'Welcome',
      html: '<p>Welcome</p>',
      text: 'Welcome',
      headers: { 'X-Test': 'yes' },
    });

    expect(createTransport).toHaveBeenCalledWith({
      host: settings.host,
      port: settings.port,
      secure: true,
      auth: { user: settings.user, pass: settings.password },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: settings.from,
      to: 'member@example.test',
      subject: 'Welcome',
      html: '<p>Welcome</p>',
      text: 'Welcome',
      headers: { 'X-Test': 'yes' },
    });
    expect(sent).toEqual({ ok: true, value: { messageId: '<smtp-message@example.test>' } });
  });

  it('returns a structured failure when the relay rejects a message', async () => {
    const email = createSmtpEmailPort(settings, () => ({
      verify: async () => true,
      sendMail: async () => {
        throw new Error('authentication failed');
      },
    }));

    const sent = await email.send({
      to: 'member@example.test',
      subject: 'Welcome',
      html: '<p>Welcome</p>',
      text: 'Welcome',
    });

    expect(sent.ok).toBe(false);
    if (!sent.ok) {
      expect(sent.error.code).toBe('integration_unavailable');
      expect(sent.error.message).toContain('authentication failed');
    }
  });

  it('records no delivery telemetry for SMTP sends', async () => {
    const email = createSmtpEmailPort(settings, () => ({
      verify: async () => true,
      sendMail: async () => ({ messageId: '<accepted-only@example.test>' }),
    }));

    const sent = await email.send({
      to: 'member@example.test',
      subject: 'Accepted',
      html: '<p>Accepted</p>',
      text: 'Accepted',
    });

    expect(sent).toEqual({
      ok: true,
      value: { messageId: '<accepted-only@example.test>' },
    });
  });

  it('connects to a local SMTP sink without authentication', async () => {
    const createTransport = vi.fn(() => ({
      verify: async () => true,
      sendMail: async () => ({ messageId: '<mailpit-message@local>' }),
    }));

    createSmtpEmailPort(
      {
        host: 'localhost',
        port: 47925,
        secure: false,
        from: 'Together <dev@together.local>',
      },
      createTransport,
    );

    expect(createTransport).toHaveBeenCalledWith({
      host: 'localhost',
      port: 47925,
      secure: false,
    });
  });

  it('verifies the relay through healthcheck and the shared test contract', async () => {
    const verify = vi.fn(async () => true);
    const email = createSmtpEmailPort(settings, () => ({
      verify,
      sendMail: async () => ({ messageId: '<unused@example.test>' }),
    }));

    await expect(email.healthcheck()).resolves.toEqual({ ok: true, value: { healthy: true } });
    await expect(email.test()).resolves.toEqual({
      ok: true,
      value: { code: 'email.available', message: 'SMTP accepted the connection settings.' },
    });
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it.each([
    { code: 'EAUTH' },
    { responseCode: 454 },
    { responseCode: 534 },
    { responseCode: 535 },
    { responseCode: 538 },
  ])('classifies SMTP authentication failures without exposing provider text', async (failure) => {
    const email = createSmtpEmailPort(settings, () => ({
      verify: async () => { throw failure; },
      sendMail: async () => ({ messageId: '<unused@example.test>' }),
    }));

    await expect(email.test()).resolves.toEqual({
      ok: false,
      error: { code: 'integration_auth', message: 'SMTP rejected the credentials.' },
    });
  });
});
