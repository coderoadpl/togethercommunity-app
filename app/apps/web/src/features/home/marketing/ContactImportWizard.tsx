import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Chip, FormControlLabel, Paper, Stack, Step, StepLabel, Stepper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { z } from 'zod';

import { MARKETING_DIRECTORY_ATTESTATION_TEXT, MARKETING_IMPORT_ATTESTATION_TEXT, MARKETING_IMPORT_ATTESTATION_VERSION, mapMarketingImportCsv, parseMarketingImportCsv } from '#core/client/index.js';
import { MARKETING_IMPORT_EMAIL_INVALID, MARKETING_IMPORT_EMAIL_MISSING, marketingImportMappingSchema, type MarketingContactImport, type MarketingImportValidation } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { PanelPage, ResponsiveTable, SectionCard, StatusView } from '../../../components/layout/index.js';
import { useLanguage, useTranslations, type Messages } from '../../../i18n/index.js';
import { PanelBackLink } from '../PanelBackLink.js';
import { usePanelContext } from '../panel-context.js';
import { ContactImportResult } from './ContactImportResult.js';
import { DirectoryActions, DirectoryError, DirectoryField, DirectorySelect } from './DirectoryFields.js';

const importSearchSchema = z.object({ importId: z.string().min(1).optional(), kind: z.enum(['contacts', 'suppressions']).optional() });
export const validateContactImportSearch = (search: Record<string, unknown>) => importSearchSchema.parse(search);
type Mapping = z.output<typeof marketingImportMappingSchema>;
const contactFields = ['email', 'name', 'firstName', 'lastName', 'tags', 'source', 'consentSource', 'consentAt', 'lists'] as const;
const suppressionFields = ['email', 'reason', 'at'] as const;
const sampleCsv = {
  contacts: 'email,name,tags,source,consentSource,consentAt,lists\r\nperson@example.org,Example Person,newsletter,CSV sample,Signup form,2026-01-15T12:00:00Z,newsletter\r\n',
  suppressions: 'email,reason,at\r\nperson@example.org,unsubscribe,2026-01-15T12:00:00Z\r\n',
} as const;
const nextUploadId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `import-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
const localizeImportIssue = (message: string, t: Messages): string => {
  if (message.includes(MARKETING_IMPORT_EMAIL_MISSING)) return t.directory.importErrors.emailMissing;
  if (message.includes(MARKETING_IMPORT_EMAIL_INVALID)) return t.directory.importErrors.emailInvalid;
  return message;
};

const ImportPreview = ({ preview }: { preview: MarketingImportValidation }) => {
  const t = useTranslations();
  return <>
    <Typography>{t.directory.totalRows}: {preview.import.rowCount} · {t.directory.validRows}: {preview.counts.validRows} · {t.directory.rejectedRows}: {preview.counts.rejectedRows} · {t.directory.duplicateRows}: {preview.counts.duplicateRows}</Typography>
    <Typography>{t.directory.listsToCreate}: {preview.counts.listsToCreate.join(', ') || '—'}</Typography>
    <Typography>{t.directory.previewHint}</Typography>
    <ResponsiveTable><Table size="small" aria-label={t.directory.mapping}><TableHead><TableRow>{[t.directory.row, t.directory.email, t.directory.name, t.directory.tags, t.directory.listsTitle, t.directory.errors, t.directory.warnings].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{preview.preview.map((row) => <TableRow key={row.rowNumber}><TableCell>{row.rowNumber}</TableCell><TableCell>{row.normalizedPayload?.email ?? String(row.stagedPayload?.['email'] ?? '')}</TableCell><TableCell>{row.normalizedPayload?.name ?? [row.normalizedPayload?.firstName, row.normalizedPayload?.lastName].filter(Boolean).join(' ')}</TableCell><TableCell>{row.normalizedPayload?.tags?.join(', ')}</TableCell><TableCell>{row.normalizedPayload?.lists?.join(', ')}</TableCell><TableCell>{row.errors.map((error) => localizeImportIssue(error, t)).join('; ')}</TableCell><TableCell>{row.warnings.join('; ')}</TableCell></TableRow>)}</TableBody></Table></ResponsiveTable>
    {preview.errors.length ? <Alert severity="error"><Typography>{t.directory.errors}</Typography>{preview.errors.map((error, index) => <Typography key={index}>{t.directory.row} {error.rowNumber}: {localizeImportIssue(error.message, t)}</Typography>)}</Alert> : null}
    {preview.warnings.length ? <Alert severity="warning"><Typography>{t.directory.warnings}</Typography>{preview.warnings.map((warning, index) => <Typography key={index}>{t.directory.row} {warning.rowNumber}: {warning.message}</Typography>)}</Alert> : null}
  </>;
};

const ImportEditor = ({ kind, initialBatch }: { kind: 'contacts' | 'suppressions'; initialBatch?: MarketingContactImport }) => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const { language } = useLanguage();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState(initialBatch ? 1 : 0);
  const heading = useRef<HTMLDivElement>(null);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState(initialBatch?.fileName ?? '');
  const [delimiter, setDelimiter] = useState<'' | ',' | ';'>(initialBatch?.delimiter ?? '');
  const [mapping, setMapping] = useState<Mapping>(initialBatch?.mapping ?? {});
  const [preview, setPreview] = useState<MarketingImportValidation>();
  const [batchId, setBatchId] = useState(initialBatch?.id);
  const [consentDefinitionId, setConsentDefinitionId] = useState(initialBatch?.consentDefinitionId ?? '');
  const [source, setSource] = useState(initialBatch?.defaults.source ?? '');
  const [reason, setReason] = useState<'' | 'unsubscribe' | 'bounce' | 'complaint' | 'manual'>(initialBatch?.defaults.reason ?? '');
  const [at, setAt] = useState(initialBatch?.defaults.at ?? '');
  const [accepted, setAccepted] = useState(false);
  const [note, setNote] = useState('');
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [stale, setStale] = useState(false);
  const [fileError, setFileError] = useState('');
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadRequest = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  const editRevision = useRef(0);
  const requestedRevision = useRef(0);
  const consents = useQuery({ ...actions.marketingConsents, enabled: kind === 'contacts' });
  const validated = async (value: MarketingImportValidation) => {
    setBatchId(value.import.id);
    if (editRevision.current !== requestedRevision.current) setStale(true);
    else { setPreview(value); setMapping(value.import.mapping); setDelimiter(value.import.delimiter ?? ''); setStale(false); setAccepted(false); setNote(''); setStep(1); }
    cache.setQueryData(actions.directory.import(tenant.id, { importId: value.import.id }).queryKey, { import: value.import });
    await navigate({ to: '/panel/marketing/contacts/import', search: { importId: value.import.id }, replace: true });
  };
  const upload = useMutation({ ...actions.directory.uploadMarketingContactImport, onSuccess: validated });
  const remap = useMutation({ ...actions.directory.previewMarketingContactImport, onSuccess: validated });
  const { mutate: validate, ...validation } = useMutation({ ...actions.directory.validateMarketingContactImport, onSuccess: validated });
  const commit = useMutation({ ...actions.directory.commitMarketingContactImport, onSuccess: async ({ import: batch }) => { await cache.invalidateQueries(actions.directory.invalidates(tenant.id)); await navigate({ to: '/panel/marketing/contacts/import', search: { importId: batch.id } }); } });
  const cancel = useMutation({ ...actions.directory.cancelMarketingContactImport, onSuccess: async () => cache.invalidateQueries(actions.directory.invalidates(tenant.id)) });
  const initialId = initialBatch?.id;
  useEffect(() => { if (initialId) validate({ importId: initialId }); }, [initialId, validate]);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const parsed = csv ? parseMarketingImportCsv(csv, delimiter || undefined) : undefined;
  const headers = parsed?.ok ? parsed.value.headers : preview?.headers ?? Object.keys(initialBatch?.mapping ?? {});
  const dirty = () => { editRevision.current += 1; setStale(true); setAccepted(false); setNote(''); commit.reset(); };
  const pending = reading || upload.isPending || remap.isPending || validation.isPending || commit.isPending || cancel.isPending;
  const readFile = (file: File | undefined) => {
    setCsv(''); setFileName(''); setFileError(''); setPreview(undefined); setMapping({}); setBatchId(undefined); dirty();
    if (!file) return;
    setFileName(file.name);
    if (file.size > 3 * 1024 * 1024) { setFileError(t.directory.fileError); return; }
    setReading(true);
    void (async () => {
      try {
        const buffer = await file.arrayBuffer();
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
        catch { setFileError(t.directory.encodingError); return; }
        setCsv(text);
        const result = parseMarketingImportCsv(text, delimiter || undefined);
        if (result.ok) { const mapped = mapMarketingImportCsv(result.value, { kind }); if (mapped.ok) setMapping(mapped.value.mapping); }
      } catch { setFileError(t.directory.fileError); }
      finally { setReading(false); }
    })();
  };
  const canContinue = preview && !stale && !pending && (preview.canCommit || skipInvalid && preview.canCommitWithSkippedRows);
  const defaults = { ...(source ? { source } : {}), ...(reason ? { reason } : {}), ...(at ? { at } : {}) };
  const validatePreview = () => {
    setAccepted(false); setNote(''); requestedRevision.current = editRevision.current;
    const fingerprint = JSON.stringify({ csv, kind, fileName, mapping, delimiter, defaults, consentDefinitionId });
    if (uploadRequest.current?.fingerprint !== fingerprint) uploadRequest.current = { fingerprint, key: nextUploadId() };
    const idempotencyKey = uploadRequest.current.key;
    if (batchId) remap.mutate({ importId: batchId, mapping, ...(delimiter ? { delimiter } : {}), defaults, consentDefinitionId: consentDefinitionId || null });
    else upload.mutate({ csv, metadata: { kind, datasetVersion: 'together-marketing-contacts/v1', fileName, mapping, ...(delimiter ? { delimiter } : {}), defaults, consentDefinitionId: consentDefinitionId || null, idempotencyKey } });
  };
  const count = preview ? preview.import.rowCount - (skipInvalid ? preview.counts.rejectedRows : 0) : 0;
  const plural = new Intl.PluralRules(language).select(count);
  const labels = kind === 'contacts' ? { one: t.directory.commitContactsOne, few: t.directory.commitContactsFew, many: t.directory.commitContactsMany } : { one: t.directory.commitSuppressionsOne, few: t.directory.commitSuppressionsFew, many: t.directory.commitSuppressionsMany };
  const commitLabel = (plural === 'one' ? labels.one : plural === 'few' ? labels.few : labels.many).replace('{count}', String(count));
  const legal = consentDefinitionId ? MARKETING_IMPORT_ATTESTATION_TEXT : MARKETING_DIRECTORY_ATTESTATION_TEXT;
  return <>
    <Stepper activeStep={step} alternativeLabel>{[t.directory.upload, t.directory.mapping, t.directory.attestation, t.directory.result].map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}</Stepper>
    <div ref={heading} tabIndex={-1}><SectionCard title={step === 0 ? t.directory.upload : step === 1 ? t.directory.mapping : t.directory.attestation}>
      {step === 0 ? <>
        <Alert severity="info">{t.directory.fileHint}</Alert>
        <Paper variant="outlined" role="group" aria-label={t.directory.dropFile} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!pending) readFile(event.dataTransfer.files[0]); }} sx={{ p: 2 }}>
          <Typography>{t.directory.dropFile}</Typography>
          <Stack direction="row" useFlexGap spacing="0.75rem" sx={{ alignItems: 'center', flexWrap: 'wrap', mt: 1 }}>
            <input ref={fileInput} type="file" accept=".csv,text/csv" aria-label={t.directory.file} hidden disabled={pending} onChange={(event) => readFile(event.target.files?.[0])} />
            <Button variant="outlined" disabled={pending} onClick={() => fileInput.current?.click()}>{t.directory.chooseFile}</Button>
            {fileName ? <Chip size="small" variant="outlined" label={fileName} /> : null}
            <Button component="a" href={`data:text/csv;charset=utf-8,${encodeURIComponent(sampleCsv[kind])}`} download={`${kind}-import-sample.csv`}>{t.directory.downloadSample}</Button>
          </Stack>
        </Paper>
        <DirectorySelect label={t.directory.delimiter} value={delimiter} onChange={(value) => { setDelimiter(value); setMapping({}); }} options={[{ value: '', label: t.directory.auto }, { value: ',', label: t.directory.comma }, { value: ';', label: t.directory.semicolon }]} />
        {parsed && !parsed.ok ? <Alert severity="error">{t.directory.parseError}</Alert> : null}{fileError ? <Alert severity="error">{fileError}</Alert> : null}
        <Button variant="contained" disabled={!parsed?.ok || pending} onClick={() => { if (parsed?.ok) { const mapped = mapMarketingImportCsv(parsed.value, { kind }); setMapping(mapped.ok ? mapped.value.mapping : {}); setDelimiter(parsed.value.delimiter); setStep(1); } }}>{t.directory.next}</Button>
      </> : step === 1 ? <>
        <Typography>{fileName} · {t.directory.delimiter}: {delimiter}</Typography>
        <Alert severity="info">{t.directory.unknownColumns}</Alert>
        {headers.map((header) => <DirectorySelect key={header} label={header} value={mapping[header] ?? ''} onChange={(field) => { setMapping(field ? { ...mapping, [header]: field } : Object.fromEntries(Object.entries(mapping).filter(([key]) => key !== header))); dirty(); }} options={[{ value: '', label: t.directory.ignoreColumn }, ...(kind === 'contacts' ? contactFields : suppressionFields).map((value) => ({ value, label: t.directory.importFields[value] }))]} />)}
        {kind === 'contacts' ? <><DirectoryField label={t.directory.defaultSource} value={source} onChange={(value) => { setSource(value); dirty(); }} maxLength={120} /><DirectorySelect label={t.directory.consentDefinition} value={consentDefinitionId} onChange={(value) => { setConsentDefinitionId(value); dirty(); }} options={[{ value: '', label: t.directory.contactsOnly }, ...(consents.data?.definitions.filter((definition) => definition.status === 'active' && definition.kind === 'optional_marketing' && !definition.doubleOptIn).map((definition) => ({ value: definition.id, label: definition.key })) ?? [])]} />{consentDefinitionId ? null : <Alert severity="info">{t.directory.doiHint}</Alert>}</> : <><DirectorySelect label={t.directory.defaultReason} value={reason} onChange={(value) => { setReason(value); dirty(); }} options={[{ value: '', label: t.directory.noDefault }, ...(['unsubscribe', 'bounce', 'complaint', 'manual'] as const).map((value) => ({ value, label: t.directory[value] }))]} /><DirectoryField label={t.directory.defaultAt} value={at} onChange={(value) => { setAt(value); dirty(); }} /></>}
        {stale && preview ? <Alert severity="warning">{t.directory.previewStale}</Alert> : null}
        <Button disabled={pending || !marketingImportMappingSchema.safeParse(mapping).success} onClick={validatePreview}>{t.directory.validate}</Button>
        {preview ? <ImportPreview preview={preview} /> : null}
        <FormControlLabel control={<Checkbox checked={skipInvalid} onChange={(event) => { setSkipInvalid(event.target.checked); setAccepted(false); setNote(''); }} />} label={t.directory.skipInvalid} />
        <DirectoryActions>{!batchId ? <Button onClick={() => setStep(0)}>{t.directory.back}</Button> : null}<Button variant="contained" disabled={!canContinue} onClick={() => { setAccepted(false); setNote(''); setStep(2); }}>{t.directory.next}</Button></DirectoryActions>
      </> : preview ? <>
        <ImportPreview preview={preview} /><Typography>{t.directory.consentDefinition}: {consents.data?.definitions.find((definition) => definition.id === consentDefinitionId)?.key ?? t.directory.contactsOnly} · {t.directory.version}: {preview.import.definitionVersion ?? '—'}</Typography>
        <Alert severity="info">{skipInvalid ? t.directory.skipInvalid : t.directory.rejectInvalid}</Alert>{consentDefinitionId ? <Alert severity="info">{t.directory.assertionTime}</Alert> : null}
        <Typography>{t.directory.legalEnglish}</Typography><FormControlLabel control={<Checkbox checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />} label={legal} />
        <DirectoryField label={t.directory.note} value={note} onChange={setNote} multiline required maxLength={2000} />
        <DirectoryActions><Button disabled={pending} onClick={() => { setAccepted(false); setNote(''); setStep(1); }}>{t.directory.back}</Button><Button variant="contained" disabled={!accepted || note.trim().length < 20 || note.trim().length > 2000 || !canContinue} onClick={() => commit.mutate({ importId: preview.import.id, validationHash: preview.validationHash, attestation: { accepted: true, version: MARKETING_IMPORT_ATTESTATION_VERSION, locale: 'en', note }, invalidRows: skipInvalid ? 'skip_invalid' : 'reject_batch' })}>{commitLabel}</Button></DirectoryActions>
      </> : null}
      {batchId ? <Button disabled={pending} onClick={() => cancel.mutate({ importId: batchId })}>{t.directory.cancelImport}</Button> : null}
      <DirectoryError error={upload.error ?? remap.error ?? validation.error ?? commit.error ?? cancel.error ?? consents.error} />
    </SectionCard></div>
  </>;
};

export const ContactImportWizard = () => {
  const t = useTranslations();
  const { tenant } = usePanelContext();
  const search = useSearch({ strict: false });
  const { importId, kind } = importSearchSchema.parse(search);
  const batch = useQuery({ ...actions.directory.import(tenant.id, { importId: importId ?? '' }), enabled: importId !== undefined });
  const uncommitted = batch.data && ['draft', 'ready'].includes(batch.data.import.status);
  return <PanelPage title={(batch.data?.import.kind ?? kind) === 'suppressions' ? t.directory.suppressionImport : t.directory.importTitle} backTo={<PanelBackLink to="/panel/marketing/contacts">{t.directory.contactsTitle}</PanelBackLink>}>
    {importId ? batch.isPending ? <StatusView state={{ kind: 'loading', label: t.directory.loading }} /> : batch.isError ? <DirectoryError error={batch.error} /> : uncommitted && batch.data ? <ImportEditor key={importId} kind={batch.data.import.kind} initialBatch={batch.data.import} /> : <ContactImportResult importId={importId} /> : <ImportEditor key={kind ?? 'contacts'} kind={kind ?? 'contacts'} />}
  </PanelPage>;
};
