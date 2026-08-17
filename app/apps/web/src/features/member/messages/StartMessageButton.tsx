import { Alert, Button, Snackbar } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../../api.js';
import { localizeError, useTranslations, type Messages } from '../../../i18n/index.js';
import { SHELL_SNACKBAR_ANCHOR } from '../../../theme.js';

const startErrorMessage = (error: Error, t: Messages): string =>
  error instanceof ApiError && (error.appError.code === 'forbidden' || error.appError.code === 'not_found')
    ? t.messages.recipientUnavailable
    : error instanceof ApiError && error.appError.code === 'rate_limited'
      ? t.messages.rateLimited
      : localizeError(error, t);

export const StartMessageButton = ({ postId }: { postId: string }) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const me = useQuery(actions.me);
  const start = useMutation({
    ...actions.startConversation,
    onSuccess: (data) =>
      navigate({
        to: '/messages/$conversationId',
        params: { conversationId: data.conversation.id },
      }),
  });

  const tenant = me.data?.tenant ?? null;
  if (tenant === null || tenant.banned) return null;

  return (
    <>
      <Button
        size="small"
        variant="text"
        data-testid={`start-message-${postId}`}
        disabled={start.isPending}
        onClick={() => start.mutate({ recipient: { kind: 'post-author', postId } })}
      >
        {start.isPending ? t.messages.starting : t.messages.startFromAuthor}
      </Button>
      <Snackbar
        open={start.isError}
        autoHideDuration={6000}
        anchorOrigin={SHELL_SNACKBAR_ANCHOR}
        onClose={() => start.reset()}
      >
        <Alert severity="error" onClose={() => start.reset()}>
          {start.isError ? startErrorMessage(start.error, t) : ''}
        </Alert>
      </Snackbar>
    </>
  );
};
