import { useEffect, useState, type FormEvent } from 'react';
import {
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from '@tanstack/react-router';

import type { Campaign, CampaignEngagementStats } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { ListSection, PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { StatTile, StatTileLabel, StatTileValue } from '../../../theme.js';
import { CampaignStatusChip, MarketingSummaryRow } from './MarketingSummaryRow.js';
import {
  renderCampaignMarkdown,
  renderCampaignPreview,
  sanitizeCampaignHtml,
} from './marketing-markdown.js';

const CampaignEngagementTiles = ({
  engagement,
}: {
  engagement: CampaignEngagementStats;
}) => {
  const t = useTranslations();
  const items = [
    { label: t.marketing.uniqueOpens, value: engagement.uniqueOpens },
    { label: t.marketing.totalOpens, value: engagement.totalOpens },
    { label: t.marketing.uniqueClicks, value: engagement.uniqueClicks },
    { label: t.marketing.totalClicks, value: engagement.totalClicks },
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

const CampaignForm = ({ campaign }: { campaign?: Campaign | undefined }) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const consents = useQuery(actions.marketingConsents);
  const products = useQuery(actions.products);
  const layouts = useQuery(actions.marketingLayouts);
  const [name, setName] = useState(campaign?.name ?? '');
  const [subject, setSubject] = useState(campaign?.subject ?? '');
  const [bodySource, setBodySource] = useState(campaign?.bodySource ?? '');
  const [bodyMode, setBodyMode] = useState<'markdown' | 'html'>(
    campaign !== undefined && campaign.bodySource === campaign.bodyHtml ? 'html' : 'markdown',
  );
  const [consentDefinitionId, setConsentDefinitionId] = useState(campaign?.consentDefinitionId ?? '');
  const [productIds, setProductIds] = useState<string[]>(campaign?.audienceFilter?.productIds ?? []);
  const [layoutId, setLayoutId] = useState(campaign?.layoutId ?? '');

  const activeDefinitions = (consents.data?.definitions ?? []).filter((definition) =>
    definition.status === 'active' && definition.kind === 'optional_marketing'
  );
  const effectiveConsentId = consentDefinitionId || activeDefinitions[0]?.id || '';
  const editable = campaign === undefined || campaign.status === 'draft' || campaign.status === 'scheduled';

  const preview = useMutation(actions.previewMarketingAudience);
  const previewAudience = preview.mutate;

  useEffect(() => {
    if (editable && effectiveConsentId !== '') previewAudience({ consentDefinitionId: effectiveConsentId, productIds });
  }, [editable, effectiveConsentId, previewAudience, productIds]);

  const create = useMutation({
    ...actions.createMarketingCampaign,
    onSuccess: async ({ campaign: saved }) => {
      await queryClient.invalidateQueries(actions.marketingInvalidates());
      await navigate({ to: '/panel/marketing/campaigns/$campaignId', params: { campaignId: saved.id } });
    },
  });
  const update = useMutation({
    ...actions.updateMarketingCampaign,
    onSuccess: async () => queryClient.invalidateQueries(actions.marketingInvalidates()),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const bodyHtml = bodyMode === 'markdown' ? renderCampaignMarkdown(bodySource) : bodySource;
    const input = {
      name,
      subject,
      bodyHtml,
      bodySource,
      consentDefinitionId: effectiveConsentId,
      productIds,
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
      <Stack useFlexGap spacing="0.75rem">
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          useFlexGap
          spacing="0.75rem"
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <FormLabel htmlFor="marketing-campaign-body">{t.marketing.bodyLabel}</FormLabel>
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
          <FormControl fullWidth>
            <OutlinedInput
              id="marketing-campaign-body"
              value={bodySource}
              onChange={(event) => setBodySource(event.target.value)}
              disabled={!editable}
              multiline
              minRows={12}
              required
            />
          </FormControl>
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
                __html: bodyMode === 'markdown'
                  ? renderCampaignPreview(bodySource)
                  : sanitizeCampaignHtml(bodySource),
              }}
            />
          </Paper>
        </Box>
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
            previewAudience({ consentDefinitionId: value, productIds });
          }}
          required
        >
          {activeDefinitions.map((definition) => <MenuItem key={definition.id} value={definition.id}>{definition.key}</MenuItem>)}
        </Select>
      </FormControl>
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
      <FormControl fullWidth>
        <FormLabel id="marketing-campaign-layout-label">{t.marketing.layoutLabel}</FormLabel>
        <Select labelId="marketing-campaign-layout-label" value={layoutId} disabled={!editable || layouts.isPending} onChange={(event) => setLayoutId(event.target.value)}>
          <MenuItem value="">{t.marketing.noLayout}</MenuItem>
          {(layouts.data?.layouts ?? []).map((layout) => <MenuItem key={layout.id} value={layout.id}>{layout.name}</MenuItem>)}
        </Select>
      </FormControl>
      {consents.isError || products.isError || layouts.isError ? (
        <Alert>{localizeError(consents.error ?? products.error ?? layouts.error, t)}</Alert>
      ) : null}
      {preview.isError ? <Alert>{localizeError(preview.error, t)}</Alert> : null}
      {create.isError || update.isError ? <Alert>{localizeError(create.error ?? update.error, t)}</Alert> : null}
    </SectionCard>
  );
};

export const CampaignActions = ({ campaign }: { campaign: Campaign }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [sendAt, setSendAt] = useState('');
  const invalidate = async () => queryClient.invalidateQueries(actions.marketingInvalidates());
  const schedule = useMutation({ ...actions.scheduleMarketingCampaign, onSuccess: invalidate });
  const action = useMutation({ ...actions.marketingCampaignAction, onSuccess: invalidate });
  const testSend = useMutation(actions.testMarketingCampaign);
  const terminal = campaign.status === 'cancelled' || campaign.status === 'finished';

  return (
    <SectionCard title={t.marketing.schedule}>
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
        {campaign.status === 'running' ? <Button onClick={() => action.mutate({ campaignId: campaign.id, action: 'pause' })}>{t.marketing.pause}</Button> : null}
        {campaign.status === 'paused' ? <Button onClick={() => action.mutate({ campaignId: campaign.id, action: 'resume' })}>{t.marketing.resume}</Button> : null}
        {['draft', 'scheduled', 'running', 'paused'].includes(campaign.status) ? (
          <Button color="error" onClick={() => action.mutate({ campaignId: campaign.id, action: 'cancel' })}>{t.marketing.cancelCampaign}</Button>
        ) : null}
        {terminal ? null : (
          <Button disabled={testSend.isPending} onClick={() => testSend.mutate({ campaignId: campaign.id })}>
            {testSend.isPending ? t.marketing.testing : t.marketing.testSend}
          </Button>
        )}
      </Stack>
      {campaign.pausedReason === null ? null : <Alert severity="warning"><strong>{t.marketing.pausedReason}:</strong> {campaign.pausedReason}</Alert>}
      {schedule.isError || action.isError || testSend.isError ? <Alert>{localizeError(schedule.error ?? action.error ?? testSend.error, t)}</Alert> : null}
    </SectionCard>
  );
};

export const CampaignsPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const campaigns = useQuery(actions.marketingCampaigns);
  const consents = useQuery(actions.marketingConsents);
  const reputation = useQuery(actions.marketingReputation);
  const navigate = useNavigate();

  return (
    <PanelPage title={t.marketing.campaignsTitle} description={t.marketing.campaignsDescription} action={<Button component={Link} to="/panel/marketing/campaigns/new" variant="contained">+ {t.common.add}</Button>}>
      {reputation.data?.overallStatus === 'warn' ? (
        <Alert severity="warning">{t.marketing.campaignReputationWarnBanner}</Alert>
      ) : null}
      {reputation.data?.overallStatus === 'critical' ? (
        <Alert severity="error">{t.marketing.campaignReputationCriticalBanner}</Alert>
      ) : null}
      <ListSection
        isEmpty={campaigns.isSuccess && campaigns.data.campaigns.length === 0}
        empty={<StatusView state={{ kind: 'empty', title: t.marketing.campaignsEmpty, action: <Button component={Link} to="/panel/marketing/campaigns/new">+ {t.common.add}</Button> }} />}
      >
        {campaigns.isPending ? <StatusView state={{ kind: 'loading', label: t.marketing.campaignsLoading }} /> : campaigns.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(campaigns.error, t) }} />
        ) : (
          <Stack useFlexGap spacing="1rem">
            {campaigns.data.campaigns.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).map((campaign) => (
              <MarketingSummaryRow
                key={campaign.id}
                title={campaign.name}
                chips={<><CampaignStatusChip status={campaign.status} label={t.marketing.status[campaign.status]} /><Chip size="small" variant="outlined" label={consents.data?.definitions.find((definition) => definition.id === campaign.consentDefinitionId)?.key ?? campaign.consentDefinitionId} /></>}
                summary={(
                  <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing={{ xs: '0.25rem', sm: '1rem' }}>
                    <span>{t.marketing.counters({ toSend: campaign.toSend, sent: campaign.sent, failed: campaign.failed })}</span>
                    <span>{t.marketing.compactOpens({
                      unique: campaign.engagement.uniqueOpens,
                      total: campaign.engagement.totalOpens,
                    })}</span>
                    <span>{t.marketing.compactClicks({
                      unique: campaign.engagement.uniqueClicks,
                      total: campaign.engagement.totalClicks,
                    })}</span>
                  </Stack>
                )}
                date={formatDateTime(campaign.sendAt ?? campaign.createdAt, language)}
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
  return <PanelPage title={t.marketing.newCampaign} backTo={{ label: t.marketing.allCampaigns, href: '/panel/marketing/campaigns' }}><CampaignForm /></PanelPage>;
};

export const CampaignDetailPage = () => {
  const t = useTranslations();
  const params = useParams({ strict: false });
  const campaign = useQuery(actions.marketingCampaign(params.campaignId ?? ''));
  if (campaign.isPending) return <PanelPage title={t.marketing.campaignsTitle} state={{ kind: 'loading', label: t.marketing.campaignsLoading }} />;
  if (campaign.isError) return <PanelPage title={t.marketing.campaignsTitle} state={{ kind: 'error', message: localizeError(campaign.error, t) }} />;
  if (params.campaignId === undefined) return <Navigate to="/panel/marketing/campaigns" />;
  return (
    <PanelPage title={campaign.data.campaign.name} backTo={{ label: t.marketing.allCampaigns, href: '/panel/marketing/campaigns' }}>
      <CampaignEngagementTiles engagement={campaign.data.campaign.engagement} />
      <CampaignForm campaign={campaign.data.campaign} />
      <CampaignActions campaign={campaign.data.campaign} />
    </PanelPage>
  );
};
