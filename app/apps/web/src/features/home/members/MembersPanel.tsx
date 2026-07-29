import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
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

import { ApiError } from '#core/client/index.js';
import type { MemberExportFormat, MemberWithProductIds } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, ListSection, PanelPage, ResponsiveTable, StatusView } from '../../../components/layout/index.js';
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
  const [removing, setRemoving] = useState<MemberWithProductIds | null>(null);
  const [failedSubscriptionIds, setFailedSubscriptionIds] = useState<string[]>([]);
  const query = useDebouncedValue(search);
  const impactMemberId = removing?.id ?? '';
  const removalGrants = useQuery({
    ...actions.memberGrants(impactMemberId),
    enabled: removing !== null,
  });
  const removalProgress = useQuery({
    ...actions.memberLearningSummary(impactMemberId),
    enabled: removing !== null,
  });
  const removeMember = useMutation({
    ...actions.removeMember,
    onSuccess: async (result) => {
      setFailedSubscriptionIds(
        result.subscriptionCancellations.flatMap((cancellation) =>
          cancellation.outcome === 'failed' && cancellation.providerSubscriptionId !== null
            ? [cancellation.providerSubscriptionId]
            : [],
        ),
      );
      setRemoving(null);
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
    <PanelPage
      title={t.members.heading}
      action={
        <Stack direction="row" useFlexGap spacing="0.75rem" sx={{ flexWrap: 'wrap' }}>
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
      }
    >
      <ListSection
        toolbar={{
          search: (
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t.members.searchPlaceholder}
            testId="members-search"
          />
          ),
          filters: (
            <Stack direction="row" useFlexGap spacing="0.4rem" role="group" aria-label={t.members.grantFilterAria}>
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
          ),
        }}
        pagination={members.isSuccess && visibleMembers.length > 0 ? <ListPagination paged={paged} testId="members-pagination" /> : undefined}
        isEmpty={members.isSuccess && members.data.members.length === 0}
        empty={<StatusView state={{ kind: 'empty', title: t.members.empty }} />}
        noMatches={members.isSuccess && members.data.members.length > 0 && visibleMembers.length === 0 ? <Typography variant="body1">{t.members.noMatches}</Typography> : undefined}
      >
        {members.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.members.loading }} />
        ) : members.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(members.error, t) }} />
        ) : (
          <ResponsiveTable>
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
                    <TableCell>
                      {member.deletedAt !== null ? (
                        <Chip size="small" variant="outlined" label={t.members.deletedBadge} data-testid="member-deleted-badge" />
                      ) : (
                        member.displayName ?? '—'
                      )}
                    </TableCell>
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
                        {member.deletedAt === null ? (
                          <Button
                            size="small"
                            color="error"
                            disabled={removeMember.isPending}
                            onClick={() => setRemoving(member)}
                          >
                            {t.members.remove}
                          </Button>
                        ) : null}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              </Table>
            </TableContainer>
          </ResponsiveTable>
        )}
      </ListSection>
      {exportError !== null ? <Alert>{exportError}</Alert> : null}
      {failedSubscriptionIds.length > 0 ? (
        <Alert severity="warning" data-testid="member-remove-cancellation-warning">
          {t.members.removeCancellationWarning({
            providerSubscriptionIds: failedSubscriptionIds.join(', '),
          })}
        </Alert>
      ) : null}
      {removeMember.isError ? <Alert>{errorMessage(removeMember.error, t)}</Alert> : null}
      <ConfirmDialog
        open={removing !== null}
        title={t.members.removeConfirmTitle}
        body={
          <>
            <Typography variant="body1">
              {t.members.removeConfirmIntro({ email: removing?.email ?? '' })}
            </Typography>
            {removalGrants.isPending || removalProgress.isPending ? (
              <StatusView state={{ kind: 'loading', label: t.common.loading }} />
            ) : removalGrants.isError || removalProgress.isError ? (
              <StatusView
                state={{
                  kind: 'error',
                  message: localizeError(removalGrants.error ?? removalProgress.error, t),
                  retry: {
                    label: t.common.reload,
                    onRetry: () => {
                      void removalGrants.refetch();
                      void removalProgress.refetch();
                    },
                  },
                }}
              />
            ) : (
              <Typography variant="body2" data-testid="member-remove-impact">
                {t.members.removeImpact({
                  grants: removalGrants.data?.grants.length ?? 0,
                  completedLessons:
                    removalProgress.data?.summary.courses.reduce(
                      (total, course) => total + course.completedLessonCount,
                      0,
                    ) ?? 0,
                })}
              </Typography>
            )}
            {removeMember.isError ? <Alert>{errorMessage(removeMember.error, t)}</Alert> : null}
          </>
        }
        confirmLabel={removeMember.isPending ? t.members.removing : t.members.remove}
        cancelLabel={t.common.cancel}
        pending={removeMember.isPending}
        confirmDisabled={!removalGrants.isSuccess || !removalProgress.isSuccess}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing !== null && removalGrants.isSuccess && removalProgress.isSuccess) {
            removeMember.mutate({ memberId: removing.id });
          }
        }}
        data-testid="member-remove-dialog"
      />
    </PanelPage>
  );
};
