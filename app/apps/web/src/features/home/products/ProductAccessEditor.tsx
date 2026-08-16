import { Fragment, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListSubheader,
  MenuItem,
  Select,
  Stack,
  Switch,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AccessItem, Course, CourseModule, Product } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { StatusView } from '../../../components/layout/index.js';
import { localizeError, useTranslations, type Messages } from '../../../i18n/index.js';
import { MutationError } from '../courses/feedback.js';

type AccessLevel = 'course' | 'modules' | 'lessons';

const courseName = (courses: Course[], courseId: string, t: Messages): string =>
  courses.find((course) => course.id === courseId)?.name ?? t.access.unknownCourse;

const joinNames = (names: string[], t: Messages): { label: string; full?: string } => {
  if (names.length <= 3) return { label: names.join(', ') };
  return {
    label: `${names.slice(0, 3).join(', ')}, ${t.access.andMore({ count: names.length - 3 })}`,
    full: names.join(', '),
  };
};

const accessItemSummary = (
  item: AccessItem,
  courses: Course[],
  moduleNames: Map<string, string>,
  lessonNames: Map<string, string>,
  t: Messages,
): { label: string; full?: string } => {
  const course = courseName(courses, item.courseId, t);
  if (item.level === 'course') {
    const excluded = item.excludedModuleIds ?? [];
    if (excluded.length === 0) return { label: t.access.wholeCourseSummary({ course }) };
    const modules = joinNames(
      excluded.map((id) => moduleNames.get(id) ?? t.access.unknownModule),
      t,
    );
    return {
      label: t.access.wholeCourseExceptSummary({ course, modules: modules.label }),
      ...(modules.full ? { full: modules.full } : {}),
    };
  }
  if (item.level === 'lessons') {
    const lessons = joinNames(
      item.lessonIds.map((id) => lessonNames.get(id) ?? t.access.unknownLesson),
      t,
    );
    return {
      label: t.access.lessonsSummary({ lessons: lessons.label }),
      ...(lessons.full ? { full: lessons.full } : {}),
    };
  }
  const modules = joinNames(
    item.moduleIds.map((id) => moduleNames.get(id) ?? t.access.unknownModule),
    t,
  );
  return {
    label: t.access.modulesSummary({ modules: modules.label }),
    ...(modules.full ? { full: modules.full } : {}),
  };
};

const courseModules = (modules: CourseModule[], courseId: string): CourseModule[] =>
  modules.filter((module) => module.courseIds.includes(courseId));

const courseLessonIds = (modules: CourseModule[], courseId: string): Set<string> => {
  const ids = new Set<string>();
  for (const module of courseModules(modules, courseId)) {
    for (const chapter of module.chapters) {
      for (const content of chapter.contents) ids.add(content.lessonId);
    }
  }
  return ids;
};

const toggle = (values: string[], id: string): string[] =>
  values.includes(id) ? values.filter((value) => value !== id) : [...values, id];

export const ProductAccessEditor = ({ product }: { product: Product }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const courses = useQuery(actions.courses);
  const modules = useQuery(actions.modules);
  const lessons = useQuery(actions.lessons);

  const [items, setItems] = useState<AccessItem[]>(product.accessItems);
  const [pro, setPro] = useState(false);
  const [courseId, setCourseId] = useState('');
  const [level, setLevel] = useState<AccessLevel>('course');
  const [moduleIds, setModuleIds] = useState<string[]>([]);
  const [lessonIds, setLessonIds] = useState<string[]>([]);
  const [excludedModuleIds, setExcludedModuleIds] = useState<string[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const save = useMutation({
    ...actions.updateProductAccessItems,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.productsInvalidates());
    },
  });

  const resetDraft = () => {
    setCourseId('');
    setLevel('course');
    setModuleIds([]);
    setLessonIds([]);
    setExcludedModuleIds([]);
    setEditingIndex(null);
  };

  const pickCourse = (nextCourseId: string) => {
    setCourseId(nextCourseId);
    setModuleIds([]);
    setLessonIds([]);
    setExcludedModuleIds([]);
  };

  const availableModules = useMemo(
    () => (modules.data && courseId ? courseModules(modules.data.modules, courseId) : []),
    [modules.data, courseId],
  );

  const availableLessons = useMemo(() => {
    if (!lessons.data || !modules.data || !courseId) return [];
    const ids = courseLessonIds(modules.data.modules, courseId);
    return lessons.data.lessons.filter((lesson) => ids.has(lesson.id));
  }, [lessons.data, modules.data, courseId]);

  const moduleNames = useMemo(
    () => new Map((modules.data?.modules ?? []).map((module) => [module.id, module.name])),
    [modules.data],
  );

  const lessonNames = useMemo(
    () => new Map((lessons.data?.lessons ?? []).map((lesson) => [lesson.id, lesson.name])),
    [lessons.data],
  );

  const itemGroups = useMemo(() => {
    const groups = new Map<string, { item: AccessItem; index: number }[]>();
    items.forEach((item, index) => {
      const group = groups.get(item.courseId) ?? [];
      group.push({ item, index });
      groups.set(item.courseId, group);
    });
    return [...groups.entries()];
  }, [items]);

  const appendItem = (item: AccessItem) => {
    setItems([...items, item]);
    resetDraft();
  };

  const addFullCourse = () => {
    if (!courseId) return;
    appendItem({ level: 'course', courseId });
  };

  const proDraftValid =
    courseId !== '' &&
    (level === 'course' ||
      (level === 'modules' && moduleIds.length > 0) ||
      (level === 'lessons' && lessonIds.length > 0));

  const addProItem = () => {
    if (!proDraftValid) return;
    let item: AccessItem;
    if (level === 'modules') {
      item = { level: 'modules', courseId, moduleIds };
    } else if (level === 'lessons') {
      item = { level: 'lessons', courseId, lessonIds };
    } else {
      item = {
        level: 'course',
        courseId,
        ...(excludedModuleIds.length > 0 ? { excludedModuleIds } : {}),
      };
    }
    setItems(editingIndex === null ? [...items, item] : items.map((current, index) => (index === editingIndex ? item : current)));
    resetDraft();
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_item, position) => position !== index));
    if (editingIndex !== null) resetDraft();
  };

  const startEdit = (index: number) => {
    const item = items[index];
    if (!item) return;
    setPro(true);
    setEditingIndex(index);
    setCourseId(item.courseId);
    setLevel(item.level);
    setModuleIds(item.level === 'modules' ? item.moduleIds : []);
    setLessonIds(item.level === 'lessons' ? item.lessonIds : []);
    setExcludedModuleIds(item.level === 'course' ? (item.excludedModuleIds ?? []) : []);
  };

  if (courses.isPending || modules.isPending || lessons.isPending) {
    return <Typography variant="body2">{t.access.loading}</Typography>;
  }
  if (courses.isError) return <StatusView surface={false} state={{ kind: 'error', message: localizeError(courses.error, t), retry: { label: t.common.retry, onRetry: () => void courses.refetch() } }} />;
  if (modules.isError) return <StatusView surface={false} state={{ kind: 'error', message: localizeError(modules.error, t), retry: { label: t.common.retry, onRetry: () => void modules.refetch() } }} />;
  if (lessons.isError) return <StatusView surface={false} state={{ kind: 'error', message: localizeError(lessons.error, t), retry: { label: t.common.retry, onRetry: () => void lessons.refetch() } }} />;

  const dirty = JSON.stringify(items) !== JSON.stringify(product.accessItems);

  const courseSelect = (
    <FormControl size="small" fullWidth>
      <FormLabel htmlFor={`access-course-${product.id}`}>{t.access.courseLabel}</FormLabel>
      <Select
        id={`access-course-${product.id}`}
        displayEmpty
        value={courseId}
        onChange={(event) => pickCourse(event.target.value)}
        inputProps={{ 'aria-label': t.access.courseLabel }}
      >
        <MenuItem value="">
          <em>{t.access.selectCourse}</em>
        </MenuItem>
        {courses.data.courses.map((course) => (
          <MenuItem key={course.id} value={course.id}>
            {course.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  return (
    <Stack useFlexGap spacing="1rem" data-testid={`access-editor-${product.id}`}>
      <Box>
        <Typography variant="overline" component="h3">
          {t.access.heading}
        </Typography>
        {items.length === 0 ? (
          <Typography variant="body2">{t.access.empty}</Typography>
        ) : (
          <List disablePadding dense>
            {itemGroups.map(([groupCourseId, entries]) => (
              <Fragment key={groupCourseId}>
                <ListSubheader disableSticky disableGutters>
                  {courseName(courses.data.courses, groupCourseId, t)}
                </ListSubheader>
                {entries.map(({ item, index }) => {
                  const summary = accessItemSummary(item, courses.data.courses, moduleNames, lessonNames, t);
                  const primary = <Typography variant="body2">{summary.label}</Typography>;
                  return (
                    <ListItem
                      key={`${item.courseId}-${index}`}
                      disableGutters
                      disablePadding
                      data-testid="access-item"
                      secondaryAction={
                        <Stack direction="row">
                          <Button size="small" variant="text" onClick={() => startEdit(index)}>
                            {t.access.editItem}
                          </Button>
                          <Button size="small" variant="text" color="error" onClick={() => removeItem(index)}>
                            {t.common.remove}
                          </Button>
                        </Stack>
                      }
                    >
                      <ListItemButton selected={index === editingIndex} disableGutters onClick={() => startEdit(index)}>
                        <ListItemText
                          primary={summary.full ? <Tooltip title={summary.full}>{primary}</Tooltip> : primary}
                        />
                      </ListItemButton>
                    </ListItem>
                  );
                })}
              </Fragment>
            ))}
          </List>
        )}
      </Box>

      <Box>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={pro}
              onChange={(event) => {
                setPro(event.target.checked);
                resetDraft();
              }}
            />
          }
          label={t.access.proMode}
        />
        <FormHelperText data-testid="pro-mode-hint">{t.access.proModeHint}</FormHelperText>
      </Box>

      {pro ? (
        <Box sx={{ display: 'grid', gap: '0.75rem' }}>
          {courseSelect}

          {courseId ? (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={level}
              onChange={(_event, value: AccessLevel | null) => {
                if (value) setLevel(value);
              }}
              aria-label={t.access.levelAria}
            >
              <ToggleButton value="course" data-testid="level-course">
                {t.access.wholeCourse}
              </ToggleButton>
              <ToggleButton value="modules" data-testid="level-modules">
                {t.access.selectedModules}
              </ToggleButton>
              <ToggleButton value="lessons" data-testid="level-lessons">
                {t.access.selectedLessons}
              </ToggleButton>
            </ToggleButtonGroup>
          ) : null}

          {courseId && level === 'course' ? (
            <Box role="group" aria-label={t.access.exclusionsLabel} sx={{ display: 'grid', gap: '0.2rem' }}>
              <FormLabel component="div">{t.access.exclusionsLabel}</FormLabel>
              {availableModules.length === 0 ? (
                <Typography variant="body2">{t.access.noModulesToExclude}</Typography>
              ) : (
                availableModules.map((module) => (
                  <FormControlLabel
                    key={module.id}
                    control={
                      <Checkbox
                        size="small"
                        checked={excludedModuleIds.includes(module.id)}
                        onChange={() => setExcludedModuleIds(toggle(excludedModuleIds, module.id))}
                      />
                    }
                    label={module.name}
                  />
                ))
              )}
            </Box>
          ) : null}

          {courseId && level === 'modules' ? (
            <Box role="group" aria-label={t.access.modulesLabel} sx={{ display: 'grid', gap: '0.2rem' }}>
              <FormLabel component="div">{t.access.modulesLabel}</FormLabel>
              {availableModules.length === 0 ? (
                <Typography variant="body2">{t.access.noModulesInCourse}</Typography>
              ) : (
                availableModules.map((module) => (
                  <FormControlLabel
                    key={module.id}
                    control={
                      <Checkbox
                        size="small"
                        checked={moduleIds.includes(module.id)}
                        onChange={() => setModuleIds(toggle(moduleIds, module.id))}
                      />
                    }
                    label={module.name}
                  />
                ))
              )}
            </Box>
          ) : null}

          {courseId && level === 'lessons' ? (
            <Box role="group" aria-label={t.access.lessonsLabel} sx={{ display: 'grid', gap: '0.2rem' }}>
              <FormLabel component="div">{t.access.lessonsLabel}</FormLabel>
              {availableLessons.length === 0 ? (
                <Typography variant="body2">{t.access.noLessonsInCourse}</Typography>
              ) : (
                availableLessons.map((lesson) => (
                  <FormControlLabel
                    key={lesson.id}
                    control={
                      <Checkbox
                        size="small"
                        checked={lessonIds.includes(lesson.id)}
                        onChange={() => setLessonIds(toggle(lessonIds, lesson.id))}
                      />
                    }
                    label={lesson.name}
                  />
                ))
              )}
            </Box>
          ) : null}

          <Box>
            <Button size="small" variant="outlined" disabled={!proDraftValid} onClick={addProItem}>
              {editingIndex === null ? t.access.addItem : t.access.updateItem}
            </Button>
            {editingIndex !== null ? (
              <Button size="small" variant="text" onClick={resetDraft}>
                {t.common.cancel}
              </Button>
            ) : null}
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gap: '0.75rem' }}>
          {courseSelect}
          <Box>
            <Button size="small" variant="outlined" disabled={!courseId} onClick={addFullCourse}>
              {t.access.addFullCourse}
            </Button>
          </Box>
        </Box>
      )}

      <Stack direction="row" useFlexGap spacing="1rem" sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ id: product.id, accessItems: items })}
        >
          {save.isPending ? t.access.saving : t.access.save}
        </Button>
        {save.isSuccess && !dirty ? <Chip label={t.access.saved} variant="outlined" color="success" /> : null}
      </Stack>

      {save.isError ? <MutationError error={save.error} /> : null}
    </Stack>
  );
};
