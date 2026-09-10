import { useId, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Link as MuiLink,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from '@tanstack/react-router';

import type { ConsentDefinition, ConsentDefinitionVersion } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ListSection, PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { CopyButton } from '../../../components/ui/CopyField.js';
import { localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { FONT_MONO } from '../../../theme.js';
import { PanelBackLink } from '../PanelBackLink.js';
import { MarketingSummaryRow } from './MarketingSummaryRow.js';

const consentStatusColor: Record<ConsentDefinition['status'], 'success' | 'warning'> = {
  active: 'success',
  archived: 'warning',
};

const ConsentStatusChip = ({ status, label }: { status: ConsentDefinition['status']; label: string }) => (
  <Chip size="small" color={consentStatusColor[status]} variant="outlined" label={label} />
);

const CopyDocumentReferenceButton = ({ value }: { value: string }) => {
  const t = useTranslations();

  return <CopyButton value={value} label={t.marketing.copyDocumentReference} testId="marketing-consent-document-reference" minTouchTarget manualFallback />;
};

export const ConsentForm = ({ definition, versions = [] }: { definition?: ConsentDefinition | undefined; versions?: ConsentDefinitionVersion[] | undefined }) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const documents = useQuery(actions.marketingDocuments);
  const latest = versions.at(-1);
  const [key, setKey] = useState(definition?.key ?? '');
  const [keyError, setKeyError] = useState(false);
  const [label, setLabel] = useState(latest?.label ?? '');
  const [doubleOptIn, setDoubleOptIn] = useState(definition?.doubleOptIn ?? true);
  const [status, setStatus] = useState<ConsentDefinition['status']>(definition?.status ?? 'active');
  const [documentMode, setDocumentMode] = useState<'url' | 'hosted'>(definition?.documentRef.mode ?? 'url');
  const [documentUrl, setDocumentUrl] = useState(definition?.documentRef.mode === 'url' ? definition.documentRef.url : '');
  const [hostedDocumentId, setHostedDocumentId] = useState(definition?.documentRef.mode === 'hosted' ? definition.documentRef.documentId : '');
  const hostedUnavailableHintId = useId();
  const allDocuments = documents.data?.documents ?? [];
  const publishedDocuments = allDocuments.filter((document) => document.status === 'published');
  const currentHostedDocumentId = definition?.documentRef.mode === 'hosted' ? definition.documentRef.documentId : null;
  const currentHostedDocument = currentHostedDocumentId === null
    ? null
    : allDocuments.find((document) => document.id === currentHostedDocumentId) ?? { id: currentHostedDocumentId, title: currentHostedDocumentId };
  const currentHostedDocumentIsPublished = currentHostedDocumentId !== null && publishedDocuments.some((document) => document.id === currentHostedDocumentId);
  const hostedDocumentOptions = currentHostedDocument === null || currentHostedDocumentIsPublished ? publishedDocuments : [currentHostedDocument, ...publishedDocuments];
  const hostedDocumentsUnavailable = documents.isSuccess && publishedDocuments.length === 0;
  const existingHostedDocument = currentHostedDocumentId !== null;
  const effectiveDocumentMode = hostedDocumentsUnavailable && !existingHostedDocument ? 'url' : documentMode;
  const hostedModeDisabled = hostedDocumentsUnavailable && !existingHostedDocument;
  const documentRef = effectiveDocumentMode === 'url'
    ? { mode: 'url' as const, url: documentUrl }
    : { mode: 'hosted' as const, documentId: hostedDocumentId };

  const create = useMutation({
    ...actions.createMarketingConsent,
    onSuccess: async ({ definition: saved }) => {
      await queryClient.invalidateQueries(actions.marketingInvalidates());
      if (saved !== null) await navigate({ to: '/panel/marketing/consents/$consentId', params: { consentId: saved.id } });
    },
  });
  const update = useMutation({
    ...actions.updateMarketingConsent,
    onSuccess: async () => queryClient.invalidateQueries(actions.marketingInvalidates()),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (definition === undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
      setKeyError(true);
      return;
    }
    if (definition === undefined) create.mutate({ key, label, doubleOptIn, documentRef });
    else update.mutate({ definitionId: definition.id, label, doubleOptIn, documentRef, status });
  };
  const pending = create.isPending || update.isPending;

  return (
    <SectionCard
      title={t.marketing.consentCreator}
      onSubmit={submit}
      actions={<Button type="submit" variant="contained" disabled={pending}>{pending ? t.marketing.saving : definition === undefined ? t.marketing.createConsentAction : t.marketing.saveConsentAction}</Button>}
    >
      <FormControl fullWidth error={keyError}>
        <FormLabel htmlFor="marketing-consent-key">{t.marketing.keyLabel}</FormLabel>
        <OutlinedInput
          id="marketing-consent-key"
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            setKeyError(false);
          }}
          readOnly={definition !== undefined}
          inputProps={definition === undefined ? undefined : { style: { fontFamily: FONT_MONO } }}
          required
        />
        <FormHelperText>{definition === undefined ? (keyError ? t.marketing.keyFormatError : t.marketing.keyFormatHint) : t.marketing.keyImmutableHint}</FormHelperText>
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="marketing-consent-wording">{t.marketing.wordingLabel}</FormLabel>
        <OutlinedInput id="marketing-consent-wording" value={label} onChange={(event) => setLabel(event.target.value)} multiline minRows={3} required />
      </FormControl>
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem">
        <FormControl fullWidth>
          <FormLabel component="span">{t.marketing.purposeLabel}</FormLabel>
          <Stack direction="row" useFlexGap sx={{ gap: '0.5rem', pt: '0.5rem' }}>
            <Chip size="small" variant="outlined" label={t.marketing.purposeMarketing} />
          </Stack>
        </FormControl>
        <FormControl fullWidth>
          <FormLabel component="span">{t.marketing.channelLabel}</FormLabel>
          <Stack direction="row" useFlexGap sx={{ gap: '0.5rem', pt: '0.5rem' }}>
            <Chip size="small" variant="outlined" label={t.marketing.channelEmail} />
          </Stack>
        </FormControl>
      </Stack>
      <Alert severity="info">{t.marketing.optionalOnly} {t.marketing.notPreticked}</Alert>
      <FormControlLabel
        control={<Switch checked={doubleOptIn} onChange={(event) => setDoubleOptIn(event.target.checked)} />}
        label={t.marketing.doubleOptInLabel}
      />
      <Typography variant="body2">{t.marketing.doubleOptInHint}</Typography>
      {doubleOptIn ? null : <Alert severity="warning">{t.marketing.singleOptInWarning}</Alert>}
      <FormControl fullWidth>
        <FormLabel id="marketing-consent-document-mode">{t.marketing.documentModeLabel}</FormLabel>
        <Select labelId="marketing-consent-document-mode" value={effectiveDocumentMode} onChange={(event) => setDocumentMode(event.target.value)}>
          <MenuItem value="url">{t.marketing.documentUrlMode}</MenuItem>
          <MenuItem value="hosted" disabled={hostedModeDisabled}>{t.marketing.documentHostedMode}</MenuItem>
        </Select>
      </FormControl>
      {effectiveDocumentMode === 'url' ? (
        <FormControl fullWidth>
          <FormLabel htmlFor="marketing-consent-document-url">{t.marketing.documentUrlLabel}</FormLabel>
          <OutlinedInput id="marketing-consent-document-url" type="url" value={documentUrl} onChange={(event) => setDocumentUrl(event.target.value)} required />
        </FormControl>
      ) : (
        <FormControl fullWidth>
          <FormLabel id="marketing-consent-hosted-document">{t.marketing.hostedDocumentLabel}</FormLabel>
          <Select labelId="marketing-consent-hosted-document" value={hostedDocumentId} onChange={(event) => setHostedDocumentId(event.target.value)} required>
            {hostedDocumentOptions.map((document) => <MenuItem key={document.id} value={document.id}>{document.title}</MenuItem>)}
          </Select>
        </FormControl>
      )}
      {hostedModeDisabled ? (
        <FormControl fullWidth>
          <FormLabel id="marketing-consent-hosted-document-unavailable">{t.marketing.hostedDocumentLabel}</FormLabel>
          <Select
            labelId="marketing-consent-hosted-document-unavailable"
            value=""
            disabled
            displayEmpty
            inputProps={{ 'aria-describedby': hostedUnavailableHintId }}
          >
            <MenuItem value="">{t.marketing.noPublishedDocumentsSelect}</MenuItem>
          </Select>
          <Alert severity="info" id={hostedUnavailableHintId}>
            {t.marketing.noPublishedDocuments}{' '}
            <MuiLink component={Link} to="/panel/marketing/documents/new">{t.marketing.createDocumentLink}</MuiLink>
          </Alert>
        </FormControl>
      ) : null}
      {definition === undefined ? null : (
        <FormControl fullWidth>
          <FormLabel id="marketing-consent-status">{t.common.status}</FormLabel>
          <Select labelId="marketing-consent-status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <MenuItem value="active">{t.marketing.active}</MenuItem>
            <MenuItem value="archived">{t.marketing.archived}</MenuItem>
          </Select>
        </FormControl>
      )}
      {documents.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizePanelError(documents.error, t), retry: { label: t.common.retry, onRetry: () => void documents.refetch() } }} /> : null}
      {create.isError || update.isError ? <Alert severity="error">{localizePanelError(create.error ?? update.error, t)}</Alert> : null}
    </SectionCard>
  );
};

const ConsentVersions = ({ versions }: { versions: ConsentDefinitionVersion[] }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  return (
    <SectionCard title={t.marketing.versions}>
      <Stack useFlexGap spacing="0.75rem">
        {versions.toSorted((a, b) => b.version - a.version).map((version) => (
          <MarketingSummaryRow
            key={version.id}
            title={version.label}
            chips={<Chip size="small" variant="outlined" label={t.marketing.versionLabel({ version: version.version })} />}
            summary={version.documentVersionRef.mode === 'url' ? version.documentVersionRef.url : undefined}
            date={formatDateTime(version.createdAt, language)}
            actions={version.documentVersionRef.mode === 'hosted' ? <CopyDocumentReferenceButton value={version.documentVersionRef.documentVersionId} /> : undefined}
          />
        ))}
      </Stack>
    </SectionCard>
  );
};

export const ConsentsPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const consents = useQuery(actions.marketingConsents);
  const navigate = useNavigate();
  return (
    <PanelPage title={t.marketing.consentsTitle} description={t.marketing.consentsDescription} action={<Button component={Link} to="/panel/marketing/consents/new" variant="contained">+ {t.common.add}</Button>}>
      <ListSection isEmpty={consents.isSuccess && consents.data.definitions.length === 0} empty={<StatusView state={{ kind: 'empty', title: t.marketing.consentsEmpty, action: <Button component={Link} to="/panel/marketing/consents/new">+ {t.common.add}</Button> }} />}>
        {consents.isPending ? <StatusView state={{ kind: 'loading', label: t.marketing.consentsLoading }} /> : consents.isError ? <StatusView state={{ kind: 'error', message: localizePanelError(consents.error, t), retry: { label: t.common.retry, onRetry: () => void consents.refetch() } }} /> : (
          <Stack useFlexGap spacing="1rem">
            {consents.data.definitions.map((definition) => (
              <MarketingSummaryRow
                key={definition.id}
                title={definition.key}
                chips={<><ConsentStatusChip status={definition.status} label={definition.status === 'active' ? t.marketing.active : t.marketing.archived} /><Chip size="small" color={definition.doubleOptIn ? 'success' : 'warning'} variant="outlined" label={definition.doubleOptIn ? t.marketing.doubleOptInChip : t.marketing.singleOptInChip} /></>}
                summary={`${t.marketing.purposeMarketing} · ${t.marketing.channelEmail}`}
                date={formatDateTime(definition.updatedAt, language)}
                actions={<Button onClick={() => void navigate({ to: '/panel/marketing/consents/$consentId', params: { consentId: definition.id } })}>{t.marketing.consentCreator}</Button>}
                testId="marketing-consent-row"
              />
            ))}
          </Stack>
        )}
      </ListSection>
    </PanelPage>
  );
};

export const ConsentCreatePage = () => {
  const t = useTranslations();
  return <PanelPage title={t.marketing.newConsent} backTo={<PanelBackLink to="/panel/marketing/consents">{t.marketing.allConsents}</PanelBackLink>}><ConsentForm /></PanelPage>;
};

export const ConsentDetailPage = () => {
  const t = useTranslations();
  const params = useParams({ strict: false });
  const consent = useQuery(actions.marketingConsent(params.consentId ?? ''));
  if (consent.isPending) return <PanelPage title={t.marketing.consentsTitle} state={{ kind: 'loading', label: t.marketing.consentsLoading }} />;
  if (consent.isError) return <PanelPage title={t.marketing.consentsTitle} state={{ kind: 'error', message: localizePanelError(consent.error, t), retry: { label: t.common.retry, onRetry: () => void consent.refetch() } }} />;
  if (params.consentId === undefined) return <Navigate to="/panel/marketing/consents" />;
  return (
    <PanelPage title={consent.data.definition.key} backTo={<PanelBackLink to="/panel/marketing/consents">{t.marketing.allConsents}</PanelBackLink>}>
      <ConsentForm definition={consent.data.definition} versions={consent.data.versions} />
      <ConsentVersions versions={consent.data.versions} />
    </PanelPage>
  );
};
