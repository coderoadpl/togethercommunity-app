import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
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
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { MarketingSummaryRow } from './MarketingSummaryRow.js';

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
  const documentRef = documentMode === 'url'
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
  const publishedDocuments = (documents.data?.documents ?? []).filter((document) => document.status === 'published');

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
          disabled={definition !== undefined}
          required
        />
        {definition === undefined ? <FormHelperText>{t.marketing.keyFormatHint}</FormHelperText> : null}
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="marketing-consent-wording">{t.marketing.wordingLabel}</FormLabel>
        <OutlinedInput id="marketing-consent-wording" value={label} onChange={(event) => setLabel(event.target.value)} multiline minRows={3} required />
      </FormControl>
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem">
        <FormControl fullWidth>
          <FormLabel>{t.marketing.purposeLabel}</FormLabel>
          <OutlinedInput value={t.marketing.purposeMarketing} readOnly />
        </FormControl>
        <FormControl fullWidth>
          <FormLabel>{t.marketing.channelLabel}</FormLabel>
          <OutlinedInput value={t.marketing.channelEmail} readOnly />
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
        <Select labelId="marketing-consent-document-mode" value={documentMode} onChange={(event) => setDocumentMode(event.target.value)}>
          <MenuItem value="url">{t.marketing.documentUrlMode}</MenuItem>
          <MenuItem value="hosted">{t.marketing.documentHostedMode}</MenuItem>
        </Select>
      </FormControl>
      {documentMode === 'url' ? (
        <FormControl fullWidth>
          <FormLabel htmlFor="marketing-consent-document-url">{t.marketing.documentUrlLabel}</FormLabel>
          <OutlinedInput id="marketing-consent-document-url" type="url" value={documentUrl} onChange={(event) => setDocumentUrl(event.target.value)} required />
        </FormControl>
      ) : (
        <FormControl fullWidth>
          <FormLabel id="marketing-consent-hosted-document">{t.marketing.hostedDocumentLabel}</FormLabel>
          <Select labelId="marketing-consent-hosted-document" value={hostedDocumentId} onChange={(event) => setHostedDocumentId(event.target.value)} required>
            {publishedDocuments.map((document) => <MenuItem key={document.id} value={document.id}>{document.title}</MenuItem>)}
          </Select>
        </FormControl>
      )}
      {definition === undefined ? null : (
        <FormControl fullWidth>
          <FormLabel id="marketing-consent-status">{t.common.status}</FormLabel>
          <Select labelId="marketing-consent-status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <MenuItem value="active">{t.marketing.active}</MenuItem>
            <MenuItem value="archived">{t.marketing.archived}</MenuItem>
          </Select>
        </FormControl>
      )}
      {documents.isError ? <Alert>{localizeError(documents.error, t)}</Alert> : null}
      {create.isError || update.isError ? <Alert>{localizeError(create.error ?? update.error, t)}</Alert> : null}
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
            summary={version.documentVersionRef.mode === 'url' ? version.documentVersionRef.url : version.documentVersionRef.documentVersionId}
            date={t.marketing.versionEntry({ version: version.version, date: formatDateTime(version.createdAt, language) })}
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
        {consents.isPending ? <StatusView state={{ kind: 'loading', label: t.marketing.consentsLoading }} /> : consents.isError ? <StatusView state={{ kind: 'error', message: localizeError(consents.error, t) }} /> : (
          <Stack useFlexGap spacing="1rem">
            {consents.data.definitions.map((definition) => (
              <MarketingSummaryRow
                key={definition.id}
                title={definition.key}
                chips={<><Chip size="small" label={definition.status === 'active' ? t.marketing.active : t.marketing.archived} /><Chip size="small" variant="outlined" label={definition.doubleOptIn ? t.marketing.doubleOptInLabel : t.marketing.singleOptInWarning} /></>}
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
  return <PanelPage title={t.marketing.newConsent} backTo={{ label: t.marketing.allConsents, href: '/panel/marketing/consents' }}><ConsentForm /></PanelPage>;
};

export const ConsentDetailPage = () => {
  const t = useTranslations();
  const params = useParams({ strict: false });
  const consent = useQuery(actions.marketingConsent(params.consentId ?? ''));
  if (consent.isPending) return <PanelPage title={t.marketing.consentsTitle} state={{ kind: 'loading', label: t.marketing.consentsLoading }} />;
  if (consent.isError) return <PanelPage title={t.marketing.consentsTitle} state={{ kind: 'error', message: localizeError(consent.error, t) }} />;
  if (params.consentId === undefined) return <Navigate to="/panel/marketing/consents" />;
  return (
    <PanelPage title={consent.data.definition.key} backTo={{ label: t.marketing.allConsents, href: '/panel/marketing/consents' }}>
      <ConsentForm definition={consent.data.definition} versions={consent.data.versions} />
      <ConsentVersions versions={consent.data.versions} />
    </PanelPage>
  );
};
