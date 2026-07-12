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
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';
import type { MemberExportFormat } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { EntryDate } from '../../../theme.js';

const displayDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));

const errorMessage = (error: unknown): string =>
  error instanceof ApiError ? error.appError.message : error instanceof Error ? error.message : 'Export failed';

export const MembersPanel = () => {
  const members = useQuery(actions.members);
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState<MemberExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

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
      setExportError(errorMessage(error));
    } finally {
      setExporting(null);
    }
  };

  return (
    <Paper elevation={1} sx={{ p: '1.5rem' }}>
      <Stack useFlexGap spacing="1.5rem">
        <Stack
          direction="row"
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'baseline', columnGap: '1rem', rowGap: '0.6rem' }}
        >
          <Typography variant="h2" component="h2">
            Members
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="outlined"
            data-testid="export-csv"
            disabled={exporting !== null}
            onClick={() => void download('csv')}
          >
            {exporting === 'csv' ? 'exporting…' : 'Export CSV'}
          </Button>
          <Button
            variant="outlined"
            data-testid="export-json"
            disabled={exporting !== null}
            onClick={() => void download('json')}
          >
            {exporting === 'json' ? 'exporting…' : 'Export JSON'}
          </Button>
        </Stack>

        {members.isPending ? (
          <Typography variant="body1">loading members…</Typography>
        ) : members.isError ? (
          <Alert>{members.error.message}</Alert>
        ) : members.data.members.length === 0 ? (
          <Typography variant="body1">No members yet.</Typography>
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Members">
              <TableHead>
                <TableRow>
                  <TableCell>Email</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell align="right">Products</TableCell>
                  <TableCell>Created</TableCell>
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
                        {displayDate(member.createdAt)}
                      </EntryDate>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {exportError !== null ? <Alert>{exportError}</Alert> : null}
      </Stack>
    </Paper>
  );
};
