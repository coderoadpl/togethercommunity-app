import { internal, normalizeEmail, ok, type AppError, type Result } from '#core/domain/index.js';
import type { Clock, EmailPort } from '#core/server/index.js';
import type { Db } from '#adapters/db/client.js';
import { devEmails } from '#adapters/db/schema.js';

export const createDevEmailPort = (
  db: Db,
  clock: Clock = { nowIso: () => new Date().toISOString() },
): EmailPort => ({
  healthcheck: async () => ok({ healthy: true }),
  test: async () => ok({ code: 'email.available', message: 'Development email storage is available.' }),
  send: async (message): Promise<Result<{ messageId: string }, AppError>> => {
    const to = normalizeEmail(message.to);
    const createdAt = clock.nowIso();
    const messageId = message.messageId ?? `dev-${crypto.randomUUID()}`;
    console.error(`[dev-email] to=${to} subject=${message.subject}`);
    try {
      await db
        .insert(devEmails)
        .values({
          to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: message.headers ?? {},
          messageId,
          createdAt,
        })
        .onConflictDoUpdate({
          target: devEmails.to,
          set: {
            subject: message.subject,
            html: message.html,
            text: message.text,
            headers: message.headers ?? {},
            messageId,
            createdAt,
          },
        });
      return ok({ messageId });
    } catch (cause) {
      return { ok: false, error: internal(`Could not store dev email: ${String(cause)}`) };
    }
  },
});
