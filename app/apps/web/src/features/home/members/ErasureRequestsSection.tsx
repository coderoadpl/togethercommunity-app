import { useState } from 'react';
import { Button, OutlinedInput, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type { MemberErasureRequestWithMember } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import {
  ConfirmDialog,
  SectionCard,
  StatusView,
} from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';

export const ErasureRequestsSection = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const requests = useQuery(actions.erasureRequests);
  const [note, setNote] = useState('');
  const [removing, setRemoving] = useState<MemberErasureRequestWithMember | null>(
    null,
  );
  const reject = useMutation({
    ...actions.rejectErasureRequest,
    onSuccess: () => {
      setNote('');
      void requests.refetch();
    },
  });
  const remove = useMutation({
    ...actions.removeMember,
    onSuccess: async () => {
      setRemoving(null);
      await Promise.all([
        requests.refetch(),
        queryClient.invalidateQueries(actions.membersInvalidates()),
      ]);
    },
  });

  return (
    <>
      <SectionCard title={t.members.erasureRequestsHeading}>
        {requests.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.common.loading }} />
        ) : requests.isError ? (
          <StatusView
            state={{ kind: 'error', message: localizeError(requests.error, t) }}
          />
        ) : requests.data.requests.length === 0 ? (
          <Typography>{t.members.erasureRequestsEmpty}</Typography>
        ) : (
          <Stack useFlexGap spacing="1rem">
            {requests.data.requests.map((request) => (
              <Stack key={request.id} useFlexGap spacing="0.5rem">
                <Typography>
                  {request.member.email} · {request.status} · {request.dueAt.slice(0, 10)}
                </Typography>
                <Stack direction="row" useFlexGap spacing="0.5rem">
                  <Button
                    size="small"
                    onClick={() =>
                      void navigate({
                        to: '/panel/members/$memberId',
                        params: { memberId: request.memberId },
                      })
                    }
                  >
                    {t.members.manage}
                  </Button>
                  {request.status === 'open' ? (
                    <>
                      <OutlinedInput
                        size="small"
                        placeholder={t.members.erasureRejectNote}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                      />
                      <Button
                        size="small"
                        color="error"
                        disabled={note.trim() === '' || reject.isPending}
                        onClick={() =>
                          reject.mutate({ requestId: request.id, note: note.trim() })
                        }
                      >
                        {t.members.erasureReject}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        variant="contained"
                        onClick={() => setRemoving(request)}
                      >
                        {t.members.remove}
                      </Button>
                    </>
                  ) : null}
                </Stack>
              </Stack>
            ))}
          </Stack>
        )}
      </SectionCard>
      <ConfirmDialog
        open={removing !== null}
        title={t.members.removeConfirmTitle}
        body={
          <Typography>
            {t.members.removeConfirmIntro({ email: removing?.member.email ?? '' })}
          </Typography>
        }
        confirmLabel={remove.isPending ? t.members.removing : t.members.remove}
        cancelLabel={t.common.cancel}
        pending={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing !== null) remove.mutate({ memberId: removing.memberId });
        }}
      />
    </>
  );
};
