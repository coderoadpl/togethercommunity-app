import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Paper,
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

import { ApiError } from '@core/client/index.js';
import type { MemberExportFormat, MemberWithProductIds } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDate } from '../../../lib/format.js';
import { EntryDate } from '../../../theme.js';
import { MemberDetail } from './MemberDetail.js';

const errorMessage = (error: unknown, t: Messages): string =>
  error instanceof ApiError ? error.appError.message : error instanceof Error ? error.message : t.members.exportFailed;

export const MembersPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const members = useQuery(actions.members);
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<MemberExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const removeMember = useMutation({
    ...actions.removeMember,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.membersInvalidates());
    },
  });

  const download = async (format: MemberExportFormat) => {
    setExporting(format);
    setExportError(null);
    try {
      const file = await queryClient.fetchQuery(actions.membersExport(format));
      const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(errorMessage(error, t));
    } finally {
      setExporting(null);
    }
  };

  const selected: MemberWithProductIds | null =
    members.data?.members.find((member) => member.id === selectedId) ?? null;
  if (selected) return <MemberDetail member={selected} onBack={() => setSelectedId(null)} />;

  return (
    <Paper elevation={1} sx={{ p: '1.5rem' }}>
      <Stack useFlexGap spacing="1.5rem">
        <Stack
          direction="row"
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'baseline', columnGap: '1rem', rowGap: '0.6rem' }}
        >
          <Typography variant="h2" component="h2">
            {t.members.heading}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="outlined"
            data-testid="export-csv"
            disabled={exporting !== null}
            onClick={() => void download('csv')}
          >
            {exporting === 'csv' ? t.members.exporting : t.members.exportCsv}
          </Button>
          <Button
            variant="outlined"
            data-testid="export-json"
            disabled={exporting !== null}
            onClick={() => void download('json')}
          >
            {exporting === 'json' ? t.members.exporting : t.members.exportJson}
          </Button>
        </Stack>

        {members.isPending ? (
          <Typography variant="body1">{t.members.loading}</Typography>
        ) : members.isError ? (
          <Alert>{members.error.message}</Alert>
        ) : members.data.members.length === 0 ? (
          <Typography variant="body1">{t.members.empty}</Typography>
        ) : (
          <TableContainer>
            <Table size="small" aria-label={t.members.heading}>
              <TableHead>
                <TableRow>
                  <TableCell>{t.members.colEmail}</TableCell>
                  <TableCell>{t.members.colName}</TableCell>
                  <TableCell align="right">{t.members.colProducts}</TableCell>
                  <TableCell>{t.members.colCreated}</TableCell>
                  <TableCell align="right">{t.members.colActions}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {members.data.members.map((member) => (
                  <TableRow key={member.id} data-testid="member-row">
                    <TableCell>{member.email}</TableCell>
                    <TableCell>{member.displayName ?? '—'}</TableCell>
                    <TableCell align="right">{member.productIds.length}</TableCell>
                    <TableCell>
                      <EntryDate component="time" dateTime={member.createdAt}>
                        {formatDate(member.createdAt, language)}
                      </EntryDate>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" useFlexGap spacing="0.4rem" sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <Button size="small" onClick={() => setSelectedId(member.id)}>
                          {t.members.manage}
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          disabled={removeMember.isPending}
                          onClick={() => removeMember.mutate({ memberId: member.id })}
                        >
                          {t.members.remove}
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {exportError !== null ? <Alert>{exportError}</Alert> : null}
        {removeMember.isError ? <Alert>{errorMessage(removeMember.error, t)}</Alert> : null}
      </Stack>
    </Paper>
  );
};
