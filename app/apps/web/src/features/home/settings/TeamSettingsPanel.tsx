import { useState } from 'react';
import {
  Button, Chip, FormControl, FormLabel, OutlinedInput, Stack,
  Table, TableBody, TableCell, TableContainer, TableRow, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { TenantTeamMember } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, SectionCard, StatusView } from '../../../components/layout/index.js';
import { useToastOutcome } from '../../../components/ui/Toast.js';
import { errorCodeOf, localizePanelError, serverMessageOf, useTranslations } from '../../../i18n/index.js';
import { usePanelContext } from '../panel-context.js';

export const TeamSettingsPanel = () => {
  const t = useTranslations();
  const { email: currentEmail } = usePanelContext();
  const queryClient = useQueryClient();
  const team = useQuery(actions.tenantTeam);
  const [email, setEmail] = useState('');
  const [removing, setRemoving] = useState<TenantTeamMember | null>(null);
  const add = useMutation({
    ...actions.addTenantAdmin,
    onSuccess: async () => {
      setEmail('');
      await queryClient.invalidateQueries(actions.tenantTeamInvalidates());
    },
  });
  const remove = useMutation({
    ...actions.removeTenantAdmin,
    onSuccess: async () => {
      setRemoving(null);
      await queryClient.invalidateQueries(actions.tenantTeamInvalidates());
    },
  });
  const addError = add.error === null ? null : localizePanelError(add.error, t);
  useToastOutcome(add.isSuccess, t.common.saved,
    errorCodeOf(add.error) === 'validation' ? serverMessageOf(add.error) ?? addError : addError);
  useToastOutcome(remove.isSuccess, t.common.saved, remove.error === null ? null : localizePanelError(remove.error, t));
  const pending = add.isPending || remove.isPending;

  return (
    <SectionCard title={t.tenantTeam.heading} description={t.tenantTeam.helper} data-testid="team-settings">
      {team.isPending ? <Typography>{t.common.loading}</Typography> : null}
      {team.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizePanelError(team.error, t), retry: { label: t.common.retry, onRetry: () => void team.refetch() } }} /> : null}
      {team.data ? (
        <TableContainer>
          <Table size="small" aria-label={t.tenantTeam.heading} sx={{ tableLayout: 'fixed' }}>
            <TableBody>
              {team.data.members.map((member) => {
                const isCurrentUser = member.email.toLowerCase() === currentEmail.toLowerCase();
                return (
                  <TableRow key={member.userId}>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>
                      <Stack useFlexGap spacing="0.25rem">
                        <Typography variant="body2">{member.email}</Typography>
                        {member.name ? <Typography component="p" variant="caption">{member.name}</Typography> : null}
                        {isCurrentUser ? <Typography component="p" variant="caption">{t.tenantTeam.you}</Typography> : null}
                      </Stack>
                    </TableCell>
                    <TableCell align="right" sx={{ width: '9rem' }}>
                      <Stack useFlexGap spacing="0.25rem" sx={{ alignItems: 'flex-end' }}>
                        <Chip size="small" label={member.role === 'owner' ? t.tenantTeam.owner : t.tenantTeam.administrator} />
                        {member.role === 'admin' && !isCurrentUser ? <Button color="error" disabled={pending} onClick={() => setRemoving(member)}>{t.common.remove}</Button> : null}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
      <Stack component="form" useFlexGap spacing="0.75rem" onSubmit={(event) => {
        event.preventDefault();
        add.mutate({ email });
      }}>
        <Typography variant="h6">{t.tenantTeam.addAdministrator}</Typography>
        <FormControl fullWidth>
          <FormLabel htmlFor="team-admin-email">{t.auth.emailLabel}</FormLabel>
          <OutlinedInput id="team-admin-email" type="email" required value={email} disabled={pending} onChange={(event) => setEmail(event.target.value)} />
        </FormControl>
        <Button type="submit" variant="contained" disabled={pending || email.trim().length === 0} sx={{ alignSelf: 'flex-start' }}>{t.common.add}</Button>
      </Stack>
      {removing ? (
        <ConfirmDialog open title={t.tenantTeam.removeConfirm} body={<Typography>{removing.email}</Typography>}
          confirmLabel={t.common.remove} cancelLabel={t.common.cancel} pending={remove.isPending}
          onClose={() => setRemoving(null)} onConfirm={() => remove.mutate({ userId: removing.userId })} />
      ) : null}
    </SectionCard>
  );
};
