import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
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
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '@core/client/index.js';
import type { MemberExportFormat, MemberWithProductIds } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { ListPagination, usePagedList } from '../../../components/ui/ListPagination.js';
import { matchesQuery, SearchField, useDebouncedValue } from '../../../components/ui/SearchField.js';
import { localizeError, localizeErrorCode, useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDate } from '../../../lib/format.js';
import { EntryDate } from '../../../theme.js';

const errorMessage = (error: unknown, t: Messages): string =>
  error instanceof ApiError ? localizeErrorCode(error.appError.code, t) : t.members.exportFailed;

type GrantFilter = 'all' | 'active' | 'expired';

const GRANT_FILTERS: GrantFilter[] = ['all', 'active', 'expired'];

const grantFilterLabel = (t: Messages, value: GrantFilter): string =>
  value === 'all' ? t.members.filterAll : value === 'active' ? t.members.filterActive : t.members.filterExpired;

const matchesGrantFilter = (member: MemberWithProductIds, filter: GrantFilter): boolean => {
  if (filter === 'all') return true;
  if (filter === 'active') return member.activeProductIds.length > 0;
  return member.productIds.length > 0 && member.activeProductIds.length === 0;
};

export const MembersPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const members = useQuery(actions.members);
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState<MemberExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [grantFilter, setGrantFilter] = useState<GrantFilter>('all');
  const query = useDebouncedValue(search);
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

  const openMember = (memberId: string) =>
    void navigate({ to: '/panel/members/$memberId', params: { memberId } });

  const visibleMembers = (members.data?.members ?? [])
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((member) => matchesQuery(query, member.email, member.displayName))
    .filter((member) => matchesGrantFilter(member, grantFilter));
  const paged = usePagedList(visibleMembers, `${query}|${grantFilter}`);

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

        <Stack
          direction="row"
          useFlexGap
          sx={{ flexWrap: 'wrap', alignItems: 'center', columnGap: '1rem', rowGap: '0.6rem' }}
        >
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t.members.searchPlaceholder}
            testId="members-search"
          />
          <Stack
            direction="row"
            useFlexGap
            spacing="0.4rem"
            role="group"
            aria-label={t.members.grantFilterAria}
            sx={{ flexWrap: 'wrap' }}
          >
            {GRANT_FILTERS.map((value) => (
              <Chip
                key={value}
                size="small"
                clickable
                variant={grantFilter === value ? 'filled' : 'outlined'}
                color={grantFilter === value ? 'primary' : 'default'}
                label={grantFilterLabel(t, value)}
                aria-pressed={grantFilter === value}
                data-testid={`members-grant-filter-${value}`}
                onClick={() => setGrantFilter(value)}
              />
            ))}
          </Stack>
        </Stack>

        {members.isPending ? (
          <Typography variant="body1">{t.members.loading}</Typography>
        ) : members.isError ? (
          <Alert>{localizeError(members.error, t)}</Alert>
        ) : members.data.members.length === 0 ? (
          <Typography variant="body1">{t.members.empty}</Typography>
        ) : visibleMembers.length === 0 ? (
          <Typography variant="body1">{t.members.noMatches}</Typography>
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
                {paged.pageItems.map((member) => (
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
                        <Button size="small" onClick={() => openMember(member.id)}>
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
            <ListPagination paged={paged} testId="members-pagination" />
          </TableContainer>
        )}

        {exportError !== null ? <Alert>{exportError}</Alert> : null}
        {removeMember.isError ? <Alert>{errorMessage(removeMember.error, t)}</Alert> : null}
      </Stack>
    </Paper>
  );
};
