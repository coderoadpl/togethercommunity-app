import { useEffect, useState } from 'react';
import { Box, Button, Link as MuiLink, Stack } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import { conversationPath } from '#core/contract/index.js';
import type { PublicDmConversation } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ListSection, StatusView } from '../../../components/layout/index.js';
import { MemberAvatar } from '../../../components/ui/MemberAvatar.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatRelativeTime } from '../../../lib/format.js';
import {
  AuthorChip,
  ConversationCard,
  FinePrint,
  NotificationSnippet,
  NotificationTitle,
  UnreadDot,
  VisuallyHidden,
} from '../../../theme.js';
import { MemberSurface } from '../MemberSurface.js';
import { MessagesIcon } from '../shell/shell-icons.js';

const PAGE_SIZE = 20;
const MAX_LIMIT = 100;

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const ConversationRow = ({ conversation }: { conversation: PublicDmConversation }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const snippet = conversation.hasMessages
    ? conversation.lastMessageIsOwn
      ? `${t.messages.ownPrefix} ${conversation.lastMessageSnippet}`
      : conversation.lastMessageSnippet
    : t.messages.emptyConversation;

  return (
    <ConversationCard
      component={Link}
      to={conversationPath(conversation.id)}
      data-testid={`conversation-row-${conversation.id}`}
    >
      <Stack direction="row" useFlexGap sx={{ columnGap: '0.6rem', alignItems: 'flex-start' }}>
        {conversation.unread ? (
          <>
            <UnreadDot aria-hidden />
            <VisuallyHidden>{t.notifications.unreadLabel}</VisuallyHidden>
          </>
        ) : null}
        <MemberAvatar
          name={conversation.otherParticipant.display}
          avatarUrl={conversation.otherParticipant.avatarUrl}
          size="sm"
        />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" useFlexGap sx={{ columnGap: '0.5rem', alignItems: 'center' }}>
            <NotificationTitle component="p" unread={conversation.unread}>
              {conversation.otherParticipant.display}
            </NotificationTitle>
            {conversation.otherParticipant.isStaff ? (
              <AuthorChip>{t.discussion.authorChip}</AuthorChip>
            ) : null}
          </Stack>
          <NotificationSnippet variant="body2" component="p">
            {snippet}
          </NotificationSnippet>
          <FinePrint component="p">
            {formatRelativeTime(conversation.lastMessageAt, language)}
          </FinePrint>
        </Box>
      </Stack>
    </ConversationCard>
  );
};

export const MessagesListPage = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const [limit, setLimit] = useState(PAGE_SIZE);

  const list = useQuery({
    ...actions.conversations(limit),
    placeholderData: (previous) => previous,
  });

  const unauthorized = isUnauthorized(list.error);
  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  if (list.isPending) {
    return (
      <MemberSurface
        title={t.messages.title}
        eyebrow={t.messages.eyebrow}
        state={{ kind: 'loading', label: t.messages.loading }}
      />
    );
  }

  if (unauthorized) return null;

  if (list.isError) {
    return (
      <MemberSurface
        title={t.messages.title}
        eyebrow={t.messages.eyebrow}
        state={{
          kind: 'error',
          message: localizeError(list.error, t),
          retry: { label: t.common.retry, onRetry: () => void list.refetch() },
        }}
      />
    );
  }

  const pagination =
    list.data.nextCursor === null || limit >= MAX_LIMIT ? null : (
      <Button
        variant="outlined"
        data-testid="conversations-load-more"
        disabled={list.isFetching}
        onClick={() => setLimit((previous) => Math.min(previous + PAGE_SIZE, MAX_LIMIT))}
      >
        {t.messages.loadOlder}
      </Button>
    );

  return (
    <MemberSurface title={t.messages.title} eyebrow={t.messages.eyebrow}>
      <ListSection
        data-testid="conversations-list"
        isEmpty={list.data.conversations.length === 0}
        empty={
          <StatusView
            state={{
              kind: 'empty',
              icon: <MessagesIcon />,
              title: <span data-testid="conversations-empty">{t.messages.emptyList}</span>,
              body: t.messages.emptyListHint,
              action: (
                <MuiLink component={Link} to="/community">
                  {t.messages.browseSpaces}
                </MuiLink>
              ),
            }}
          />
        }
        {...(pagination === null ? {} : { pagination })}
      >
        <Stack useFlexGap sx={{ rowGap: '0.75rem' }}>
          {list.data.conversations.map((conversation) => (
            <ConversationRow key={conversation.id} conversation={conversation} />
          ))}
        </Stack>
      </ListSection>
    </MemberSurface>
  );
};
