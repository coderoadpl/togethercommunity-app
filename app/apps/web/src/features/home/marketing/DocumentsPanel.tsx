import { useState, type FormEvent } from 'react';
import { Alert, Button, Chip, FormControl, FormLabel, Link as MuiLink, OutlinedInput, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from '@tanstack/react-router';

import type { TenantDocument, TenantDocumentVersion } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { ListSection, PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { MarketingSummaryRow } from './MarketingSummaryRow.js';

const DocumentForm = ({ document, versions = [] }: { document?: TenantDocument | undefined; versions?: TenantDocumentVersion[] | undefined }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const latest = versions.at(-1);
  const [slug, setSlug] = useState(document?.slug ?? '');
  const [title, setTitle] = useState(document?.title ?? '');
  const [content, setContent] = useState(latest?.content ?? '');
  const invalidate = async () => queryClient.invalidateQueries(actions.marketingInvalidates());
  const create = useMutation({
    ...actions.createMarketingDocument,
    onSuccess: async ({ document: saved }) => {
      await invalidate();
      await navigate({ to: '/panel/marketing/documents/$documentId', params: { documentId: saved.id } });
    },
  });
  const update = useMutation({ ...actions.updateMarketingDocument, onSuccess: invalidate });
  const publish = useMutation({ ...actions.publishMarketingDocument, onSuccess: invalidate });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (document === undefined) create.mutate({ slug, title, content });
    else update.mutate({ documentId: document.id, title, content });
  };
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const published = versions.filter((version) => version.publishedAt !== null);

  return (
    <>
      <SectionCard
        title={t.marketing.documentDetails}
        onSubmit={submit}
        actions={
          <>
            {document === undefined ? null : (
              <Button type="button" variant="outlined" disabled={publish.isPending} onClick={() => publish.mutate({ documentId: document.id })}>
                {publish.isPending ? t.marketing.publishing : t.marketing.publish}
              </Button>
            )}
            <Button type="submit" variant="contained" disabled={create.isPending || update.isPending}>
              {create.isPending || update.isPending
                ? t.marketing.saving
                : document === undefined
                  ? t.marketing.createDocumentAction
                  : t.marketing.saveDocumentAction}
            </Button>
          </>
        }
      >
        <FormControl fullWidth>
          <FormLabel htmlFor="marketing-document-slug">{t.marketing.slugLabel}</FormLabel>
          <OutlinedInput id="marketing-document-slug" value={slug} onChange={(event) => setSlug(event.target.value)} disabled={document !== undefined} required />
        </FormControl>
        <FormControl fullWidth>
          <FormLabel htmlFor="marketing-document-title">{t.marketing.titleLabel}</FormLabel>
          <OutlinedInput id="marketing-document-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
        </FormControl>
        <FormControl fullWidth>
          <FormLabel htmlFor="marketing-document-markdown">{t.marketing.markdownLabel}</FormLabel>
          <OutlinedInput id="marketing-document-markdown" value={content} onChange={(event) => setContent(event.target.value)} multiline minRows={12} required />
        </FormControl>
        {create.isError || update.isError || publish.isError ? <Alert>{localizeError(create.error ?? update.error ?? publish.error, t)}</Alert> : null}
      </SectionCard>
      {document === undefined || published.length === 0 ? null : (
        <SectionCard title={t.marketing.publicUrls}>
          <Stack spacing="0.75rem">
            <Typography variant="body2">
              {t.marketing.latestUrl}: <MuiLink href={`${origin}/legal/${document.slug}`} target="_blank" rel="noreferrer">{`${origin}/legal/${document.slug}`}</MuiLink>
            </Typography>
            {published.toSorted((a, b) => b.version - a.version).map((version) => (
              <Typography key={version.id} variant="body2">
                {t.marketing.immutableUrl({ version: version.version })}: <MuiLink href={`${origin}/legal/${document.slug}/v/${version.version}`} target="_blank" rel="noreferrer">{`${origin}/legal/${document.slug}/v/${version.version}`}</MuiLink>
              </Typography>
            ))}
          </Stack>
        </SectionCard>
      )}
      {document === undefined ? null : (
        <SectionCard title={t.marketing.versions}>
          <Stack spacing="0.75rem">
            {versions.toSorted((a, b) => b.version - a.version).map((version) => (
              <MarketingSummaryRow
                key={version.id}
                title={t.marketing.versionEntry({ version: version.version, date: formatDateTime(version.createdAt, language) })}
                chips={<Chip size="small" variant="outlined" label={version.publishedAt === null ? t.marketing.draft : t.marketing.published} />}
                summary={version.content}
              />
            ))}
          </Stack>
        </SectionCard>
      )}
    </>
  );
};

export const DocumentsPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const documents = useQuery(actions.marketingDocuments);
  const navigate = useNavigate();
  return (
    <PanelPage title={t.marketing.documentsTitle} description={t.marketing.documentsDescription} action={<Button component={Link} to="/panel/marketing/documents/new" variant="contained">+ {t.common.add}</Button>}>
      <ListSection isEmpty={documents.isSuccess && documents.data.documents.length === 0} empty={<StatusView state={{ kind: 'empty', title: t.marketing.documentsEmpty, action: <Button component={Link} to="/panel/marketing/documents/new">+ {t.common.add}</Button> }} />}>
        {documents.isPending ? <StatusView state={{ kind: 'loading', label: t.marketing.documentsLoading }} /> : documents.isError ? <StatusView state={{ kind: 'error', message: localizeError(documents.error, t) }} /> : (
          <Stack spacing="1rem">
            {documents.data.documents.map((document) => (
              <MarketingSummaryRow
                key={document.id}
                title={document.title}
                chips={<Chip size="small" label={document.status === 'published' ? t.marketing.published : t.marketing.draft} />}
                summary={`/legal/${document.slug}`}
                date={formatDateTime(document.updatedAt, language)}
                actions={<Button onClick={() => void navigate({ to: '/panel/marketing/documents/$documentId', params: { documentId: document.id } })}>{t.marketing.documentDetails}</Button>}
                testId="marketing-document-row"
              />
            ))}
          </Stack>
        )}
      </ListSection>
    </PanelPage>
  );
};

export const DocumentCreatePage = () => {
  const t = useTranslations();
  return <PanelPage title={t.marketing.newDocument} backTo={{ label: t.marketing.allDocuments, href: '/panel/marketing/documents' }}><DocumentForm /></PanelPage>;
};

export const DocumentDetailPage = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const params = useParams({ strict: false });
  const document = useQuery(actions.marketingDocument(params.documentId ?? ''));
  if (document.isPending) return <PanelPage title={t.marketing.documentsTitle} state={{ kind: 'loading', label: t.marketing.documentsLoading }} />;
  if (document.isError) return <PanelPage title={t.marketing.documentsTitle} state={{ kind: 'error', message: localizeError(document.error, t) }} />;
  if (params.documentId === undefined) return <Navigate to="/panel/marketing/documents" />;
  return (
    <PanelPage title={document.data.document.title} backTo={{ label: t.marketing.allDocuments, href: '/panel/marketing/documents' }}>
      <DocumentForm document={document.data.document} versions={document.data.versions} key={`${document.data.document.updatedAt}-${language}`} />
    </PanelPage>
  );
};
