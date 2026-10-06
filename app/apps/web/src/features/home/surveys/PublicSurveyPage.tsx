import { useState } from 'react';
import { Container, Stack } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ApiError } from '#core/client/index.js';
import { actions } from '../../../api.js';
import { TenantLogo } from '../../../branding.js';
import { StatusView } from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { SurveyEnding, SurveyForm } from './SurveyForm.js';

const PublicSurveyPage = ({ slug }: { slug: string }) => {
  const t = useTranslations();
  const survey = useQuery(actions.surveys.publicSurvey(slug));
  const submit = useMutation(actions.surveys.submit);
  const [endingHtml, setEndingHtml] = useState<string>();
  const notFound = survey.error instanceof ApiError && survey.error.appError.code === 'not_found';
  return <Container component="main" maxWidth="md" sx={{ py: { xs: 5, sm: 9 } }}><Stack spacing={5}><TenantLogo />
    {endingHtml !== undefined ? <SurveyEnding html={endingHtml} /> : survey.isPending ? <StatusView state={{ kind: 'loading', label: t.common.loading }} /> : notFound ? <StatusView state={{ kind: 'not-found', title: t.surveys.notFound, body: t.surveys.notFoundBody }} /> : survey.isError ? <StatusView state={{ kind: 'error', message: localizeError(survey.error, t), retry: { label: t.common.retry, onRetry: () => void survey.refetch() } }} /> : <SurveyForm key={slug} survey={survey.data.survey} pending={submit.isPending} error={submit.error === null ? undefined : localizeError(submit.error, t)} onSubmit={(score, comment, website) => { void submit.mutateAsync({ slug, score, comment, website, token: survey.data.survey.token }).then((result) => setEndingHtml(result.endingHtml)).catch(() => undefined); }} />}
  </Stack></Container>;
};
export const SurveyRoute = () => {
  const params = useParams({ strict: false });
  return <PublicSurveyPage key={params.slug} slug={params.slug ?? ''} />;
};
