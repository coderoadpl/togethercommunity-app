import { internal, normalizeEmail, ok, type AppError, type Result } from '@core/domain/index.js';
import type { EmailPort } from '@core/server/index.js';
import type { Db } from '@adapters/db/client.js';
import { devEmails } from '@adapters/db/schema.js';

export const createDevEmailPort = (db: Db): EmailPort => ({
  send: async (message): Promise<Result<{ messageId: string | null }, AppError>> => {
    const to = normalizeEmail(message.to);
    const createdAt = new Date().toISOString();
    console.error(`[dev-email] to=${to} subject=${message.subject}`);
    try {
      await db
        .insert(devEmails)
        .values({
          to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          createdAt,
        })
        .onConflictDoUpdate({
          target: devEmails.to,
          set: {
            subject: message.subject,
            html: message.html,
            text: message.text,
            createdAt,
          },
        });
      return ok({ messageId: null });
    } catch (cause) {
      return { ok: false, error: internal(`Could not store dev email: ${String(cause)}`) };
    }
  },
});
