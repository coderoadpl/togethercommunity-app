import { Fragment } from 'react';

import type { Notification } from '#core/domain/index.js';

import { MemberAvatar } from './components/ui/MemberAvatar.js';
import { useLanguage, useTranslations } from './i18n/index.js';
import { formatDate, formatDateTime, formatRelativeTime } from './lib/format.js';
import { NotificationKindIcon } from './notification-icons.js';
import { notificationTarget, notificationTitle, notificationTitleParts } from './notification-links.js';
import {
  FinePrint,
  NotificationActor,
  NotificationActorMark,
  NotificationGroupHeading,
  NotificationItem,
  NotificationItemMain,
  NotificationItemMeta,
  NotificationItemStatic,
  NotificationItems,
  NotificationLine,
  NotificationSnippetLine,
  NotificationSubject,
  NotificationTypeMark,
  UnreadDot,
  VisuallyHidden,
} from './theme.js';

const DAY_MS = 86_400_000;

const GROUP_KEYS = ['today', 'yesterday', 'earlier'] as const;

type GroupKey = (typeof GROUP_KEYS)[number];

const startOfDay = (ms: number): number => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const groupOf = (createdAt: string, nowMs: number): GroupKey => {
  const today = startOfDay(nowMs);
  const created = new Date(createdAt).getTime();
  if (created >= today) return 'today';
  // Midday of the previous calendar day, so the boundary survives DST shifts.
  return created >= startOfDay(today - DAY_MS / 2) ? 'yesterday' : 'earlier';
};

const NotificationBody = ({ notification, group }: { notification: Notification; group: GroupKey }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const unread = notification.readAt === null;
  const parts = notificationTitleParts(t, notification);
  const { authorDisplay, authorAvatarUrl, snippet } = notification.payload;
  return (
    <>
      <NotificationActor>
        {authorDisplay === null ? (
          <NotificationActorMark>
            <NotificationKindIcon kind={notification.kind} />
          </NotificationActorMark>
        ) : (
          <>
            <MemberAvatar name={authorDisplay} avatarUrl={authorAvatarUrl} />
            <NotificationTypeMark>
              <NotificationKindIcon kind={notification.kind} />
            </NotificationTypeMark>
          </>
        )}
      </NotificationActor>
      <NotificationItemMain>
        <NotificationLine component="p" unread={unread}>
          {parts.before}
          <NotificationSubject>{parts.subject}</NotificationSubject>
          {parts.after}
        </NotificationLine>
        {snippet.length === 0 ? null : (
          <NotificationSnippetLine variant="body2" component="p">
            {snippet}
          </NotificationSnippetLine>
        )}
      </NotificationItemMain>
      <NotificationItemMeta>
        <FinePrint
          component="time"
          dateTime={notification.createdAt}
          title={formatDateTime(notification.createdAt, language)}
        >
          {group === 'earlier'
            ? formatDate(notification.createdAt, language)
            : formatRelativeTime(notification.createdAt, language)}
        </FinePrint>
        {unread ? (
          <>
            <UnreadDot aria-hidden />
            <VisuallyHidden>{t.notifications.unreadLabel}</VisuallyHidden>
          </>
        ) : null}
      </NotificationItemMeta>
    </>
  );
};

const NotificationRow = ({
  notification,
  group,
  onOpen,
}: {
  notification: Notification;
  group: GroupKey;
  onOpen: (notification: Notification) => void;
}) => {
  const t = useTranslations();
  const unread = notification.readAt === null;
  const testId = `notification-${notification.id}`;
  const body = <NotificationBody notification={notification} group={group} />;
  return (
    <li>
      {notificationTarget(notification).kind === 'none' ? (
        <NotificationItemStatic unread={unread} data-testid={testId}>
          {body}
        </NotificationItemStatic>
      ) : (
        <NotificationItem
          unread={unread}
          data-testid={testId}
          title={notificationTitle(t, notification)}
          onClick={() => onOpen(notification)}
        >
          {body}
        </NotificationItem>
      )}
    </li>
  );
};

export const NotificationList = ({
  notifications,
  onOpen,
}: {
  notifications: Notification[];
  onOpen: (notification: Notification) => void;
}) => {
  const t = useTranslations();
  const now = Date.now();
  const labels: Record<GroupKey, string> = {
    today: t.notifications.groupToday,
    yesterday: t.notifications.groupYesterday,
    earlier: t.notifications.groupEarlier,
  };

  return (
    <NotificationItems data-testid="notification-list">
      {GROUP_KEYS.map((key) => {
        const items = notifications.filter((item) => groupOf(item.createdAt, now) === key);
        if (items.length === 0) return null;
        return (
          <Fragment key={key}>
            <NotificationGroupHeading
              variant="overline"
              component="li"
              data-testid={`notification-group-${key}`}
            >
              {labels[key]}
            </NotificationGroupHeading>
            {items.map((item) => (
              <NotificationRow key={item.id} notification={item} group={key} onOpen={onOpen} />
            ))}
          </Fragment>
        );
      })}
    </NotificationItems>
  );
};
