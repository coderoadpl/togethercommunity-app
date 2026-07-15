import { ok, type AppError, type Notification, type Result } from '@core/domain/index.js';
import type { EmailPort, NotificationChannelPort, NotificationDeliveryContext } from '@core/server/index.js';

const escapeHtmlCharacter = (character: string): string => {
  switch (character) {
    case '&':
      return '&amp;';
    case '<':
      return '&lt;';
    case '>':
      return '&gt;';
    case '"':
      return '&quot;';
    case "'":
      return '&#39;';
    default:
      return character;
  }
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, escapeHtmlCharacter);

const threadReplyMessage = (notification: Notification, context: NotificationDeliveryContext) => {
  const author = notification.payload.authorDisplay;
  const tenantName = context.tenantName;
  const snippet = notification.payload.snippet;
  return {
    subject: `Nowa odpowiedź w ${tenantName}`,
    html: `<p>Cześć!</p><p>${escapeHtml(author)} dodał(a) odpowiedź w dyskusji.</p><p>${escapeHtml(snippet)}</p>`,
    text: `Cześć!\n\n${author} dodał(a) odpowiedź w dyskusji.\n\n${snippet}`,
  };
};

export const createEmailNotificationChannel = (email: EmailPort): NotificationChannelPort => ({
  deliver: async (
    notification: Notification,
    context: NotificationDeliveryContext,
  ): Promise<Result<void, AppError>> => {
    if (context.recipientEmail === null) return ok(undefined);
    const sent = await email.send({ to: context.recipientEmail, ...threadReplyMessage(notification, context) });
    return sent.ok ? ok(undefined) : sent;
  },
});
