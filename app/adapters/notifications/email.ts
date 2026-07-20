import { ok, spacePost, threadReply } from '@core/domain/index.js';
import type { EmailPort, NotificationChannelPort } from '@core/server/index.js';

export const createEmailNotificationChannel = (email: EmailPort): NotificationChannelPort => ({
  deliver: async (notification, context) => {
    if (context.recipientEmail === null) return ok(undefined);
    const message =
      notification.kind === 'space-post'
        ? spacePost(context.language, {
            tenantName: context.tenantName,
            spaceName: context.contextName,
            authorDisplay: notification.payload.authorDisplay,
            snippet: notification.payload.snippet,
            url: context.contextUrl,
          })
        : threadReply(context.language, {
            tenantName: context.tenantName,
            lessonName: context.contextName,
            authorDisplay: notification.payload.authorDisplay,
            snippet: notification.payload.snippet,
            url: context.contextUrl,
          });
    const sent = await email.send({ to: context.recipientEmail, ...message });
    return sent.ok ? ok(undefined) : sent;
  },
});
