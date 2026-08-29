import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import type { PublicDmMessage } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { MemberAvatar } from '../../../components/ui/MemberAvatar.js';
import { localizeError, useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatRelativeTime } from '../../../lib/format.js';
import {
  CONVERSATION_POLL_INTERVAL_MS,
  streamlessPollInterval,
} from '../../../notifications-stream.js';
import { useNotificationsTransport } from '../../../notifications-transport.js';
import {
  AuthorChip,
  MessageBubble,
  PostBody,
  PostMetaText,
} from '../../../theme.js';
import { MemberSurface } from '../MemberSurface.js';
import { MessageComposer } from './MessageComposer.js';

const PAGE_SIZE = 30;
const MAX_LIMIT = 100;

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const sendErrorMessage = (error: Error, t: Messages): string => {
  if (!(error instanceof ApiError)) return localizeError(error, t);
  if (error.appError.code === 'rate_limited') return t.messages.rateLimited;
  if (error.appError.code === 'forbidden') return t.messages.recipientUnavailable;
  return localizeError(error, t);
};

const MessageRow = ({ message }: { message: PublicDmMessage }) => {
  const { language } = useLanguage();
  return (
    <MessageBubble own={message.isOwn} data-testid={`message-${message.id}`}>
      <PostBody variant="body1" component="p">
        {message.body}
      </PostBody>
      <PostMetaText component="time" dateTime={message.createdAt}>
        {formatRelativeTime(message.createdAt, language)}
      </PostMetaText>
    </MessageBubble>
  );
};

export const ConversationPage = ({ conversationId }: { conversationId: string }) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const { streamless } = useNotificationsTransport();

  const thread = useQuery({
    ...actions.conversation(conversationId, limit),
    placeholderData: (previous) => previous,
    refetchInterval: streamlessPollInterval(streamless, CONVERSATION_POLL_INTERVAL_MS),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries(actions.messagesInvalidates());
    await queryClient.invalidateQueries(actions.notificationsInvalidates());
  };

  const { mutate: markRead } = useMutation({
    ...actions.markConversationRead,
    onSuccess: invalidate,
  });
  const send = useMutation({ ...actions.sendMessage, onSuccess: invalidate });

  const latestMessageId = thread.data?.messages[0]?.id ?? null;
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (thread.data === undefined) return;
    const marker = `${conversationId}:${latestMessageId ?? ''}`;
    if (markedRef.current === marker) return;
    markedRef.current = marker;
    markRead({ conversationId });
  }, [conversationId, latestMessageId, markRead, thread.data]);

  const unauthorized = isUnauthorized(thread.error);
  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  const backLink = (
    <Button component={Link} to="/messages" variant="text" data-testid="conversation-back">
      {t.messages.backToList}
    </Button>
  );

  if (thread.isPending) {
    return (
      <MemberSurface
        title={t.messages.title}
        eyebrow={t.messages.conversationEyebrow}
        state={{ kind: 'loading', label: t.messages.loading }}
      />
    );
  }

  if (unauthorized) return null;

  if (thread.isError) {
    return (
      <MemberSurface
        title={t.messages.title}
        eyebrow={t.messages.conversationEyebrow}
        state={{
          kind: 'error',
          message: localizeError(thread.error, t),
          retry: { label: t.common.retry, onRetry: () => void thread.refetch() },
        }}
      />
    );
  }

  const { conversation, messages, nextCursor } = thread.data;
  const chronological = [...messages].reverse();

  return (
    <MemberSurface
      title={conversation.otherParticipant.display}
      eyebrow={t.messages.conversationEyebrow}
    >
      <Stack useFlexGap sx={{ rowGap: '1.25rem' }} data-testid="conversation-page">
        <Stack direction="row" useFlexGap sx={{ columnGap: '0.6rem', alignItems: 'center' }}>
          <MemberAvatar
            name={conversation.otherParticipant.display}
            avatarUrl={conversation.otherParticipant.avatarUrl}
            size="sm"
          />
          {conversation.otherParticipant.isStaff ? (
            <AuthorChip>{t.discussion.authorChip}</AuthorChip>
          ) : null}
          <Box sx={{ flex: 1 }} />
          {backLink}
        </Stack>

        {nextCursor === null || limit >= MAX_LIMIT ? null : (
          <Box>
            <Button
              variant="outlined"
              data-testid="conversation-load-older"
              disabled={thread.isFetching}
              onClick={() => setLimit((previous) => Math.min(previous + PAGE_SIZE, MAX_LIMIT))}
            >
              {t.messages.loadOlder}
            </Button>
          </Box>
        )}

        {chronological.length === 0 ? (
          <Typography variant="body2" data-testid="conversation-empty">
            {t.messages.emptyConversation}
          </Typography>
        ) : (
          <Stack useFlexGap sx={{ rowGap: '0.6rem' }} data-testid="conversation-messages">
            {chronological.map((message) => (
              <MessageRow key={message.id} message={message} />
            ))}
          </Stack>
        )}

        {send.isError ? <Alert severity="error">{sendErrorMessage(send.error, t)}</Alert> : null}

        <MessageComposer
          busy={send.isPending}
          onSend={(body, reset) =>
            send.mutate({ conversationId, body }, { onSuccess: () => reset() })
          }
        />
      </Stack>
    </MemberSurface>
  );
};
