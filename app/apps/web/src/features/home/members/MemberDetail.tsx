import { useState, type FormEvent } from 'react';
import {
  Box,
  Button,
  Chip,
  FormControl,
  FormLabel,
  LinearProgress,
  Link as MuiLink,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import type {
  GrantSource,
  MemberCourseLearningSummary,
  MemberTimelineEvent,
  MemberGrant,
  MemberWithProductIds,
} from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizePanelError, useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDate, formatDateTime, formatPrice, formatRelativeTime } from '../../../lib/format.js';
import { EntryDate } from '../../../theme.js';
import { MutationError } from '../courses/feedback.js';
import { EmailSendSummary } from '../marketing/EmailSendSummary.js';
import { MessageMemberButton } from './MessageMemberButton.js';
import { PanelBackLink } from '../PanelBackLink.js';

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
    <SectionCard title={t.members.grantProduct} onSubmit={submit}>
      {products.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizePanelError(products.error, t), retry: { label: t.common.retry, onRetry: () => void products.refetch() } }} /> : null}
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
    </SectionCard>
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

const AccountSummary = ({ member }: { member: MemberWithProductIds }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  return (
    <SectionCard title={t.members.accountHeading}>
      <Stack useFlexGap spacing="0.4rem">
        <Typography variant="body2">
          {t.members.accountName}: {member.displayName ?? '—'}
        </Typography>
        <Typography variant="body2">{t.members.accountEmail}: {member.email}</Typography>
        <Typography variant="body2">
          {t.members.joined}:{' '}
          <EntryDate component="time" dateTime={member.createdAt}>
            {formatDate(member.createdAt, language)}
          </EntryDate>
        </Typography>
        {member.deletedAt === null ? <MessageMemberButton memberId={member.id} /> : null}
      </Stack>
    </SectionCard>
  );
};

const CommerceSummary = ({ memberId }: { memberId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const commerce = useQuery(actions.memberCommerce(memberId));
  if (commerce.isPending) {
    return <StatusView state={{ kind: 'loading', label: t.members.commerceLoading }} />;
  }
  if (commerce.isError) {
    return <StatusView state={{ kind: 'error', message: localizePanelError(commerce.error, t), retry: { label: t.common.retry, onRetry: () => void commerce.refetch() } }} />;
  }

  return (
    <Stack direction={{ xs: 'column', lg: 'row' }} useFlexGap spacing="1rem">
      <Box component="section" sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="h2" component="h2" sx={{ mb: '1rem' }}>
          {t.members.purchasesHeading}
        </Typography>
        {commerce.data.purchases.length === 0 ? (
          <StatusView state={{ kind: 'empty', title: t.members.purchasesEmpty }} />
        ) : (
          <TableContainer>
            <Table size="small" aria-label={t.members.purchasesHeading}>
              <TableHead>
                <TableRow>
                  <TableCell>{t.sales.date}</TableCell>
                  <TableCell>{t.sales.product}</TableCell>
                  <TableCell>{t.sales.amount}</TableCell>
                  <TableCell>{t.sales.status}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {commerce.data.purchases.map((purchase) => (
                  <TableRow key={purchase.id} data-testid="member-purchase-row">
                    <TableCell>
                      <MuiLink
                        component={Link}
                        to={`/panel/sales/${purchase.id}`}
                      >
                        {formatDateTime(purchase.createdAt, language)}
                      </MuiLink>
                    </TableCell>
                    <TableCell>{purchase.productTitle}</TableCell>
                    <TableCell>{formatPrice(purchase.amountCents, purchase.currency, language)}</TableCell>
                    <TableCell>{t.sales[purchase.status]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      <Box component="section" sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="h2" component="h2" sx={{ mb: '1rem' }}>
          {t.members.subscriptionsHeading}
        </Typography>
        {commerce.data.activeSubscriptions.length === 0 ? (
          <StatusView state={{ kind: 'empty', title: t.members.subscriptionsEmpty }} />
        ) : (
          <TableContainer>
            <Table size="small" aria-label={t.members.subscriptionsHeading}>
              <TableHead>
                <TableRow>
                  <TableCell>{t.sales.product}</TableCell>
                  <TableCell>{t.sales.status}</TableCell>
                  <TableCell>{t.members.subscriptionProvider}</TableCell>
                  <TableCell>{t.members.subscriptionPeriodEnd}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {commerce.data.activeSubscriptions.map((subscription) => (
                  <TableRow key={subscription.id} data-testid="member-subscription-row">
                    <TableCell>{subscription.productTitle}</TableCell>
                    <TableCell>
                      <Stack useFlexGap spacing="0.25rem">
                        <Chip
                          size="small"
                          color={subscription.status === 'active' ? 'success' : 'warning'}
                          label={t.members.subscriptionStatuses[subscription.status]}
                          sx={{ alignSelf: 'flex-start' }}
                        />
                        {subscription.cancelAtPeriodEnd ? (
                          <Typography variant="caption">{t.members.subscriptionWillCancel}</Typography>
                        ) : null}
                      </Stack>
                    </TableCell>
                    <TableCell>{t.members.providerLabels[subscription.provider]}</TableCell>
                    <TableCell>{formatDate(subscription.currentPeriodEnd, language)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
    </Stack>
  );
};

const timelineDetails = (event: MemberTimelineEvent, t: Messages, language: 'pl' | 'en'): string => {
  const product = 'productTitle' in event.payload
    ? event.payload.productTitle ?? t.members.timelineUnavailableProduct
    : t.members.timelineUnavailableProduct;
  switch (event.type) {
    case 'purchase':
      return t.members.timelinePurchase({
        product,
        amount: formatPrice(event.payload.amountCents, event.payload.currency, language),
        status: t.sales[event.payload.status],
      });
    case 'subscription-change':
      return t.members.timelineSubscription({
        product,
        status: t.members.subscriptionStatuses[event.payload.status],
        date: formatDate(event.payload.currentPeriodEnd, language),
      });
    case 'grant':
      return t.members.timelineGrant({ product, date: formatDate(event.payload.startsAt, language) });
    case 'revoke':
      return t.members.timelineRevoke({ product, date: formatDate(event.payload.expiresAt, language) });
    case 'lesson-completion':
      return t.members.timelineLesson({
        course: event.payload.courseTitle ?? t.members.timelineUnavailableCourse,
        lesson: event.payload.lessonTitle ?? t.members.timelineUnavailableLesson,
      });
    case 'email-sent':
      return t.members.timelineEmail({ subject: event.payload.subject });
    case 'banned':
      return t.members.timelineBan({ reason: event.payload.reason ?? '—' });
    case 'unbanned':
      return t.members.timelineUnban;
  }
};

const MemberTimeline = ({ memberId }: { memberId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const timeline = useQuery(actions.memberTimeline(memberId));

  return (
    <Box component="section">
      <Typography variant="h2" component="h2" sx={{ mb: '1rem' }}>
        {t.members.timelineHeading}
      </Typography>
      {timeline.isPending ? (
        <StatusView state={{ kind: 'loading', label: t.members.timelineLoading }} />
      ) : timeline.isError ? (
        <StatusView state={{ kind: 'error', message: localizePanelError(timeline.error, t), retry: { label: t.common.retry, onRetry: () => void timeline.refetch() } }} />
      ) : timeline.data.events.length === 0 ? (
        <StatusView state={{ kind: 'empty', title: t.members.timelineEmpty }} />
      ) : (
        <TableContainer>
          <Table size="small" aria-label={t.members.timelineHeading}>
            <TableBody>
              {timeline.data.events.map((event) => (
                <TableRow key={event.id} data-testid="member-timeline-row">
                  <TableCell>
                    <EntryDate component="time" dateTime={event.occurredAt}>
                      {formatDateTime(event.occurredAt, language)}
                    </EntryDate>
                  </TableCell>
                  <TableCell>{t.members.timelineEventLabels[event.type]}</TableCell>
                  <TableCell>{timelineDetails(event, t, language)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
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
      <Typography variant="h2" component="h2" sx={{ mb: '0.35rem' }}>
        {t.members.learningHeading}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: '1rem' }}>
        {t.members.learningScopeHint}
      </Typography>
      {summary.isPending ? (
        <StatusView state={{ kind: 'loading', label: t.members.loadingLearning }} />
      ) : summary.isError ? (
        <StatusView state={{ kind: 'error', message: localizePanelError(summary.error, t), retry: { label: t.common.retry, onRetry: () => void summary.refetch() } }} />
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
                            <LinearProgress
                              variant="determinate"
                              value={percent}
                              aria-label={`${course.courseName} — ${percent}%`}
                            />
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
      {renew.isError ? <MutationError error={renew.error} /> : null}
    </Stack>
  );
};

export const MemberDetail = ({ member, onBack }: { member: MemberWithProductIds; onBack: () => void }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const grants = useQuery(actions.memberGrants(member.id));
  const [tab, setTab] = useState<'overview' | 'emails'>('overview');
  const emails = useQuery({
    ...actions.memberEmailSends(member.id),
    enabled: tab === 'emails',
  });
  const [revoking, setRevoking] = useState<MemberGrant | null>(null);
  const [banReason, setBanReason] = useState('');
  const [confirmingBan, setConfirmingBan] = useState(false);

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
  const setBanned = useMutation({
    ...actions.setMemberBanned,
    onSuccess: async () => {
      setConfirmingBan(false);
      setBanReason('');
      await queryClient.invalidateQueries(actions.membersInvalidates());
    },
  });

  return (
    <PanelPage
      title={member.email}
      backTo={<PanelBackLink
        to="/panel/members"
        onClick={(event) => {
          event.preventDefault();
          onBack();
        }}
      >{t.members.allMembersBack}</PanelBackLink>}
    >
      <Tabs
        value={tab}
        onChange={(_event, value: string) => setTab(value === 'emails' ? 'emails' : 'overview')}
        aria-label={t.members.heading}
      >
        <Tab value="overview" label={t.members.overviewTab} />
        <Tab value="emails" label={t.members.emailsTab} />
      </Tabs>

      {tab === 'emails' ? (
        <Box component="section">
          <Typography variant="h2" component="h2" sx={{ mb: '1rem' }}>
            {t.members.emailsTab}
          </Typography>
          {emails.isPending ? (
            <StatusView state={{ kind: 'loading', label: t.members.emailsLoading }} />
          ) : emails.isError ? (
            <StatusView state={{ kind: 'error', message: localizePanelError(emails.error, t), retry: { label: t.common.retry, onRetry: () => void emails.refetch() } }} />
          ) : emails.data.sends.length === 0 ? (
            <StatusView state={{ kind: 'empty', title: t.members.emailsEmpty }} />
          ) : (
            <Stack useFlexGap spacing="1rem">
              {emails.data.sends.map((send) => (
                <EmailSendSummary key={`${send.kind}:${send.id}`} send={send} />
              ))}
            </Stack>
          )}
        </Box>
      ) : (
        <>
          <AccountSummary member={member} />
          <CommerceSummary memberId={member.id} />
          <MemberTimeline memberId={member.id} />
          {member.deletedAt === null ? (
            <SectionCard title={t.members.moderationHeading}>
              <Stack useFlexGap spacing="0.75rem">
                <Typography variant="body2" color="text.secondary">{t.members.banVsRemoval}</Typography>
                {member.bannedAt === null ? null : (
                  <>
                    <Chip
                      color="warning"
                      label={t.members.bannedSince({ date: formatDate(member.bannedAt, language) })}
                      sx={{ alignSelf: 'flex-start' }}
                    />
                    {member.bannedReason === null ? null : <Typography variant="body2">{member.bannedReason}</Typography>}
                  </>
                )}
                <Button
                  color={member.bannedAt === null ? 'error' : 'primary'}
                  variant="outlined"
                  sx={{ alignSelf: 'flex-start' }}
                  onClick={() => setConfirmingBan(true)}
                >
                  {member.bannedAt === null ? t.members.ban : t.members.unban}
                </Button>
                {setBanned.isError ? <MutationError error={setBanned.error} /> : null}
              </Stack>
            </SectionCard>
          ) : null}
          <LearningSummary memberId={member.id} />

          {member.deletedAt === null ? (
            <GrantForm memberId={member.id} onGranted={refresh} />
          ) : (
            <StatusView
              state={{ kind: 'empty', title: t.members.tombstoneNotice }}
              data-testid="member-tombstone-notice"
            />
          )}

          <Box component="section">
            <Typography variant="h2" component="h2" sx={{ mb: '1rem' }}>
              {t.members.grantedProducts}
            </Typography>
            {grants.isPending ? (
              <StatusView state={{ kind: 'loading', label: t.members.loadingGrants }} />
            ) : grants.isError ? (
              <StatusView state={{ kind: 'error', message: localizePanelError(grants.error, t), retry: { label: t.common.retry, onRetry: () => void grants.refetch() } }} />
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
                          {grant.expiresAt === null
                            ? t.members.perpetual
                            : formatDate(grant.expiresAt, language)}
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
                          <Stack
                            direction="row"
                            useFlexGap
                            spacing="0.4rem"
                            sx={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}
                          >
                            {member.deletedAt === null ? (
                              <RenewControl grant={grant} memberId={member.id} onRenewed={refresh} />
                            ) : null}
                            <Button
                              size="small"
                              variant="text"
                              color="error"
                              onClick={() => setRevoking(grant)}
                            >
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
          <ConfirmDialog
            open={confirmingBan}
            title={member.bannedAt === null ? t.members.ban : t.members.unban}
            body={member.bannedAt === null ? (
              <Stack useFlexGap spacing="0.75rem">
                <Typography variant="body2">{t.members.banConfirm({ email: member.email })}</Typography>
                <FormControl size="small">
                  <FormLabel htmlFor="member-ban-reason">{t.members.banReasonLabel}</FormLabel>
                  <OutlinedInput
                    id="member-ban-reason"
                    value={banReason}
                    onChange={(event) => setBanReason(event.target.value)}
                    inputProps={{ maxLength: 500 }}
                  />
                </FormControl>
              </Stack>
            ) : t.members.unbanConfirm({ email: member.email })}
            confirmLabel={member.bannedAt === null ? t.members.ban : t.members.unban}
            cancelLabel={t.common.cancel}
            pending={setBanned.isPending}
            onClose={() => setConfirmingBan(false)}
            onConfirm={() => setBanned.mutate({
              memberId: member.id,
              banned: member.bannedAt === null,
              ...(member.bannedAt === null && banReason.trim() !== '' ? { reason: banReason } : {}),
            })}
          />
        </>
      )}
    </PanelPage>
  );
};
