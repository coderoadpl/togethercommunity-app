import { useState, type ReactNode } from 'react';
import { Alert, Button, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { surveyInputSchema, type Survey, type SurveyInput } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { SectionCard } from '../../../components/layout/index.js';
import { MarkdownEditor } from '../../../components/ui/MarkdownEditor.js';
import { PostContent } from '../../../components/ui/PostContent.js';
import { nativeValidityProps } from '../../../components/ui/native-validity.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { SurveyForm } from './SurveyForm.js';

const EndingPreview = ({ body }: { body: string }) => {
  const t = useTranslations();
  const preview = useMutation(actions.surveys.preview);
  const [shownBody, setShownBody] = useState('');
  return <Stack spacing={2}><Button onClick={() => { setShownBody(body); preview.mutate({ body }); }} disabled={preview.isPending}>{t.surveys.previewEnding}</Button>{preview.data === undefined || shownBody !== body ? null : <PostContent html={preview.data.html} format="markdown" />}{preview.error === null ? null : <Alert severity="error">{localizeError(preview.error, t)}</Alert>}</Stack>;
};

export const SurveyEditor = ({ survey, onSave, onCancel, pending = false, error, branding }: { survey: Survey | null; onSave: (input: SurveyInput) => void; onCancel: () => void; pending?: boolean; error?: string | undefined; branding?: ReactNode }) => {
  const t = useTranslations();
  const [title, setTitle] = useState(survey?.title ?? '');
  const [question, setQuestion] = useState(survey?.question ?? t.surveys.defaultQuestion);
  const [slug, setSlug] = useState(survey?.slug ?? '');
  const [type, setType] = useState<'nps' | 'stars'>(survey?.type ?? 'nps');
  const [commentEnabled, setCommentEnabled] = useState(survey?.commentEnabled ?? true);
  const [commentPrompt, setCommentPrompt] = useState(survey?.commentPrompt ?? t.surveys.defaultComment);
  const [active, setActive] = useState(survey?.active ?? false);
  const [firstMax, setFirstMax] = useState(survey?.endings[0]?.max ?? 6);
  const [secondMax, setSecondMax] = useState(survey?.endings[1]?.max ?? 8);
  const [bodies, setBodies] = useState(survey?.endings.map((ending) => ending.body) ?? [t.surveys.defaultEnding, t.surveys.defaultEnding, t.surveys.defaultEnding]);
  const [invalid, setInvalid] = useState(false);
  const ranges = [{ min: type === 'nps' ? 0 : 1, max: firstMax }, { min: firstMax + 1, max: secondMax }, { min: secondMax + 1, max: type === 'nps' ? 10 : 5 }];
  const save = () => {
    const parsed = surveyInputSchema.safeParse({ title, question, slug, type, commentEnabled, commentPrompt, active, endings: ranges.map((range, index) => ({ ...range, body: bodies[index] ?? '' })) });
    setInvalid(!parsed.success);
    if (parsed.success) onSave(parsed.data);
  };
  return <Stack spacing={3} data-testid="survey-editor">
    <SectionCard title={survey === null ? t.surveys.create : t.surveys.edit} description={t.surveys.editHelp}><Stack component="form" spacing={2} onSubmit={(event) => { event.preventDefault(); save(); }}>
      <TextField label={t.surveys.internalTitle} value={title} onChange={(event) => setTitle(event.target.value)} required slotProps={{ htmlInput: { maxLength: 200, ...nativeValidityProps(t.common.requiredField) } }} />
      <TextField label={t.surveys.question} value={question} onChange={(event) => setQuestion(event.target.value)} required slotProps={{ htmlInput: { maxLength: 1000, ...nativeValidityProps(t.common.requiredField) } }} />
      <TextField label={t.surveys.slug} value={slug} onChange={(event) => setSlug(event.target.value)} required slotProps={{ htmlInput: { maxLength: 80, ...nativeValidityProps(t.common.requiredField) } }} />
      <TextField select label={t.surveys.type} value={type} onChange={(event) => { const next = event.target.value === 'stars' ? 'stars' : 'nps'; setType(next); setFirstMax(next === 'stars' ? 3 : 6); setSecondMax(next === 'stars' ? 4 : 8); }}><MenuItem value="nps">{t.surveys.nps}</MenuItem><MenuItem value="stars">{t.surveys.stars}</MenuItem></TextField>
      <FormControlLabel control={<Switch checked={commentEnabled} onChange={(_, checked) => setCommentEnabled(checked)} />} label={t.surveys.commentEnabled} />
      {commentEnabled ? <TextField label={t.surveys.commentPrompt} value={commentPrompt} onChange={(event) => setCommentPrompt(event.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} /> : null}
      <FormControlLabel control={<Switch checked={active} onChange={(_, checked) => setActive(checked)} />} label={t.surveys.active} />
      <Typography variant="h2">{t.surveys.endings}</Typography><Typography color="text.secondary">{t.surveys.endingHelp}</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField type="number" label={`${t.surveys.ending} 1 · ${t.surveys.upperScore}`} value={firstMax} onChange={(event) => setFirstMax(Number(event.target.value))} /><TextField type="number" label={`${t.surveys.ending} 2 · ${t.surveys.upperScore}`} value={secondMax} onChange={(event) => setSecondMax(Number(event.target.value))} /></Stack>
      {ranges.map((range, index) => <Stack spacing={1} key={index}><Typography variant="h3">{t.surveys.ending} {index + 1} · {range.min}–{range.max}</Typography><MarkdownEditor aria-label={`${t.surveys.ending} ${index + 1}`} value={bodies[index] ?? ''} onChange={(body) => setBodies((current) => current.map((value, bodyIndex) => bodyIndex === index ? body : value))} minRows={3} maxLength={20000} /><EndingPreview body={bodies[index] ?? ''} /></Stack>)}
      {invalid ? <Alert severity="error">{t.surveys.invalid}</Alert> : null}{error === undefined ? null : <Alert severity="error">{error}</Alert>}
      <Stack direction="row" spacing={1}><Button type="submit" variant="contained" disabled={pending}>{t.common.save}</Button><Button onClick={onCancel} disabled={pending}>{t.common.cancel}</Button></Stack>
    </Stack></SectionCard>
    <SectionCard title={t.surveys.preview}><Stack spacing={3}>{branding}<SurveyForm key={type} survey={{ question, type, commentEnabled, commentPrompt }} onSubmit={() => undefined} /></Stack></SectionCard>
  </Stack>;
};
