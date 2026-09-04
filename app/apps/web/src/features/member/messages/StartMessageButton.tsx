import { Alert, Snackbar } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../../api.js';
import { localizeError, useTranslations, type Messages } from '../../../i18n/index.js';
import { PostToolbarButton, SHELL_SNACKBAR_ANCHOR } from '../../../theme.js';

const startErrorMessage = (error: Error, t: Messages): string =>
  error instanceof ApiError && (error.appError.code === 'forbidden' || error.appError.code === 'not_found')
    ? t.messages.recipientUnavailable
    : error instanceof ApiError && error.appError.code === 'rate_limited'
      ? t.messages.rateLimited
      : localizeError(error, t);

export interface StartPostConversation {
  available: boolean;
  pending: boolean;
  error: Error | null;
  start: () => void;
  dismissError: () => void;
}

export const useStartPostConversation = (postId: string): StartPostConversation => {
  const navigate = useNavigate();
  const me = useQuery(actions.me);
  const navigation = useQuery(actions.memberNavigation);
  const start = useMutation({
    ...actions.startConversation,
    onSuccess: (data) =>
      navigate({
        to: '/messages/$conversationId',
        params: { conversationId: data.conversation.id },
      }),
  });
  const tenant = me.data?.tenant ?? null;

  return {
    available:
      tenant !== null
      && !tenant.banned
      && navigation.data?.navigation.directMessagesEnabled !== false,
    pending: start.isPending,
    error: start.isError ? start.error : null,
    start: () => start.mutate({ recipient: { kind: 'post-author', postId } }),
    dismissError: () => start.reset(),
  };
};

export const StartMessageErrorSnackbar = ({ conversation }: { conversation: StartPostConversation }) => {
  const t = useTranslations();
  return (
    <Snackbar
      open={conversation.error !== null}
      autoHideDuration={6000}
      anchorOrigin={SHELL_SNACKBAR_ANCHOR}
      onClose={conversation.dismissError}
    >
      <Alert severity="error" onClose={conversation.dismissError}>
        {conversation.error === null ? '' : startErrorMessage(conversation.error, t)}
      </Alert>
    </Snackbar>
  );
};

export const StartMessageButton = ({ postId }: { postId: string }) => {
  const t = useTranslations();
  const conversation = useStartPostConversation(postId);

  if (!conversation.available) return null;

  return (
    <>
      <PostToolbarButton
        size="small"
        variant="text"
        data-testid={`start-message-${postId}`}
        disabled={conversation.pending}
        onClick={conversation.start}
      >
        {conversation.pending ? t.messages.starting : t.messages.startFromAuthor}
      </PostToolbarButton>
      <StartMessageErrorSnackbar conversation={conversation} />
    </>
  );
};
