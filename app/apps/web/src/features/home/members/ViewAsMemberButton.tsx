import { useState } from 'react';
import { Alert, Box, Button, FormControl, FormLabel, OutlinedInput, Typography } from '@mui/material';
import { useMutation } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { ConfirmDialog } from '../../../components/layout/index.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';
import { navigateFresh } from '../../../lib/navigation.js';

export const ViewAsMemberButton = ({
  memberId,
  memberName,
  memberSurfaceUrl = '/start',
}: {
  memberId: string;
  memberName: string;
  memberSurfaceUrl?: string;
}) => {
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const start = useMutation({
    ...actions.startImpersonation,
    onSuccess: () => navigateFresh(memberSurfaceUrl),
  });

  return (
    <Box>
      <Button
        variant="outlined"
        data-testid="member-view-as"
        onClick={() => setConfirming(true)}
      >
        {t.members.impersonateAction}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={t.members.impersonateConfirmTitle}
        body={
          <>
            <Typography variant="body1">
              {t.members.impersonateConfirmBody({ name: memberName })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t.members.impersonateConfirmTtl}
            </Typography>
            <FormControl size="small">
              <FormLabel htmlFor="impersonate-reason">{t.members.impersonateReasonLabel}</FormLabel>
              <OutlinedInput
                id="impersonate-reason"
                size="small"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                inputProps={{ maxLength: 500, 'data-testid': 'member-view-as-reason' }}
              />
            </FormControl>
            {start.isError ? (
              <Alert severity="error">{localizePanelError(start.error, t)}</Alert>
            ) : null}
          </>
        }
        confirmLabel={start.isPending ? t.members.impersonateStarting : t.members.impersonateConfirm}
        cancelLabel={t.common.cancel}
        pending={start.isPending}
        confirmTestId="member-view-as-confirm"
        onClose={() => setConfirming(false)}
        onConfirm={() =>
          start.mutate({ memberId, reason: reason.trim() === '' ? null : reason.trim() })
        }
        data-testid="member-view-as-dialog"
      />
    </Box>
  );
};
