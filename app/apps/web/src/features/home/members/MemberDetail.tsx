import { useState, type FormEvent } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormLabel,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { GrantSource, MemberGrant, MemberWithProductIds } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDate } from '../../../lib/format.js';
import { EntryDate } from '../../../theme.js';
import { MutationError } from '../courses/feedback.js';

const toIsoOrNull = (localValue: string): string | null =>
  localValue.trim() === '' ? null : new Date(localValue).toISOString();

const grantSourceLabel = (source: GrantSource, t: Messages): string =>
  source === 'manual' ? t.members.sourceManual : t.members.sourceSimulated;

const GrantForm = ({ memberId, onGranted }: { memberId: string; onGranted: () => Promise<void> }) => {
  const t = useTranslations();
  const products = useQuery(actions.products);
  const [productId, setProductId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const grant = useMutation({
    ...actions.grantProductToMember,
    onSuccess: async () => {
      setProductId('');
      setExpiresAt('');
      await onGranted();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!productId) return;
    grant.mutate({ memberId, productId, expiresAt: toIsoOrNull(expiresAt) });
  };

  return (
    <Paper elevation={1} component="form" onSubmit={submit} sx={{ p: '1rem', display: 'grid', gap: '0.75rem' }}>
      <Typography variant="h2" component="h3">
        {t.members.grantProduct}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem" sx={{ alignItems: 'flex-end' }}>
        <FormControl sx={{ flex: 1 }} size="small">
          <FormLabel htmlFor="grant-product">{t.members.productLabel}</FormLabel>
          <Select
            id="grant-product"
            displayEmpty
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            inputProps={{ 'aria-label': 'grant product' }}
          >
            <MenuItem value="">
              <em>{t.members.selectProduct}</em>
            </MenuItem>
            {(products.data?.products ?? []).map((product) => (
              <MenuItem key={product.id} value={product.id}>
                {product.title}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl sx={{ flex: 1 }} size="small">
          <FormLabel htmlFor="grant-expiry">{t.members.expiresOptional}</FormLabel>
          <OutlinedInput
            id="grant-expiry"
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            inputProps={{ 'aria-label': 'grant expiry' }}
          />
        </FormControl>
        <Button type="submit" variant="contained" disabled={grant.isPending || !productId}>
          {grant.isPending ? t.members.granting : t.members.grant}
        </Button>
      </Stack>
      {grant.isError ? <MutationError error={grant.error} /> : null}
    </Paper>
  );
};

const RenewControl = ({
  grant,
  memberId,
  onRenewed,
}: {
  grant: MemberGrant;
  memberId: string;
  onRenewed: () => Promise<void>;
}) => {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');

  const renew = useMutation({
    ...actions.grantProductToMember,
    onSuccess: async () => {
      setOpen(false);
      setExpiresAt('');
      await onRenewed();
    },
  });

  if (!open) {
    return (
      <Button size="small" variant="text" onClick={() => setOpen(true)}>
        {t.members.renew}
      </Button>
    );
  }

  return (
    <Stack direction="row" useFlexGap spacing="0.4rem" sx={{ alignItems: 'center' }}>
      <OutlinedInput
        size="small"
        type="datetime-local"
        value={expiresAt}
        onChange={(event) => setExpiresAt(event.target.value)}
        inputProps={{ 'aria-label': `renew expiry ${grant.id}` }}
      />
      <Button
        size="small"
        variant="text"
        disabled={renew.isPending}
        onClick={() => renew.mutate({ memberId, productId: grant.productId, expiresAt: toIsoOrNull(expiresAt) })}
      >
        {t.common.save}
      </Button>
    </Stack>
  );
};

export const MemberDetail = ({ member, onBack }: { member: MemberWithProductIds; onBack: () => void }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const grants = useQuery(actions.memberGrants(member.id));
  const [revoking, setRevoking] = useState<MemberGrant | null>(null);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries(actions.memberGrantsInvalidates(member.id)),
      queryClient.invalidateQueries(actions.membersInvalidates()),
    ]);
  };

  const revoke = useMutation({
    ...actions.revokeGrant,
    onSuccess: async () => {
      setRevoking(null);
      await refresh();
    },
  });

  return (
    <Stack useFlexGap spacing="1.5rem">
      <Stack direction="row" useFlexGap spacing="1rem" sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Button variant="text" onClick={onBack}>
          {t.members.allMembersBack}
        </Button>
        <Typography variant="h2" component="h2">
          {member.email}
        </Typography>
      </Stack>

      <Typography variant="body2">
        {t.members.joined}{' '}
        <EntryDate component="time" dateTime={member.createdAt}>
          {formatDate(member.createdAt, language)}
        </EntryDate>
      </Typography>

      <GrantForm memberId={member.id} onGranted={refresh} />

      <Box component="section">
        <Typography variant="h2" component="h3" sx={{ mb: '1rem' }}>
          {t.members.grantedProducts}
        </Typography>
        {grants.isPending ? (
          <Typography variant="body1">{t.members.loadingGrants}</Typography>
        ) : grants.isError ? (
          <MutationError error={grants.error} />
        ) : grants.data.grants.length === 0 ? (
          <Typography variant="body1">{t.members.noGrants}</Typography>
        ) : (
          <TableContainer>
            <Table size="small" aria-label={t.members.grantedProducts}>
              <TableHead>
                <TableRow>
                  <TableCell>{t.members.colProduct}</TableCell>
                  <TableCell>{t.members.colWindow}</TableCell>
                  <TableCell>{t.members.colSource}</TableCell>
                  <TableCell>{t.members.colStatus}</TableCell>
                  <TableCell align="right">{t.members.colActions}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {grants.data.grants.map((grant) => (
                  <TableRow key={grant.id} data-testid="grant-row">
                    <TableCell>{grant.productName}</TableCell>
                    <TableCell>
                      {formatDate(grant.startsAt, language)} –{' '}
                      {grant.expiresAt === null ? t.members.perpetual : formatDate(grant.expiresAt, language)}
                    </TableCell>
                    <TableCell>{grantSourceLabel(grant.source, t)}</TableCell>
                    <TableCell>
                      <Chip
                        variant="outlined"
                        color={grant.active ? 'success' : 'default'}
                        label={grant.active ? t.members.active : t.members.expired}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" useFlexGap spacing="0.4rem" sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <RenewControl grant={grant} memberId={member.id} onRenewed={refresh} />
                        <Button size="small" variant="text" color="error" onClick={() => setRevoking(grant)}>
                          {t.members.revoke}
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {revoke.isError ? <MutationError error={revoke.error} /> : null}
      </Box>

      <Dialog open={revoking !== null} onClose={() => setRevoking(null)}>
        <DialogTitle>{t.members.revokeAccess}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t.members.revokeConfirm({ product: revoking?.productName ?? '', email: member.email })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setRevoking(null)}>
            {t.common.cancel}
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={revoke.isPending}
            onClick={() => {
              if (revoking) revoke.mutate({ grantId: revoking.id });
            }}
          >
            {revoke.isPending ? t.members.revoking : t.members.revoke}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};
