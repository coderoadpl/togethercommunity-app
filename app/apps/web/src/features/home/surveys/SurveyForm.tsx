import { useState } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import type { PublicSurvey } from '#core/domain/index.js';
import { SurveyHeading, SurveyScaleButton, SurveySurface } from '../../../theme.js';
import { PostContent } from '../../../components/ui/PostContent.js';
import { useTranslations } from '../../../i18n/index.js';

export const SurveyEnding = ({ html }: { html: string }) => {
  const t = useTranslations();
  return <SurveySurface variant="outlined" sx={{ maxWidth: '48rem', mx: 'auto', p: { xs: 3, sm: 5 } }} data-testid="survey-form-card"><Stack spacing={3} role="status" data-testid="survey-ending"><Typography variant="h1">{t.surveys.thankYou}</Typography><PostContent html={html} format="markdown" /></Stack></SurveySurface>;
};

export const SurveyForm = ({ survey, onSubmit, pending = false, error, endingHtml }: {
  survey: Pick<PublicSurvey, 'question' | 'type' | 'commentEnabled' | 'commentPrompt'>;
  onSubmit: (score: number, comment: string, website: string) => void;
  pending?: boolean;
  error?: string | undefined;
  endingHtml?: string | undefined;
}) => {
  const t = useTranslations();
  const [score, setScore] = useState<number>();
  const [comment, setComment] = useState('');
  const [website, setWebsite] = useState('');
  const scores = Array.from({ length: survey.type === 'nps' ? 11 : 5 }, (_, index) => index + (survey.type === 'nps' ? 0 : 1));
  return endingHtml !== undefined ? <SurveyEnding html={endingHtml} /> : <SurveySurface variant="outlined" sx={{ maxWidth: '48rem', mx: 'auto', p: { xs: 3, sm: 5 } }} data-testid="survey-form-card">
    <Stack component="form" spacing={3} onSubmit={(event) => { event.preventDefault(); if (score !== undefined && !pending) onSubmit(score, comment, website); }}>
      <Typography variant="overline" color="text.secondary">{t.surveys.intro}</Typography>
      <SurveyHeading variant="h1">{survey.question}</SurveyHeading>
      <Box>
        <Box role="group" aria-label={t.surveys.score} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {scores.map((value) => <SurveyScaleButton scaleType={survey.type} key={value} type="button" aria-label={`${t.surveys.score} ${value}`} aria-pressed={score === value} variant={score === value ? 'contained' : 'outlined'} disabled={pending} onClick={() => setScore(value)} sx={{ minWidth: survey.type === 'stars' ? '3rem' : '2.75rem', height: '3rem', flex: '1 0 2.75rem', maxWidth: '4.25rem' }}>{survey.type === 'stars' ? <span aria-hidden="true">{score !== undefined && value <= score ? '★' : '☆'}</span> : value}</SurveyScaleButton>)}
        </Box>
        <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 1 }}><Typography variant="caption" color="text.secondary">{t.surveys.low}</Typography><Typography variant="caption" color="text.secondary">{t.surveys.high}</Typography></Stack>
      </Box>
      {survey.commentEnabled ? <TextField label={survey.commentPrompt || t.surveys.comment} value={comment} onChange={(event) => setComment(event.target.value)} multiline minRows={3} disabled={pending} helperText={t.surveys.optional} slotProps={{ htmlInput: { maxLength: 2000 } }} /> : null}
      <Box sx={{ display: 'none' }} aria-hidden="true"><input name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></Box>
      {error === undefined ? null : <Alert severity="error">{error}</Alert>}
      <Button type="submit" variant="contained" size="large" disabled={score === undefined || pending}>{pending ? t.surveys.submitting : t.surveys.submit}</Button>
    </Stack>
  </SurveySurface>;
};
