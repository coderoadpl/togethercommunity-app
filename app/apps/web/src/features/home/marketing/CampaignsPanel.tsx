import { CampaignAudienceSection } from './CampaignAudienceSection.js';
import type { ContactCampaignAudience } from '#core/domain/index.js';
import type { marketingCampaignDetailOutputSchema } from '#core/contract/index.js';
import { CampaignTextSection } from './CampaignTextSection.js';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormHelperText,
  FormLabel,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from '@tanstack/react-router';

import type { Campaign, CampaignEngagementStats } from '#core/domain/index.js';
import type { z } from 'zod';

import { actions } from '../../../api.js';
import { ConfirmDialog, ListSection, PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { ChevronDownIcon } from '../../../components/ui/account-icons.js';
import { MarkdownEditor, type MarkdownEditorHandle } from '../../../components/ui/MarkdownEditor.js';
import { localizePanelError, useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { PanelBackLink } from '../PanelBackLink.js';
import { useUnsavedChanges } from '../use-unsaved-changes.js';
import { StatTile, StatTileLabel, StatTileValue } from '../../../theme.js';
import { CampaignStatusChip, MarketingSummaryRow } from './MarketingSummaryRow.js';
import { formatSchedulerDateTime, formatSchedulerDuration } from './SchedulerActivityPanel.js';
import {
  prepareCampaignHtml,
  renderCampaignPreview,
} from './marketing-markdown.js';

type CampaignDetailRow = z.infer<typeof marketingCampaignDetailOutputSchema>['campaign'];
type CampaignProgress = Pick<CampaignDetailRow, 'candidateCount' | 'queued' | 'skipped' | 'unresolved' | 'results'>;

const localTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

const formatDateTimeWithTimeZone = (value: string, language: string): string =>
  `${formatDateTime(value, language)} (${localTimeZone()})`;

const campaignCandidateCount = (campaign: Pick<CampaignDetailRow, 'candidateCount' | 'results'>): number =>
  campaign.candidateCount === 0 ? campaign.results.candidates : campaign.candidateCount;

const campaignEditable = (campaign: Pick<CampaignDetailRow, 'audienceVersion' | 'status'>): boolean =>
  campaign.status === 'draft' || (campaign.audienceVersion === 1 && campaign.status === 'scheduled');

const campaignAudienceProgress = (campaign: CampaignProgress, t: Messages): string =>
  t.marketing.campaignProgress({ ...campaign.results, candidates: campaignCandidateCount(campaign) });

const campaignEditorProgress = (campaign: CampaignProgress, t: Messages): string =>
  t.marketing.contactProgress({
    candidates: campaign.candidateCount,
    skipped: campaign.skipped,
    queued: campaign.queued,
    unresolved: campaign.unresolved,
  });

const campaignListDate = (campaign: Pick<Campaign, 'sendAt' | 'createdAt'>, language: string, t: Messages): string =>
  campaign.sendAt === null
    ? t.marketing.createdTimeValue({ date: formatDateTime(campaign.createdAt, language) })
    : t.marketing.scheduledTimeValue({ date: formatDateTime(campaign.sendAt, language) });

const engagementHasCounts = (engagement: CampaignEngagementStats): boolean =>
  engagement.uniqueOpens > 0 || engagement.totalOpens > 0 || engagement.uniqueClicks > 0 || engagement.totalClicks > 0;

const shouldMaskEngagement = (engagement: CampaignEngagementStats, trackingDisabled: boolean): boolean =>
  trackingDisabled && !engagementHasCounts(engagement);

const compactEngagement = (engagement: CampaignEngagementStats, masked: boolean, t: Messages): ReactNode => (
  <>
    <span>{masked ? t.marketing.compactOpensUnavailable : t.marketing.compactOpens({ unique: engagement.uniqueOpens, total: engagement.totalOpens })}</span>
    <span>{masked ? t.marketing.compactClicksUnavailable : t.marketing.compactClicks({ unique: engagement.uniqueClicks, total: engagement.totalClicks })}</span>
  </>
);

const CampaignEngagementTiles = ({
  engagement,
  masked,
}: {
  engagement: CampaignEngagementStats;
  masked: boolean;
}) => {
  const t = useTranslations();
  const items = [
    { label: t.marketing.uniqueOpens, value: masked ? '—' : String(engagement.uniqueOpens) },
    { label: t.marketing.totalOpens, value: masked ? '—' : String(engagement.totalOpens) },
    { label: t.marketing.uniqueClicks, value: masked ? '—' : String(engagement.uniqueClicks) },
    { label: t.marketing.totalClicks, value: masked ? '—' : String(engagement.totalClicks) },
  ];
  return (
    <Box
      data-testid="campaign-engagement-stats"
      sx={{
        display: 'grid',
        gap: '0.9rem',
        gridTemplateColumns: { xs: '1fr 1fr', lg: 'repeat(4, 1fr)' },
      }}
    >
      {items.map((item) => (
        <StatTile key={item.label}>
          <Box sx={{ minWidth: 0 }}>
            <StatTileValue component="p">{item.value}</StatTileValue>
            <StatTileLabel component="p">{item.label}</StatTileLabel>
          </Box>
        </StatTile>
      ))}
    </Box>
  );
};

const CampaignResultTiles = ({ campaign }: { campaign: CampaignDetailRow }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const percentage = (count: number): string => campaign.results.sent === 0
    ? '0%'
    : `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(count / campaign.results.sent * 100)}%`;
  const items = [
    { label: t.marketing.resultsDelivered, value: campaign.results.delivered, percentage: percentage(campaign.results.delivered) },
    { label: t.marketing.resultsBounced, value: campaign.results.bounced, percentage: percentage(campaign.results.bounced) },
    { label: t.marketing.resultsComplained, value: campaign.results.complained, percentage: percentage(campaign.results.complained) },
    { label: t.marketing.resultsFailed, value: campaign.results.failed },
    { label: t.marketing.resultsWaiting, value: campaign.results.waiting },
  ];
  return (
    <Box data-testid="campaign-result-stats" sx={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(5, minmax(0, 1fr))' } }}>
      {items.map((item) => (
        <StatTile key={item.label}>
          <Box sx={{ minWidth: 0 }}>
            <StatTileValue component="p">{item.value}</StatTileValue>
            <StatTileLabel component="p">{item.label}</StatTileLabel>
            {'percentage' in item ? <Typography variant="caption" color="text.secondary">{t.marketing.percentageOfSent({ percentage: item.percentage })}</Typography> : null}
          </Box>
        </StatTile>
      ))}
    </Box>
  );
};

const CampaignForm = ({ campaign }: { campaign?: CampaignDetailRow | undefined }) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const consents = useQuery(actions.marketingConsents);
  const products = useQuery(actions.products);
  const layouts = useQuery(actions.marketingLayouts);
  const [name, setName] = useState(campaign?.name ?? '');
  const [subject, setSubject] = useState(campaign?.subject ?? '');
  const [bodyText, setBodyText] = useState(campaign?.bodyText ?? '');
  const [replyTo, setReplyTo] = useState(campaign?.replyTo ?? '');
  const [bodySource, setBodySource] = useState(campaign?.bodySource ?? '');
  const [bodyMode, setBodyMode] = useState<'markdown' | 'html'>(
    campaign !== undefined && campaign.bodySource === campaign.bodyHtml ? 'html' : 'markdown',
  );
  const [bodyAttempted, setBodyAttempted] = useState(false);
  const bodyRef = useRef<MarkdownEditorHandle>(null);
  const [consentDefinitionId, setConsentDefinitionId] = useState(campaign?.consentDefinitionId ?? '');
  const [audience, setAudience] = useState<ContactCampaignAudience | null>(campaign === undefined ? { version: 2, includeLists: [], excludeLists: [], excludeProductIds: [], includeMembersWithConsent: false } : campaign.audience);
  const [productIds, setProductIds] = useState<string[]>(campaign?.audienceFilter?.productIds ?? []);
  const [layoutId, setLayoutId] = useState(campaign?.layoutId ?? '');
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify([
    campaign?.name ?? '',
    campaign?.subject ?? '',
    campaign?.bodyText ?? '',
    campaign?.replyTo ?? '',
    campaign?.bodySource ?? '',
    campaign !== undefined && campaign.bodySource === campaign.bodyHtml ? 'html' : 'markdown',
    campaign?.consentDefinitionId ?? '',
    campaign?.audienceFilter?.productIds ?? [],
    campaign?.layoutId ?? '',
    campaign === undefined ? { version: 2, includeLists: [], excludeLists: [], excludeProductIds: [], includeMembersWithConsent: false } : campaign.audience,
  ]));

  const activeDefinitions = (consents.data?.definitions ?? []).filter((definition) =>
    definition.status === 'active' && definition.kind === 'optional_marketing'
  );
  const effectiveConsentId = consentDefinitionId || activeDefinitions[0]?.id || '';
  const editable = campaign === undefined || campaignEditable(campaign);
  const currentSnapshot = JSON.stringify([name, subject, bodyText, replyTo, bodySource, bodyMode, consentDefinitionId, productIds, layoutId, audience]);
  const dirty = editable && currentSnapshot !== savedSnapshot;
  const allowNavigation = useUnsavedChanges(dirty, t.common.unsavedChangesConfirm);

  const preview = useMutation(actions.previewMarketingAudience);
  const previewAudience = preview.mutate;

  useEffect(() => {
    if (audience === null && editable && effectiveConsentId !== '') previewAudience({ consentDefinitionId: effectiveConsentId, productIds });
  }, [audience, editable, effectiveConsentId, previewAudience, productIds]);

  const create = useMutation({
    ...actions.createMarketingCampaign,
    onSuccess: async ({ campaign: saved }) => {
      allowNavigation();
      await queryClient.invalidateQueries(actions.marketingInvalidates());
      await navigate({ to: '/panel/marketing/campaigns/$campaignId', params: { campaignId: saved.id } });
    },
  });
  const update = useMutation({
    ...actions.updateMarketingCampaign,
    onSuccess: async () => {
      setSavedSnapshot(currentSnapshot);
      await queryClient.invalidateQueries(actions.marketingInvalidates());
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBodyAttempted(true);
    if (bodySource.trim() === '') {
      bodyRef.current?.focus();
      return;
    }
    const bodyHtml = prepareCampaignHtml(bodySource, bodyMode);
    const input = {
      name,
      subject,
      bodyHtml,
      bodySource,
      bodyText: bodyText === '' ? null : bodyText,
      replyTo: replyTo === '' ? null : replyTo,
      consentDefinitionId: effectiveConsentId,
      productIds,
      ...(audience === null ? {} : { audience }),
      layoutId: layoutId === '' ? null : layoutId,
    };
    if (campaign === undefined) create.mutate(input);
    else update.mutate({ ...input, campaignId: campaign.id });
  };
  const pending = create.isPending || update.isPending;

  return (
    <SectionCard
      title={t.marketing.campaignDetails}
      description={editable ? undefined : t.marketing.lockedHint}
      onSubmit={submit}
      actions={
        editable ? (
          <Button type="submit" variant="contained" disabled={pending || effectiveConsentId === ''}>
            {pending ? t.marketing.saving : campaign === undefined ? t.marketing.create : t.marketing.save}
          </Button>
        ) : undefined
      }
    >
      <FormControl fullWidth>
        <FormLabel htmlFor="marketing-campaign-name">{t.marketing.nameLabel}</FormLabel>
        <OutlinedInput id="marketing-campaign-name" value={name} onChange={(event) => setName(event.target.value)} disabled={!editable} required />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="marketing-campaign-subject">{t.marketing.subjectLabel}</FormLabel>
        <OutlinedInput id="marketing-campaign-subject" value={subject} onChange={(event) => setSubject(event.target.value)} disabled={!editable} required />
      </FormControl>
      <CampaignTextSection bodyText={bodyText} replyTo={replyTo} disabled={!editable} onBodyTextChange={setBodyText} onReplyToChange={setReplyTo} />
      <Stack useFlexGap spacing="0.75rem">
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          useFlexGap
          spacing="0.75rem"
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          {bodyMode === 'html'
            ? <FormLabel htmlFor="marketing-campaign-body">{t.marketing.bodyLabel}</FormLabel>
            : <FormLabel component="span">{t.marketing.bodyLabel}</FormLabel>}
          <ToggleButtonGroup
            exclusive
            size="small"
            value={bodyMode}
            onChange={(_event, value: 'markdown' | 'html' | null) => {
              if (value !== null) setBodyMode(value);
            }}
            aria-label={t.marketing.editorMode}
            disabled={!editable}
          >
            <ToggleButton value="markdown">{t.marketing.markdownMode}</ToggleButton>
            <ToggleButton value="html">{t.marketing.rawHtmlMode}</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        {bodyMode === 'html' ? <Alert severity="warning">{t.marketing.rawHtmlHint}</Alert> : null}
        <Box sx={{ display: 'grid', gap: '1rem', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' } }}>
          {bodyMode === 'html' ? (
            <FormControl fullWidth>
              <OutlinedInput
                id="marketing-campaign-body"
                value={bodySource}
                onChange={(event) => setBodySource(event.target.value)}
                disabled={!editable}
                multiline
                minRows={12}
              />
            </FormControl>
          ) : (
            <MarkdownEditor
              ref={bodyRef}
              value={bodySource}
              onChange={setBodySource}
              placeholder={t.marketing.bodyPlaceholder}
              minRows={12}
              disabled={!editable}
              testId="marketing-campaign-body"
              aria-label={t.marketing.bodyLabel}
              aria-describedby="marketing-campaign-body-error"
            />
          )}
          <Paper
            aria-label={t.marketing.livePreview}
            variant="outlined"
            sx={{
              minHeight: '18rem',
              overflowWrap: 'anywhere',
              p: '1rem',
            }}
          >
            <Typography variant="overline" component="p">{t.marketing.livePreview}</Typography>
            <Box
              data-testid="campaign-body-preview"
              dangerouslySetInnerHTML={{
                __html: renderCampaignPreview(bodySource, bodyMode),
              }}
            />
          </Paper>
        </Box>
        {bodyAttempted && bodySource.trim() === '' ? <FormHelperText id="marketing-campaign-body-error" error>{t.marketing.bodyRequired}</FormHelperText> : null}
      </Stack>
      <FormControl fullWidth>
        <FormLabel id="marketing-campaign-consent-label">{t.marketing.consentScopeLabel}</FormLabel>
        <Select
          labelId="marketing-campaign-consent-label"
          value={effectiveConsentId}
          disabled={!editable || consents.isPending}
          onChange={(event) => {
            const value = event.target.value;
            setConsentDefinitionId(value);
            if (audience === null) previewAudience({ consentDefinitionId: value, productIds });
          }}
          required
        >
          {activeDefinitions.map((definition) => <MenuItem key={definition.id} value={definition.id}>{definition.key}</MenuItem>)}
        </Select>
      </FormControl>
      {audience !== null ? <>
      <CampaignAudienceSection
        audience={audience}
        consentDefinitionId={effectiveConsentId}
        disabled={!editable}
        frozen={campaign?.audienceSnapshotId != null}
        progress={campaign?.audienceVersion === 2 ? <Typography variant="body2">{campaignEditorProgress(campaign, t)}</Typography> : undefined}
        onChange={setAudience}
      />
      </> : <>
      <FormControl fullWidth>
        <FormLabel id="marketing-campaign-products-label">{t.marketing.productFilterLabel}</FormLabel>
        <Select
          multiple
          labelId="marketing-campaign-products-label"
          value={productIds}
          disabled={!editable || products.isPending}
          onChange={(event) => {
            const value = typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value;
            setProductIds(value);
            previewAudience({ consentDefinitionId: effectiveConsentId, productIds: value });
          }}
          renderValue={(selected) => selected.length === 0
            ? t.marketing.allProducts
            : selected.map((id) => products.data?.products.find((product) => product.id === id)?.title ?? id).join(', ')}
        >
          {(products.data?.products ?? []).map((product) => <MenuItem key={product.id} value={product.id}>{product.title}</MenuItem>)}
        </Select>
        <FormHelperText>
          {preview.isPending
            ? t.marketing.audiencePreview
            : preview.isSuccess
              ? t.marketing.audienceCount({ count: preview.data.count })
              : t.marketing.allProducts}
        </FormHelperText>
        {editable ? (
          <Button
            variant="text"
            disabled={effectiveConsentId === '' || preview.isPending}
            onClick={() => previewAudience({ consentDefinitionId: effectiveConsentId, productIds })}
          >
            {t.marketing.audiencePreview}
          </Button>
        ) : null}
      </FormControl>
      {campaign?.status === 'draft' ? <Button onClick={() => setAudience({ version: 2, includeLists: [], excludeLists: [], excludeProductIds: [], includeMembersWithConsent: false })}>{t.marketing.switchToLists}</Button> : null}
      </>}
      <FormControl fullWidth>
        <FormLabel id="marketing-campaign-layout-label">{t.marketing.layoutLabel}</FormLabel>
        <Select<string>
          labelId="marketing-campaign-layout-label"
          value={layoutId}
          disabled={!editable || layouts.isPending}
          displayEmpty
          onChange={(event) => setLayoutId(event.target.value)}
          renderValue={(selected) => selected === ''
            ? t.marketing.noLayout
            : layouts.data?.layouts.find((layout) => layout.id === selected)?.name ?? selected}
        >
          <MenuItem value="">{t.marketing.noLayout}</MenuItem>
          {(layouts.data?.layouts ?? []).map((layout) => <MenuItem key={layout.id} value={layout.id}>{layout.name}</MenuItem>)}
        </Select>
      </FormControl>
      {consents.isError || products.isError || layouts.isError ? (
        <StatusView
          surface={false}
          state={{
            kind: 'error',
            message: localizePanelError(consents.error ?? products.error ?? layouts.error, t),
            retry: {
              label: t.common.retry,
              onRetry: () => {
                void consents.refetch();
                void products.refetch();
                void layouts.refetch();
              },
            },
          }}
        />
      ) : null}
      {preview.isError ? <Alert severity="error">{localizePanelError(preview.error, t)}</Alert> : null}
      {create.isError || update.isError ? <Alert severity="error">{localizePanelError(create.error ?? update.error, t)}</Alert> : null}
      {dirty ? <Alert severity="warning">{t.common.unsavedChanges}</Alert> : null}
    </SectionCard>
  );
};

export const CampaignActions = ({ campaign }: { campaign: Campaign }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [sendAt, setSendAt] = useState('');
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const invalidate = async () => queryClient.invalidateQueries(actions.marketingInvalidates());
  const schedule = useMutation({ ...actions.scheduleMarketingCampaign, onSuccess: invalidate });
  const action = useMutation({
    ...actions.marketingCampaignAction,
    onSuccess: async (_data, variables) => {
      if (variables.action === 'cancel') setConfirmingCancel(false);
      await invalidate();
    },
  });
  const testSend = useMutation(actions.testMarketingCampaign);
  const terminal = campaign.status === 'cancelled' || campaign.status === 'finished';
  const cancellable = ['draft', 'scheduled', 'running', 'paused'].includes(campaign.status);

  return (
    <SectionCard
      title={t.marketing.scheduleCardTitle[campaign.status]}
      headerActions={cancellable ? <Button color="error" onClick={() => setConfirmingCancel(true)}>{t.marketing.cancelCampaign}</Button> : undefined}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem" sx={{ alignItems: { sm: 'center' } }}>
        <CampaignStatusChip status={campaign.status} label={t.marketing.status[campaign.status]} />
        {campaign.sendAt === null ? null : (
          <Typography variant="body2">{t.marketing.scheduledTimeValue({ date: formatDateTimeWithTimeZone(campaign.sendAt, language) })}</Typography>
        )}
      </Stack>
      {campaign.status === 'scheduled' ? <Alert severity="info">{t.marketing.workerPickupHint}</Alert> : null}
      {terminal ? (
        <Alert severity="info">
          {campaign.status === 'cancelled' ? t.marketing.cancelledCampaignHint : t.marketing.finishedCampaignHint}
        </Alert>
      ) : null}
      {campaign.status === 'draft' ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem">
          <FormControl fullWidth>
            <FormLabel htmlFor="marketing-send-at">{t.marketing.sendAtLabel}</FormLabel>
            <OutlinedInput id="marketing-send-at" type="datetime-local" value={sendAt} onChange={(event) => setSendAt(event.target.value)} required />
          </FormControl>
          <Button
            variant="contained"
            disabled={sendAt === '' || schedule.isPending}
            onClick={() => schedule.mutate({ campaignId: campaign.id, sendAt: new Date(sendAt).toISOString() })}
          >
            {schedule.isPending ? t.marketing.scheduling : t.marketing.schedule}
          </Button>
        </Stack>
      ) : null}
      <Stack direction="row" useFlexGap spacing="0.75rem" sx={{ flexWrap: 'wrap' }}>
        {campaign.status === 'scheduled' ? <Button disabled={action.isPending} onClick={() => action.mutate({ campaignId: campaign.id, action: 'draft' })}>{t.marketing.returnToDraft}</Button> : null}
        {campaign.status === 'running' ? <Button onClick={() => action.mutate({ campaignId: campaign.id, action: 'pause' })}>{t.marketing.pause}</Button> : null}
        {campaign.status === 'paused' ? <Button onClick={() => action.mutate({ campaignId: campaign.id, action: 'resume' })}>{t.marketing.resume}</Button> : null}
        {terminal ? null : (
          <Button disabled={testSend.isPending} onClick={() => testSend.mutate({ campaignId: campaign.id })}>
            {testSend.isPending ? t.marketing.testing : t.marketing.testSend}
          </Button>
        )}
      </Stack>
      {campaign.pausedReason === null ? null : <Alert severity="warning"><strong>{t.marketing.pausedReason}:</strong> {campaign.pausedReason}</Alert>}
      {schedule.isError || action.isError || testSend.isError ? <Alert severity="error">{localizePanelError(schedule.error ?? action.error ?? testSend.error, t)}</Alert> : null}
      <ConfirmDialog
        open={confirmingCancel}
        title={t.marketing.cancelCampaignConfirmTitle}
        body={(
          <>
            <Typography>{t.marketing.cancelCampaignConfirmBody}</Typography>
            {action.isError ? <Alert severity="error">{localizePanelError(action.error, t)}</Alert> : null}
          </>
        )}
        confirmLabel={t.marketing.cancelCampaign}
        cancelLabel={t.common.cancel}
        pending={action.isPending}
        onClose={() => setConfirmingCancel(false)}
        onConfirm={() => action.mutate({ campaignId: campaign.id, action: 'cancel' })}
        confirmTestId="campaign-cancel-confirm"
      />
    </SectionCard>
  );
};

export const CampaignsPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const campaigns = useQuery(actions.marketingCampaigns);
  const consents = useQuery(actions.marketingConsents);
  const reputation = useQuery(actions.marketingReputation);
  const settings = useQuery(actions.marketingSesSettings);
  const navigate = useNavigate();
  const trackingDisabled = settings.isSuccess && settings.data.settings?.trackingEnabled !== true;
  const showTrackingDisabledAlert = trackingDisabled && campaigns.isSuccess && campaigns.data.campaigns.some((campaign) => shouldMaskEngagement(campaign.engagement, true));

  return (
    <PanelPage title={t.marketing.campaignsTitle} description={t.marketing.campaignsDescription} action={<Button component={Link} to="/panel/marketing/campaigns/new" variant="contained">+ {t.common.add}</Button>}>
      {consents.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizePanelError(consents.error, t), retry: { label: t.common.retry, onRetry: () => void consents.refetch() } }} /> : null}
      {reputation.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizePanelError(reputation.error, t), retry: { label: t.common.retry, onRetry: () => void reputation.refetch() } }} /> : null}
      {reputation.data?.overallStatus === 'warn' ? (
        <Alert severity="warning">{t.marketing.campaignReputationWarnBanner}</Alert>
      ) : null}
      {reputation.data?.overallStatus === 'critical' ? (
        <Alert severity="error">{t.marketing.campaignReputationCriticalBanner}</Alert>
      ) : null}
      {showTrackingDisabledAlert ? <Alert severity="info">{t.marketing.trackingDisabledCampaignMetrics}</Alert> : null}
      <ListSection
        isEmpty={campaigns.isSuccess && campaigns.data.campaigns.length === 0}
        empty={<StatusView state={{ kind: 'empty', title: t.marketing.campaignsEmpty, action: <Button component={Link} to="/panel/marketing/campaigns/new">+ {t.common.add}</Button> }} />}
      >
        {campaigns.isPending ? <StatusView state={{ kind: 'loading', label: t.marketing.campaignsLoading }} /> : campaigns.isError ? (
          <StatusView state={{ kind: 'error', message: localizePanelError(campaigns.error, t), retry: { label: t.common.retry, onRetry: () => void campaigns.refetch() } }} />
        ) : (
          <Stack useFlexGap spacing="1rem">
            {campaigns.data.campaigns.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).map((campaign) => (
              <MarketingSummaryRow
                key={campaign.id}
                title={campaign.name}
                chips={<><CampaignStatusChip status={campaign.status} label={t.marketing.status[campaign.status]} /><Chip size="small" variant="outlined" label={consents.data?.definitions.find((definition) => definition.id === campaign.consentDefinitionId)?.key ?? campaign.consentDefinitionId} /></>}
                summary={(
                  <Box component="span" sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: '0.25rem', sm: '1rem' }, flexWrap: 'wrap' }}>
                    <span>{t.marketing.listSent({ sent: campaign.results.sent, candidates: campaignCandidateCount(campaign) })}</span>
                    <span>{t.marketing.compactResults(campaign.results)}</span>
                    {compactEngagement(campaign.engagement, shouldMaskEngagement(campaign.engagement, trackingDisabled), t)}
                  </Box>
                )}
                date={campaignListDate(campaign, language, t)}
                actions={<Button onClick={() => void navigate({ to: '/panel/marketing/campaigns/$campaignId', params: { campaignId: campaign.id } })}>{t.common.open}</Button>}
                testId="marketing-campaign-row"
              />
            ))}
          </Stack>
        )}
      </ListSection>
    </PanelPage>
  );
};

export const CampaignCreatePage = () => {
  const t = useTranslations();
  return <PanelPage title={t.marketing.newCampaign} backTo={<PanelBackLink to="/panel/marketing/campaigns">{t.marketing.allCampaigns}</PanelBackLink>}><CampaignForm /></PanelPage>;
};

const ReadOnlyChipGroup = ({ label, values, empty }: { label: string; values: string[]; empty: string }) => (
  <Stack useFlexGap spacing="0.4rem">
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ flexWrap: 'wrap' }}>
      {values.length === 0
        ? <Typography variant="body2">{empty}</Typography>
        : values.map((value) => <Chip key={value} size="small" variant="outlined" label={value} />)}
    </Stack>
  </Stack>
);

const CampaignReport = ({ campaign, trackingDisabled }: { campaign: CampaignDetailRow; trackingDisabled: boolean }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const consents = useQuery(actions.marketingConsents);
  const products = useQuery(actions.products);
  const layouts = useQuery(actions.marketingLayouts);
  const lists = useInfiniteQuery(actions.directory.listOptions(campaign.tenantId));
  const runs = useQuery(actions.schedulerRuns({ campaignId: campaign.id, limit: 100 }));
  const audience = campaign.audience;
  const consentKey = consents.data?.definitions.find((definition) => definition.id === campaign.consentDefinitionId)?.key ?? campaign.consentDefinitionId;
  const productTitles = (ids: string[]): string[] => ids.map((id) => products.data?.products.find((product) => product.id === id)?.title ?? id);
  const excludedProducts = productTitles(audience?.excludeProductIds ?? []);
  const filteredProducts = productTitles(audience === null ? campaign.audienceFilter?.productIds ?? [] : []);
  const listOptions = lists.data?.pages.flatMap((page) => page.lists) ?? [];
  const listLabels = (ids: string[]): string[] => ids.map((id) => {
    const list = listOptions.find((option) => option.id === id);
    return list === undefined ? id : `${list.name} (${list.key})`;
  });
  const layoutName = campaign.layoutId === null
    ? t.marketing.noLayout
    : layouts.data?.layouts.find((layout) => layout.id === campaign.layoutId)?.name ?? campaign.layoutId;
  const masked = shouldMaskEngagement(campaign.engagement, trackingDisabled);

  return (
    <>
      <Typography variant="body2" color="text.secondary">{campaignListDate(campaign, language, t)}</Typography>
      {masked ? <Alert severity="info">{t.marketing.trackingDisabledCampaignMetrics}</Alert> : null}
      <CampaignResultTiles campaign={campaign} />
      {campaign.unresolved > 0 ? <Alert severity="warning">{t.marketing.unresolvedAcceptance({ count: campaign.unresolved })}</Alert> : null}
      <CampaignEngagementTiles engagement={campaign.engagement} masked={masked} />
      <SectionCard title={t.marketing.reportAudienceTitle}>
        <Typography>{campaignAudienceProgress(campaign, t)}</Typography>
        <Box sx={{ display: 'grid', gap: '1rem', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
          <ReadOnlyChipGroup label={t.marketing.consentScopeLabel} values={[consentKey]} empty={t.marketing.noConsentDefinition} />
          <ReadOnlyChipGroup label={t.marketing.includeLists} values={listLabels(audience?.includeLists ?? [])} empty={t.marketing.noIncludedLists} />
          <ReadOnlyChipGroup label={t.marketing.excludeLists} values={listLabels(audience?.excludeLists ?? [])} empty={t.marketing.noExcludedLists} />
          <ReadOnlyChipGroup label={t.marketing.excludeProductGrants} values={excludedProducts} empty={t.marketing.noExcludedProducts} />
          {audience === null ? <ReadOnlyChipGroup label={t.marketing.productFilterLabel} values={filteredProducts} empty={t.marketing.allProducts} /> : null}
        </Box>
        {audience?.includeMembersWithConsent === true ? <Chip size="small" color="primary" label={t.marketing.consentedMembersChip} sx={{ alignSelf: 'flex-start' }} /> : null}
      </SectionCard>
      <SectionCard title={t.marketing.reportMessageTitle}>
        <Accordion disableGutters elevation={0} slotProps={{ transition: { unmountOnExit: true } }}>
          <AccordionSummary expandIcon={<ChevronDownIcon />} sx={{ px: 0 }}>
            <Stack useFlexGap spacing="0.25rem" sx={{ minWidth: 0 }}>
              <Typography component="p" variant="h3">{campaign.subject}</Typography>
              <Typography variant="body2" color="text.secondary">{t.marketing.expandMessage}</Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0 }}>
            <Stack useFlexGap spacing="1rem">
              <Typography variant="body2"><Box component="span" color="text.secondary">{t.marketing.replyToLabel}: </Box>{campaign.replyTo ?? '—'}</Typography>
              <Typography variant="body2"><Box component="span" color="text.secondary">{t.marketing.layoutLabel}: </Box>{layoutName}</Typography>
              <Paper variant="outlined" sx={{ p: '1rem', overflowWrap: 'anywhere' }}>
                <Box data-testid="campaign-report-body-preview" dangerouslySetInnerHTML={{ __html: renderCampaignPreview(campaign.bodyHtml, 'html') }} />
              </Paper>
            </Stack>
          </AccordionDetails>
        </Accordion>
      </SectionCard>
      <CampaignActions campaign={campaign} />
      <SectionCard title={t.marketing.campaignRunsTitle}>
        {runs.isPending ? <StatusView surface={false} state={{ kind: 'loading', label: t.marketing.activity.loading }} /> : runs.isError ? (
          <StatusView surface={false} state={{ kind: 'error', message: localizePanelError(runs.error, t), retry: { label: t.common.retry, onRetry: () => void runs.refetch() } }} />
        ) : runs.data.items.length === 0 ? <Typography color="text.secondary">{t.marketing.campaignRunsEmpty}</Typography> : (
          <Stack useFlexGap spacing="0.75rem">
            {runs.data.items.map(({ run, campaignCounts }) => (
              <Stack key={run.id} direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.5rem" sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="body2">{formatSchedulerDateTime(run.startedAt, language)}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {run.durationMs === null ? '—' : formatSchedulerDuration(run.durationMs, language)} · {t.marketing.activity.counts(campaignCounts ?? { sent: 0, failed: 0, skipped: 0 })}
                  </Typography>
                </Box>
                <Button
                  component={Link}
                  size="small"
                  to={`/panel/marketing/activity/${encodeURIComponent(run.id)}`}
                  aria-label={t.marketing.activity.runDetails({ startedAt: formatSchedulerDateTime(run.startedAt, language) })}
                >
                  {t.marketing.activity.details}
                </Button>
              </Stack>
            ))}
          </Stack>
        )}
      </SectionCard>
    </>
  );
};

export const CampaignDetailPage = () => {
  const t = useTranslations();
  const params = useParams({ strict: false });
  const campaign = useQuery(actions.marketingCampaign(params.campaignId ?? ''));
  const settings = useQuery(actions.marketingSesSettings);
  const trackingDisabled = settings.isSuccess && settings.data.settings?.trackingEnabled !== true;
  if (campaign.isPending) return <PanelPage title={t.marketing.campaignsTitle} state={{ kind: 'loading', label: t.marketing.campaignsLoading }} />;
  if (campaign.isError) return <PanelPage title={t.marketing.campaignsTitle} state={{ kind: 'error', message: localizePanelError(campaign.error, t), retry: { label: t.common.retry, onRetry: () => void campaign.refetch() } }} />;
  if (params.campaignId === undefined) return <Navigate to="/panel/marketing/campaigns" />;
  return (
    <PanelPage
      title={<Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>{campaign.data.campaign.name}<CampaignStatusChip status={campaign.data.campaign.status} label={t.marketing.status[campaign.data.campaign.status]} /></Box>}
      documentTitle={campaign.data.campaign.name}
      backTo={<PanelBackLink to="/panel/marketing/campaigns">{t.marketing.allCampaigns}</PanelBackLink>}
    >
      {campaignEditable(campaign.data.campaign) ? (
        <>
          {shouldMaskEngagement(campaign.data.campaign.engagement, trackingDisabled) ? <Alert severity="info">{t.marketing.trackingDisabledCampaignMetrics}</Alert> : null}
          <CampaignEngagementTiles engagement={campaign.data.campaign.engagement} masked={shouldMaskEngagement(campaign.data.campaign.engagement, trackingDisabled)} />
          <CampaignForm key={`${campaign.data.campaign.id}:${campaign.data.campaign.status}`} campaign={campaign.data.campaign} />
          <CampaignActions campaign={campaign.data.campaign} />
        </>
      ) : <CampaignReport campaign={campaign.data.campaign} trackingDisabled={trackingDisabled} />}
    </PanelPage>
  );
};
