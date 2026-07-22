import { ok } from '@core/domain/index.js';
import type { EmailPort, SesMarketingSender } from '@core/server/index.js';

export const createDevMarketingSender = (email: EmailPort): SesMarketingSender => ({
  send: async (input) => {
    const sent = await email.send({ to: input.to, subject: input.subject, html: input.html, text: input.text });
    return sent.ok ? ok({ messageId: sent.value.messageId ?? `dev-${crypto.randomUUID()}` }) : sent;
  },
});
