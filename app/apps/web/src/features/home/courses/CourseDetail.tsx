import { useState, type FormEvent } from 'react';
import {
  Box,
  Button,
  Divider,
  FormControl,
  FormLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Chapter, Course, CourseLesson, CourseModule } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { useTranslations, type Messages } from '../../../i18n/index.js';
import { CardTitle, Eyebrow, TreeChapterTitle, TreeModuleTitle } from '../../../theme.js';
import { HistoryPanel } from './HistoryPanel.js';
import { MutationError, newId } from './feedback.js';

const lessonName = (lessons: CourseLesson[], lessonId: string, t: Messages): string =>
  lessons.find((lesson) => lesson.id === lessonId)?.name ?? t.courses.unknownLesson;

const ChapterEditor = ({
  chapter,
  lessons,
  onRename,
  onRemove,
  onAddContent,
  onRemoveContent,
  onMoveContent,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  pending,
}: {
  chapter: Chapter;
  lessons: CourseLesson[];
  onRename: (name: string) => void;
  onRemove: () => void;
  onAddContent: (lessonId: string, name: string) => void;
  onRemoveContent: (contentId: string) => void;
  onMoveContent: (contentId: string, direction: -1 | 1) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  pending: boolean;
}) => {
  const t = useTranslations();
  const [name, setName] = useState(chapter.name);
  const [contentName, setContentName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [lessonId, setLessonId] = useState('');

  const selectLesson = (nextLessonId: string) => {
    setLessonId(nextLessonId);
    if (!nameTouched) {
      const picked = lessons.find((lesson) => lesson.id === nextLessonId);
      setContentName(picked ? picked.name : '');
    }
  };

  const duplicate = lessonId !== '' && chapter.contents.some((content) => content.lessonId === lessonId);

  const submitContent = (event: FormEvent) => {
    event.preventDefault();
    if (!lessonId) return;
    const fallback = lessons.find((lesson) => lesson.id === lessonId)?.name ?? '';
    const finalName = contentName.trim().length > 0 ? contentName.trim() : fallback;
    if (finalName.length === 0) return;
    onAddContent(lessonId, finalName);
    setContentName('');
    setLessonId('');
    setNameTouched(false);
  };

  return (
    <Paper variant="outlined" sx={{ p: '0.9rem', display: 'grid', gap: '0.75rem' }}>
      <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <TreeChapterTitle component="span">{t.courses.chapterLabel}</TreeChapterTitle>
        <OutlinedInput
          size="small"
          value={name}
          onChange={(event) => setName(event.target.value)}
          inputProps={{ 'aria-label': t.courses.chapterNameAria({ name: chapter.name }) }}
        />
        <Button
          size="small"
          variant="text"
          disabled={pending || name.trim().length === 0 || name.trim() === chapter.name}
          onClick={() => onRename(name.trim())}
        >
          {t.courses.rename}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t.courses.moveChapterUp({ name: chapter.name })}>
          <span>
            <Button
              size="small"
              variant="text"
              disabled={pending || !canMoveUp}
              aria-label={t.courses.moveChapterUp({ name: chapter.name })}
              onClick={onMoveUp}
            >
              ↑
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={t.courses.moveChapterDown({ name: chapter.name })}>
          <span>
            <Button
              size="small"
              variant="text"
              disabled={pending || !canMoveDown}
              aria-label={t.courses.moveChapterDown({ name: chapter.name })}
              onClick={onMoveDown}
            >
              ↓
            </Button>
          </span>
        </Tooltip>
        <Button size="small" variant="text" color="error" disabled={pending} onClick={onRemove}>
          {t.courses.removeChapter}
        </Button>
      </Stack>

      {chapter.contents.length === 0 ? (
        <Typography variant="caption">{t.courses.noLessonsInChapter}</Typography>
      ) : (
        <List disablePadding dense>
          {chapter.contents.map((content, index) => (
            <ListItem
              key={content.id}
              disableGutters
              secondaryAction={
                <Stack direction="row" useFlexGap spacing="0.25rem">
                  <Tooltip title={t.courses.moveContentUp({ name: content.name })}>
                    <span>
                      <Button
                        size="small"
                        variant="text"
                        disabled={pending || index === 0}
                        aria-label={t.courses.moveContentUp({ name: content.name })}
                        onClick={() => onMoveContent(content.id, -1)}
                      >
                        ↑
                      </Button>
                    </span>
                  </Tooltip>
                  <Tooltip title={t.courses.moveContentDown({ name: content.name })}>
                    <span>
                      <Button
                        size="small"
                        variant="text"
                        disabled={pending || index === chapter.contents.length - 1}
                        aria-label={t.courses.moveContentDown({ name: content.name })}
                        onClick={() => onMoveContent(content.id, 1)}
                      >
                        ↓
                      </Button>
                    </span>
                  </Tooltip>
                  <Button
                    size="small"
                    variant="text"
                    color="error"
                    disabled={pending}
                    onClick={() => onRemoveContent(content.id)}
                  >
                    {t.common.remove}
                  </Button>
                </Stack>
              }
            >
              <ListItemText primary={content.name} secondary={lessonName(lessons, content.lessonId, t)} />
            </ListItem>
          ))}
        </List>
      )}

      <Box component="form" onSubmit={submitContent} sx={{ display: 'grid', gap: '0.5rem' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.5rem">
          <FormControl sx={{ minWidth: '12rem', flex: 1 }} size="small">
            <FormLabel htmlFor={`content-lesson-${chapter.id}`}>{t.courses.lessonLabel}</FormLabel>
            <Select
              id={`content-lesson-${chapter.id}`}
              displayEmpty
              value={lessonId}
              onChange={(event) => selectLesson(event.target.value)}
              inputProps={{ 'aria-label': t.courses.lessonLabel }}
            >
              <MenuItem value="">
                <em>{t.courses.selectLesson}</em>
              </MenuItem>
              {lessons.map((lesson) => (
                <MenuItem key={lesson.id} value={lesson.id}>
                  {lesson.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl sx={{ flex: 1 }} size="small">
            <FormLabel htmlFor={`content-name-${chapter.id}`}>{t.courses.displayName}</FormLabel>
            <OutlinedInput
              id={`content-name-${chapter.id}`}
              size="small"
              value={contentName}
              onChange={(event) => {
                setNameTouched(true);
                setContentName(event.target.value);
              }}
            />
          </FormControl>
        </Stack>
        {duplicate ? (
          <Typography variant="caption" role="alert" color="warning.main">
            {t.courses.duplicateLessonWarning}
          </Typography>
        ) : null}
        <Box>
          <Button type="submit" size="small" variant="outlined" disabled={pending || !lessonId}>
            {t.courses.addLesson}
          </Button>
        </Box>
      </Box>
    </Paper>
  );
};

const move = <T,>(items: T[], index: number, direction: -1 | 1): T[] => {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  if (!moved) return items;
  next.splice(target, 0, moved);
  return next;
};

const ModuleCard = ({
  module,
  lessons,
  onMoveUp,
  onMoveDown,
  onDetach,
  canMoveUp,
  canMoveDown,
  reorderPending,
}: {
  module: CourseModule;
  lessons: CourseLesson[];
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDetach: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  reorderPending: boolean;
}) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(module.title);
  const [prefix, setPrefix] = useState(module.prefix ?? '');
  const [chapterName, setChapterName] = useState('');

  const updateModule = useMutation({
    ...actions.updateModule,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.modulesInvalidates());
    },
  });

  const pending = updateModule.isPending || reorderPending;
  const saveChapters = (chapters: Chapter[]) => updateModule.mutate({ id: module.id, chapters });

  const addChapter = (event: FormEvent) => {
    event.preventDefault();
    if (chapterName.trim().length === 0) return;
    saveChapters([...module.chapters, { id: newId(), name: chapterName.trim(), contents: [] }]);
    setChapterName('');
  };

  const renameChapter = (chapterId: string, name: string) =>
    saveChapters(module.chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, name } : chapter)));

  const removeChapter = (chapterId: string) =>
    saveChapters(module.chapters.filter((chapter) => chapter.id !== chapterId));

  const moveChapter = (index: number, direction: -1 | 1) => saveChapters(move(module.chapters, index, direction));

  const addContent = (chapterId: string, lessonId: string, name: string) =>
    saveChapters(
      module.chapters.map((chapter) =>
        chapter.id === chapterId
          ? { ...chapter, contents: [...chapter.contents, { id: newId(), name, lessonId }] }
          : chapter,
      ),
    );

  const removeContent = (chapterId: string, contentId: string) =>
    saveChapters(
      module.chapters.map((chapter) =>
        chapter.id === chapterId
          ? { ...chapter, contents: chapter.contents.filter((content) => content.id !== contentId) }
          : chapter,
      ),
    );

  const moveContent = (chapterId: string, contentId: string, direction: -1 | 1) =>
    saveChapters(
      module.chapters.map((chapter) => {
        if (chapter.id !== chapterId) return chapter;
        const index = chapter.contents.findIndex((content) => content.id === contentId);
        if (index < 0) return chapter;
        return { ...chapter, contents: move(chapter.contents, index, direction) };
      }),
    );

  const renameModule = () => updateModule.mutate({ id: module.id, title: title.trim(), prefix: prefix.trim() || null });

  return (
    <Paper elevation={1} sx={{ p: '1.1rem', display: 'grid', gap: '1rem' }} data-testid="module-card">
      <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center' }}>
        <TreeModuleTitle component="h3">{module.name}</TreeModuleTitle>
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t.courses.moveModuleUp({ name: module.name })}>
          <span>
            <Button
              size="small"
              variant="text"
              disabled={pending || !canMoveUp}
              aria-label={t.courses.moveModuleUp({ name: module.name })}
              onClick={onMoveUp}
            >
              ↑
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={t.courses.moveModuleDown({ name: module.name })}>
          <span>
            <Button
              size="small"
              variant="text"
              disabled={pending || !canMoveDown}
              aria-label={t.courses.moveModuleDown({ name: module.name })}
              onClick={onMoveDown}
            >
              ↓
            </Button>
          </span>
        </Tooltip>
        <Button size="small" variant="text" color="error" disabled={pending} onClick={onDetach}>
          {t.courses.detachModule}
        </Button>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem" sx={{ alignItems: 'flex-end' }}>
        <FormControl sx={{ flex: 1 }} size="small">
          <FormLabel htmlFor={`module-title-${module.id}`}>{t.products.titleLabel}</FormLabel>
          <OutlinedInput
            id={`module-title-${module.id}`}
            size="small"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormControl>
        <FormControl sx={{ flex: 1 }} size="small">
          <FormLabel htmlFor={`module-prefix-${module.id}`}>{t.courses.prefixLabel}</FormLabel>
          <OutlinedInput
            id={`module-prefix-${module.id}`}
            size="small"
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
          />
        </FormControl>
        <Button
          variant="text"
          disabled={pending || title.trim().length === 0 || (title.trim() === module.title && (prefix.trim() || null) === module.prefix)}
          onClick={renameModule}
        >
          {t.courses.saveModule}
        </Button>
      </Stack>

      <Divider />

      <Stack useFlexGap spacing="0.75rem">
        <Eyebrow variant="overline" component="h4">
          {t.courses.chaptersHeading}
        </Eyebrow>
        {module.chapters.length === 0 ? (
          <Typography variant="caption">{t.courses.noChapters}</Typography>
        ) : (
          module.chapters.map((chapter, index) => (
            <ChapterEditor
              key={chapter.id}
              chapter={chapter}
              lessons={lessons}
              pending={pending}
              canMoveUp={index > 0}
              canMoveDown={index < module.chapters.length - 1}
              onMoveUp={() => moveChapter(index, -1)}
              onMoveDown={() => moveChapter(index, 1)}
              onRename={(name) => renameChapter(chapter.id, name)}
              onRemove={() => removeChapter(chapter.id)}
              onAddContent={(lessonId, name) => addContent(chapter.id, lessonId, name)}
              onRemoveContent={(contentId) => removeContent(chapter.id, contentId)}
              onMoveContent={(contentId, direction) => moveContent(chapter.id, contentId, direction)}
            />
          ))
        )}
        <Box component="form" onSubmit={addChapter}>
          <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'flex-end' }}>
            <FormControl sx={{ flex: 1 }} size="small">
              <FormLabel htmlFor={`new-chapter-${module.id}`}>{t.courses.newChapterName}</FormLabel>
              <OutlinedInput
                id={`new-chapter-${module.id}`}
                size="small"
                value={chapterName}
                onChange={(event) => setChapterName(event.target.value)}
              />
            </FormControl>
            <Button type="submit" variant="outlined" disabled={pending || chapterName.trim().length === 0}>
              {t.courses.addChapter}
            </Button>
          </Stack>
        </Box>
      </Stack>

      {updateModule.isError ? <MutationError error={updateModule.error} /> : null}
    </Paper>
  );
};

const CreateModuleForm = ({ courseId }: { courseId: string }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [prefix, setPrefix] = useState('');

  const createModule = useMutation({
    ...actions.createModule,
    onSuccess: async () => {
      setTitle('');
      setPrefix('');
      await queryClient.invalidateQueries(actions.modulesInvalidates());
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createModule.mutate({ courseIds: [courseId], title: title.trim(), prefix: prefix.trim() || null });
  };

  return (
    <Paper elevation={1} component="form" onSubmit={submit} sx={{ p: '1rem', display: 'grid', gap: '0.75rem' }}>
      <Typography variant="h2" component="h3">
        {t.courses.newModule}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem" sx={{ alignItems: 'flex-end' }}>
        <FormControl sx={{ flex: 1 }}>
          <FormLabel htmlFor="new-module-title">{t.products.titleLabel}</FormLabel>
          <OutlinedInput
            id="new-module-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </FormControl>
        <FormControl sx={{ flex: 1 }}>
          <FormLabel htmlFor="new-module-prefix">{t.courses.prefixLabel}</FormLabel>
          <OutlinedInput id="new-module-prefix" value={prefix} onChange={(event) => setPrefix(event.target.value)} />
        </FormControl>
        <Button type="submit" variant="contained" disabled={createModule.isPending || title.trim().length === 0}>
          {createModule.isPending ? t.courses.creatingModule : t.courses.createModule}
        </Button>
      </Stack>
      {createModule.isError ? <MutationError error={createModule.error} /> : null}
    </Paper>
  );
};

const AttachModuleForm = ({ courseId, modules }: { courseId: string; modules: CourseModule[] }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [moduleId, setModuleId] = useState('');

  const attachModule = useMutation({
    ...actions.attachModule,
    onSuccess: async () => {
      setModuleId('');
      await queryClient.invalidateQueries(actions.modulesInvalidates());
    },
  });

  if (modules.length === 0) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!moduleId) return;
    attachModule.mutate({ courseId, moduleId });
  };

  return (
    <Paper elevation={1} component="form" onSubmit={submit} sx={{ p: '1rem', display: 'grid', gap: '0.75rem' }}>
      <Typography variant="h2" component="h3">
        {t.courses.attachExisting}
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem" sx={{ alignItems: 'flex-end' }}>
        <FormControl sx={{ flex: 1 }}>
          <FormLabel htmlFor="attach-module">{t.courses.moduleLabel}</FormLabel>
          <Select
            id="attach-module"
            displayEmpty
            value={moduleId}
            onChange={(event) => setModuleId(event.target.value)}
            inputProps={{ 'aria-label': t.courses.moduleLabel }}
          >
            <MenuItem value="">
              <em>{t.courses.selectModule}</em>
            </MenuItem>
            {modules.map((module) => (
              <MenuItem key={module.id} value={module.id}>
                {module.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button type="submit" variant="outlined" disabled={attachModule.isPending || !moduleId}>
          {attachModule.isPending ? t.courses.attaching : t.courses.attachModule}
        </Button>
      </Stack>
      {attachModule.isError ? <MutationError error={attachModule.error} /> : null}
    </Paper>
  );
};

const orderAttachedModules = (course: Course, attached: CourseModule[]): CourseModule[] => {
  const rank = new Map(course.moduleOrder.map((moduleId, index) => [moduleId, index]));
  return [...attached].sort((a, b) => {
    const rankA = rank.get(a.id) ?? Number.POSITIVE_INFINITY;
    const rankB = rank.get(b.id) ?? Number.POSITIVE_INFINITY;
    if (rankA !== rankB) return rankA - rankB;
    if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
    return a.id.localeCompare(b.id);
  });
};

export const CourseDetail = ({ course, onBack }: { course: Course; onBack: () => void }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const modules = useQuery(actions.modules);
  const lessons = useQuery(actions.lessons);

  const invalidateTree = async () => {
    await Promise.all([
      queryClient.invalidateQueries(actions.modulesInvalidates()),
      queryClient.invalidateQueries(actions.coursesInvalidates()),
    ]);
  };

  const reorderModules = useMutation({ ...actions.updateCourse, onSuccess: invalidateTree });
  const detachModule = useMutation({ ...actions.detachModule, onSuccess: invalidateTree });

  if (modules.isPending || lessons.isPending) {
    return <Typography variant="body1">{t.courses.loadingCourse}</Typography>;
  }
  if (modules.isError) return <MutationError error={modules.error} />;
  if (lessons.isError) return <MutationError error={lessons.error} />;

  const attached = orderAttachedModules(
    course,
    modules.data.modules.filter((module) => module.courseIds.includes(course.id)),
  );
  const unattached = modules.data.modules.filter((module) => !module.courseIds.includes(course.id));
  const reorderPending = reorderModules.isPending || detachModule.isPending;

  const moveModule = (index: number, direction: -1 | 1) => {
    const reordered = move(attached, index, direction);
    reorderModules.mutate({ id: course.id, moduleOrder: reordered.map((module) => module.id) });
  };

  return (
    <Stack useFlexGap spacing="1.5rem">
      <Stack direction="row" useFlexGap spacing="1rem" sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Button variant="text" onClick={onBack}>
          {t.courses.allCourses}
        </Button>
        <CardTitle variant="h1" component="h2">
          {course.name}
        </CardTitle>
      </Stack>

      <CreateModuleForm courseId={course.id} />
      <AttachModuleForm courseId={course.id} modules={unattached} />
      <HistoryPanel courseId={course.id} />

      <Box component="section">
        <Typography variant="h2" component="h3" sx={{ mb: '1rem' }}>
          {t.courses.modulesHeading}
        </Typography>
        {reorderModules.isError ? <MutationError error={reorderModules.error} /> : null}
        {detachModule.isError ? <MutationError error={detachModule.error} /> : null}
        {attached.length === 0 ? (
          <Typography variant="body1">{t.courses.noModulesInCourse}</Typography>
        ) : (
          <Stack useFlexGap spacing="1rem">
            {attached.map((module, index) => (
              <ModuleCard
                key={module.id}
                module={module}
                lessons={lessons.data.lessons}
                reorderPending={reorderPending}
                canMoveUp={index > 0}
                canMoveDown={index < attached.length - 1}
                onMoveUp={() => moveModule(index, -1)}
                onMoveDown={() => moveModule(index, 1)}
                onDetach={() => detachModule.mutate({ courseId: course.id, moduleId: module.id })}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
};
