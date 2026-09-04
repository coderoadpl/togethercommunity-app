import { Alert, Box, Button } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../../api.js';
import { localizePanelError, useTranslations, type Messages } from '../../../i18n/index.js';

const startErrorMessage = (error: Error, t: Messages): string =>
  error instanceof ApiError && error.appError.code === 'rate_limited'
    ? t.messages.rateLimited
    : error instanceof ApiError && (error.appError.code === 'forbidden' || error.appError.code === 'not_found')
      ? t.messages.recipientUnavailable
      : localizePanelError(error, t);

export const MessageMemberButton = ({ memberId }: { memberId: string }) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const settings = useQuery(actions.tenantSettings);
  const start = useMutation({
    ...actions.startConversation,
    onSuccess: (data) =>
      navigate({
        to: '/messages/$conversationId',
        params: { conversationId: data.conversation.id },
      }),
  });

  if (settings.data?.settings.directMessagesEnabled === false) return null;

  return (
    <Box>
      <Button
        variant="outlined"
        data-testid="member-start-message"
        disabled={start.isPending}
        onClick={() => start.mutate({ recipient: { kind: 'member', memberId } })}
      >
        {start.isPending ? t.messages.starting : t.messages.startFromAuthor}
      </Button>
      {start.isError ? (
        <Alert severity="error" sx={{ mt: '0.75rem' }}>
          {startErrorMessage(start.error, t)}
        </Alert>
      ) : null}
    </Box>
  );
};
