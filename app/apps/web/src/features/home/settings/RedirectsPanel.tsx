import { useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  FormLabel,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  normalizeRedirectPath,
  TENANT_REDIRECT_PAGE_SIZE,
  type CourseModule,
  type TenantRedirect,
} from '#core/domain/index.js';

import { actions } from '../../../api.js';
import {
  ConfirmDialog,
  ListSection,
  PanelPage,
  ResponsiveTable,
  SectionCard,
  StatusView,
} from '../../../components/layout/index.js';
import { SearchField, useDebouncedValue } from '../../../components/ui/SearchField.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';
import { PathText } from '../../../theme.js';
import { PanelBackLink } from '../PanelBackLink.js';

type TargetKind = 'course' | 'lesson' | 'path';

const isTargetKind = (value: string): value is TargetKind =>
  value === 'course' || value === 'lesson' || value === 'path';

const lastPage = (total: number): number =>
  Math.max(0, Math.ceil(total / TENANT_REDIRECT_PAGE_SIZE) - 1);

const courseLessonIds = (modules: CourseModule[], courseId: string): Set<string> => {
  const ids = new Set<string>();
  for (const module of modules.filter((entry) => entry.courseIds.includes(courseId))) {
    for (const chapter of module.chapters) {
      for (const content of chapter.contents) ids.add(content.lessonId);
    }
  }
  return ids;
};

const AddRedirectForm = ({ onCreated }: { onCreated: (fromPath: string) => void }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const courses = useQuery(actions.courses);
  const modules = useQuery(actions.modules);
  const lessons = useQuery(actions.lessons);
  const create = useMutation(actions.createTenantRedirect);
  const [fromPath, setFromPath] = useState('');
  const [targetKind, setTargetKind] = useState<TargetKind>('course');
  const [courseId, setCourseId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [permanent, setPermanent] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const courseOptions = courses.data?.courses ?? [];
  const lessonOptions = useMemo(() => {
    if (modules.data === undefined || lessons.data === undefined || courseId === '') return [];
    const ids = courseLessonIds(modules.data.modules, courseId);
    return lessons.data.lessons.filter((lesson) => ids.has(lesson.id));
  }, [modules.data, lessons.data, courseId]);

  const preview = fromPath.trim().length === 0 ? null : normalizeRedirectPath(fromPath);

  const target = () => {
    if (targetKind === 'path') return { kind: 'path' as const, path: targetPath.trim() };
    if (targetKind === 'course') return { kind: 'course' as const, courseId };
    return { kind: 'lesson' as const, courseId, lessonId };
  };

  const ready = preview !== null
    && (targetKind === 'path'
      ? targetPath.trim().length > 0
      : targetKind === 'course'
        ? courseId !== ''
        : courseId !== '' && lessonId !== '');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      const created = await create.mutateAsync({ fromPath, target: target(), permanent });
      await queryClient.invalidateQueries(actions.tenantRedirectsInvalidates());
      setFromPath('');
      setTargetPath('');
      setLessonId('');
      onCreated(created.redirect.fromPath);
    } catch (cause) {
      setError(localizePanelError(cause, t));
    }
  };

  return (
    <SectionCard
      title={t.redirects.addHeading}
      onSubmit={(event) => void submit(event)}
      data-testid="redirect-add"
      actions={(
        <Button type="submit" variant="contained" disabled={!ready || create.isPending}>
          {create.isPending ? t.redirects.submitting : t.redirects.submit}
        </Button>
      )}
    >
      <TextField
        label={t.redirects.addSource}
        value={fromPath}
        onChange={(event) => setFromPath(event.target.value)}
        helperText={t.redirects.addSourceHint}
        slotProps={{ htmlInput: { 'data-testid': 'redirect-from-path' } }}
        fullWidth
      />
      {preview === null ? null : (
        <PathText data-testid="redirect-from-path-preview">
          {t.redirects.addSourcePreview({ path: preview })}
        </PathText>
      )}
      <FormControl>
        <FormLabel id="redirect-target-kind">{t.redirects.targetLegend}</FormLabel>
        <RadioGroup
          row
          aria-labelledby="redirect-target-kind"
          value={targetKind}
          onChange={(event) => {
            if (isTargetKind(event.target.value)) setTargetKind(event.target.value);
          }}
        >
          <FormControlLabel value="course" control={<Radio />} label={t.redirects.targetCourse} />
          <FormControlLabel value="lesson" control={<Radio />} label={t.redirects.targetLesson} />
          <FormControlLabel value="path" control={<Radio />} label={t.redirects.targetPath} />
        </RadioGroup>
      </FormControl>
      {targetKind === 'path' ? (
        <TextField
          label={t.redirects.targetPathLabel}
          value={targetPath}
          onChange={(event) => setTargetPath(event.target.value)}
          helperText={t.redirects.targetPathHint}
          slotProps={{ htmlInput: { 'data-testid': 'redirect-target-path' } }}
          fullWidth
        />
      ) : (
        <Stack useFlexGap spacing="1rem">
          <FormControl size="small" fullWidth>
            <InputLabel id="redirect-course-label">{t.redirects.targetCourseLabel}</InputLabel>
            <Select
              labelId="redirect-course-label"
              label={t.redirects.targetCourseLabel}
              value={courseId}
              data-testid="redirect-target-course"
              onChange={(event) => {
                setCourseId(event.target.value);
                setLessonId('');
              }}
            >
              {courseOptions.map((course) => (
                <MenuItem key={course.id} value={course.id}>{course.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {courseOptions.length === 0 && courses.isSuccess ? (
            <Typography variant="body2">{t.redirects.coursesEmpty}</Typography>
          ) : null}
          {targetKind === 'lesson' ? (
            <>
              <FormControl size="small" fullWidth disabled={courseId === ''}>
                <InputLabel id="redirect-lesson-label">{t.redirects.targetLessonLabel}</InputLabel>
                <Select
                  labelId="redirect-lesson-label"
                  label={t.redirects.targetLessonLabel}
                  value={lessonId}
                  data-testid="redirect-target-lesson"
                  onChange={(event) => setLessonId(event.target.value)}
                >
                  {lessonOptions.map((lesson) => (
                    <MenuItem key={lesson.id} value={lesson.id}>{lesson.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              {courseId !== '' && lessonOptions.length === 0 && lessons.isSuccess ? (
                <Typography variant="body2">{t.redirects.lessonsEmpty}</Typography>
              ) : null}
            </>
          ) : null}
        </Stack>
      )}
      <FormControlLabel
        control={(
          <Switch
            checked={permanent}
            onChange={(event) => setPermanent(event.target.checked)}
            slotProps={{ input: { 'aria-label': t.redirects.permanentLabel } }}
            data-testid="redirect-permanent"
          />
        )}
        label={t.redirects.permanentLabel}
      />
      <Typography variant="caption" color="text.secondary">{t.redirects.permanentHint}</Typography>
      {error === null ? null : <Alert severity="error" data-testid="redirect-add-error">{error}</Alert>}
    </SectionCard>
  );
};

export const RedirectsPanel = () => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<TenantRedirect | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);
  const remove = useMutation(actions.deleteTenantRedirect);

  const redirects = useQuery(actions.tenantRedirects({
    ...(debouncedSearch.trim().length === 0 ? {} : { search: debouncedSearch.trim() }),
    limit: TENANT_REDIRECT_PAGE_SIZE,
    offset: page * TENANT_REDIRECT_PAGE_SIZE,
  }));

  const rows = redirects.data?.redirects ?? [];
  const total = redirects.data?.total ?? 0;
  const filtered = debouncedSearch.trim().length > 0;

  const confirmDelete = async () => {
    if (pending === null) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync({ id: pending.id });
      await queryClient.invalidateQueries(actions.tenantRedirectsInvalidates());
      setNotice(t.redirects.deleted);
      setPage((current) => Math.min(current, lastPage(total - 1)));
      setPending(null);
    } catch (cause) {
      setDeleteError(localizePanelError(cause, t));
    }
  };

  return (
    <PanelPage
      title={t.redirects.title}
      description={t.redirects.description}
      backTo={<PanelBackLink to="/panel/settings">{t.redirects.backToSettings}</PanelBackLink>}
    >
      {notice === null ? null : <Alert severity="success" data-testid="redirect-notice">{notice}</Alert>}
      <AddRedirectForm
        onCreated={(fromPath) => {
          setNotice(t.redirects.created({ fromPath }));
          setPage(0);
        }}
      />
      <ListSection
        data-testid="redirects-list"
        isEmpty={redirects.isSuccess && total === 0 && !filtered && page === 0}
        empty={<StatusView state={{ kind: 'empty', title: t.redirects.empty, body: t.redirects.emptyHint }} />}
        noMatches={redirects.isSuccess && rows.length === 0
          ? <StatusView state={{ kind: 'empty', title: t.redirects.noMatches }} />
          : undefined}
        toolbar={{
          search: (
            <SearchField
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
              label={t.redirects.search}
              placeholder={t.redirects.search}
              testId="redirects-search"
            />
          ),
        }}
        pagination={(
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            useFlexGap
            spacing="0.75rem"
            sx={{ alignItems: { sm: 'center' }, justifyContent: 'flex-end' }}
          >
            <Typography variant="body2" data-testid="redirects-total">
              {t.tenantDomains.redirectsCount({ count: total })}
            </Typography>
            <Button disabled={page === 0} onClick={() => setPage((current) => current - 1)}>
              {t.pagination.previousPage}
            </Button>
            <Button
              disabled={(page + 1) * TENANT_REDIRECT_PAGE_SIZE >= total}
              onClick={() => setPage((current) => current + 1)}
            >
              {t.pagination.nextPage}
            </Button>
          </Stack>
        )}
      >
        {redirects.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.redirects.loading }} />
        ) : redirects.isError ? (
          <StatusView state={{ kind: 'error', message: localizePanelError(redirects.error, t), retry: { label: t.common.retry, onRetry: () => void redirects.refetch() } }} />
        ) : (
          <ResponsiveTable>
            <Table size="small" aria-label={t.redirects.title}>
              <TableHead>
                <TableRow>
                  <TableCell>{t.redirects.columnSource}</TableCell>
                  <TableCell>{t.redirects.columnTarget}</TableCell>
                  <TableCell>{t.redirects.columnStatus}</TableCell>
                  <TableCell>{t.redirects.columnOrigin}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((redirect) => (
                  <TableRow key={redirect.id} data-testid={`redirect-row-${redirect.id}`}>
                    <TableCell><PathText>{redirect.fromPath}</PathText></TableCell>
                    <TableCell><PathText>{redirect.targetPath}</PathText></TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={redirect.permanent ? t.redirects.permanent : t.redirects.temporary}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={redirect.origin === 'import'
                          ? t.redirects.originImport
                          : t.redirects.originManual}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        color="error"
                        data-testid={`redirect-delete-${redirect.id}`}
                        onClick={() => {
                          setDeleteError(null);
                          setPending(redirect);
                        }}
                      >
                        {t.redirects.delete}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ResponsiveTable>
        )}
      </ListSection>
      <ConfirmDialog
        open={pending !== null}
        title={t.redirects.deleteConfirmTitle}
        body={(
          <>
            <Typography variant="body1">
              {t.redirects.deleteConfirmBody({ fromPath: pending?.fromPath ?? '' })}
            </Typography>
            {deleteError === null
              ? null
              : <Alert severity="error" data-testid="redirect-delete-error">{deleteError}</Alert>}
          </>
        )}
        confirmLabel={t.redirects.deleteConfirmAction}
        cancelLabel={t.common.cancel}
        pending={remove.isPending}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPending(null)}
        confirmTestId="redirect-delete-confirm"
      />
    </PanelPage>
  );
};
