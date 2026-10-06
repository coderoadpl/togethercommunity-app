import { Box, Button, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { SurveyCommentCell } from '../../../theme.js';
import { formatDateTime } from '../../../lib/format.js';
import { Link } from '@tanstack/react-router';
import type { SurveyResults as SurveyResultsData } from '#core/domain/index.js';
import { ResponsiveTable, SectionCard, StatusView } from '../../../components/layout/index.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';

export const SurveyResults = ({ results, type, onPage, onExport, pending = false }: { results: SurveyResultsData; type: 'nps' | 'stars'; onPage: (page: number) => void; onExport: () => void; pending?: boolean }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  return <Stack spacing={3} data-testid="survey-results">
    <SectionCard title={t.surveys.results}><Stack spacing={3}><Stack direction="row" spacing={4}><Box><Typography color="text.secondary">{t.surveys.count}</Typography><Typography variant="h2">{results.count}</Typography></Box><Box><Typography color="text.secondary">{type === 'nps' ? t.surveys.npsScore : t.surveys.average}</Typography><Typography variant="h2">{(type === 'nps' ? results.nps : results.average)?.toLocaleString(language, { maximumFractionDigits: 2 }) ?? '—'}</Typography></Box></Stack>
      <Typography variant="h3">{t.surveys.distribution}</Typography><Stack spacing={1}>{results.distribution.map(({ score, count }) => <Stack direction="row" spacing={2} key={score} sx={{ alignItems: 'center' }}><Typography sx={{ width: '2rem' }}>{score}</Typography><LinearProgress variant="determinate" value={results.count === 0 ? 0 : count / results.count * 100} aria-label={`${t.surveys.score} ${score}`} sx={{ flex: 1, height: 10 }} /><Typography sx={{ minWidth: '2rem' }}>{count}</Typography></Stack>)}</Stack>
    </Stack></SectionCard>
    <SectionCard title={t.surveys.responses}><Stack spacing={2}><Button onClick={onExport} disabled={pending} sx={{ alignSelf: 'flex-start' }}>{t.surveys.export}</Button>{results.responses.length === 0 ? <StatusView state={{ kind: 'empty', title: t.surveys.noResponses }} /> : <ResponsiveTable><Table aria-label={t.surveys.responses}><TableHead><TableRow>{[t.surveys.member, t.surveys.score, t.surveys.comment, t.surveys.date].map((label) => <TableCell key={label}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{results.responses.map((response) => <TableRow key={response.id}><TableCell>{response.memberId === null ? t.surveys.anonymous : <Link to="/panel/members/$memberId" params={{ memberId: response.memberId }}>{response.memberName ?? response.memberId}</Link>}</TableCell><TableCell>{response.score}</TableCell><SurveyCommentCell sx={{ minWidth: '12rem' }}>{response.comment || '—'}</SurveyCommentCell><TableCell>{formatDateTime(response.updatedAt, language)}</TableCell></TableRow>)}</TableBody></Table></ResponsiveTable>}
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}><Button disabled={results.page <= 1 || pending} onClick={() => onPage(results.page - 1)}>{t.surveys.previous}</Button><Typography>{results.page} / {Math.max(1, results.totalPages)}</Typography><Button disabled={results.page >= results.totalPages || pending} onClick={() => onPage(results.page + 1)}>{t.surveys.next}</Button></Stack>
    </Stack></SectionCard>
  </Stack>;
};
