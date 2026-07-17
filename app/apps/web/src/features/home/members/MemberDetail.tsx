import { useState, type FormEvent } from 'react';
import {
  Box,
  Button,
  Chip,
  FormControl,
  FormLabel,
  LinearProgress,
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

import type {
  GrantSource,
  MemberCourseLearningSummary,
  MemberGrant,
  MemberWithProductIds,
} from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, StatusView } from '../../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDate, formatRelativeTime } from '../../../lib/format.js';
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
            inputProps={{ 'aria-label': t.members.productLabel }}
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
            inputProps={{ 'aria-label': t.members.expiresOptional }}
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

const completionPercent = (completed: number, total: number): number =>
  total === 0 ? 0 : Math.round((completed / total) * 100);

const ActivityTime = ({ value }: { value: string }) => {
  const { language } = useLanguage();
  return (
    <EntryDate component="time" dateTime={value}>
      {formatRelativeTime(value, language)}
    </EntryDate>
  );
};

const LearningSummary = ({ memberId }: { memberId: string }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const summary = useQuery(actions.memberLearningSummary(memberId));
  const [resetting, setResetting] = useState<MemberCourseLearningSummary | null>(null);

  const reset = useMutation({
    ...actions.resetMemberProgress,
    onSuccess: async () => {
      setResetting(null);
      await queryClient.invalidateQueries(actions.memberLearningSummaryInvalidates(memberId));
    },
  });

  return (
    <Box component="section">
      <Typography variant="h2" component="h3" sx={{ mb: '1rem' }}>
        {t.members.learningHeading}
      </Typography>
      {summary.isPending ? (
        <StatusView state={{ kind: 'loading', label: t.members.loadingLearning }} />
      ) : summary.isError ? (
        <StatusView state={{ kind: 'error', message: localizeError(summary.error, t) }} />
      ) : (
        <Stack useFlexGap spacing="1rem">
          <Typography variant="body2">
            {t.members.lastActivity}:{' '}
            {summary.data.summary.lastActivityAt === null ? (
              t.members.noActivity
            ) : (
              <ActivityTime value={summary.data.summary.lastActivityAt} />
            )}
          </Typography>
          {summary.data.summary.courses.length === 0 ? (
            <StatusView state={{ kind: 'empty', title: t.members.noAccessibleCourses }} />
          ) : (
            <TableContainer>
              <Table size="small" aria-label={t.members.learningHeading}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t.members.colCourse}</TableCell>
                    <TableCell>{t.members.colProgress}</TableCell>
                    <TableCell>{t.members.colLatestCompleted}</TableCell>
                    <TableCell>{t.members.colCourseActivity}</TableCell>
                    <TableCell align="right">{t.members.colActions}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.data.summary.courses.map((course) => {
                    const percent = completionPercent(
                      course.completedLessonCount,
                      course.accessibleLessonCount,
                    );
                    return (
                      <TableRow key={course.courseId} data-testid="learning-summary-row">
                        <TableCell>{course.courseName}</TableCell>
                        <TableCell>
                          <Stack useFlexGap spacing="0.35rem" sx={{ minWidth: '9rem' }}>
                            <Typography variant="body2">
                              {t.members.lessonsProgress({
                                completed: course.completedLessonCount,
                                total: course.accessibleLessonCount,
                              })}{' '}
                              · {percent}%
                            </Typography>
                            <LinearProgress variant="determinate" value={percent} />
                          </Stack>
                        </TableCell>
                        <TableCell>
                          {course.latestCompletedLesson === null
                            ? t.members.noLessonCompleted
                            : course.latestCompletedLesson.name}
                        </TableCell>
                        <TableCell>
                          {course.lastActivityAt === null ? (
                            t.members.noActivity
                          ) : (
                            <ActivityTime value={course.lastActivityAt} />
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            variant="text"
                            color="error"
                            data-testid="reset-progress"
                            onClick={() => setResetting(course)}
                          >
                            {t.members.resetProgress}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {reset.isError ? <MutationError error={reset.error} /> : null}
        </Stack>
      )}

      <ConfirmDialog
        open={resetting !== null}
        title={t.members.resetProgressTitle}
        body={t.members.resetProgressConfirm({
          count: resetting?.completedLessonCount ?? 0,
          course: resetting?.courseName ?? '',
        })}
        confirmLabel={reset.isPending ? t.members.resettingProgress : t.members.resetProgress}
        cancelLabel={t.common.cancel}
        pending={reset.isPending}
        onClose={() => setResetting(null)}
        onConfirm={() => {
          if (resetting) reset.mutate({ memberId, courseId: resetting.courseId });
        }}
        confirmTestId="reset-progress-confirm"
      />
    </Box>
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
        inputProps={{ 'aria-label': t.members.renewExpiryLabel }}
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

      <LearningSummary memberId={member.id} />

      <GrantForm memberId={member.id} onGranted={refresh} />

      <Box component="section">
        <Typography variant="h2" component="h3" sx={{ mb: '1rem' }}>
          {t.members.grantedProducts}
        </Typography>
        {grants.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.members.loadingGrants }} />
        ) : grants.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(grants.error, t) }} />
        ) : grants.data.grants.length === 0 ? (
          <StatusView state={{ kind: 'empty', title: t.members.noGrants }} />
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

      <ConfirmDialog
        open={revoking !== null}
        title={t.members.revokeAccess}
        body={t.members.revokeConfirm({ product: revoking?.productName ?? '', email: member.email })}
        confirmLabel={revoke.isPending ? t.members.revoking : t.members.revoke}
        cancelLabel={t.common.cancel}
        pending={revoke.isPending}
        onClose={() => setRevoking(null)}
        onConfirm={() => {
          if (revoking) revoke.mutate({ grantId: revoking.id });
        }}
      />
    </Stack>
  );
};
