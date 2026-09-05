import { normalizeEmail, ok } from '#core/domain/index.js';
import type { EmailPort } from '#core/server/index.js';

export const createSinkEmailPort = (log: (message: string) => void): EmailPort => ({
  healthcheck: async () => ok({ healthy: true }),
  test: async () => ok({ code: 'email.available', message: 'The e-mail sink accepts and drops every message.' }),
  send: async (message) => {
    log(`[email-sink] to=${normalizeEmail(message.to)} subject=${message.subject}`);
    return ok({ messageId: message.messageId ?? `sink-${crypto.randomUUID()}` });
  },
});
