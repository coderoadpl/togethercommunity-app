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
    const createTransport = vi.fn(() => ({ sendMail }));
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
});
