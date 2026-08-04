import { useState, type DragEvent, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControl,
  FormLabel,
  List,
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
import { useNavigate } from '@tanstack/react-router';

import type { Chapter, Course, CourseLesson, CourseModule } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useTranslations, type Messages } from '../../../i18n/index.js';
import {
  Eyebrow,
  ReorderCard,
  ReorderDragHandle,
  ReorderRow,
  TreeChapterTitle,
  TreeModuleTitle,
} from '../../../theme.js';
import { HistoryPanel } from './HistoryPanel.js';
import { MutationError, newId } from './feedback.js';

type ModulesData = Awaited<ReturnType<typeof actions.modules.queryFn>>;
type CoursesData = Awaited<ReturnType<typeof actions.courses.queryFn>>;

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
  onReorderContent,
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
  onReorderContent: (contentId: string, targetContentId: string) => void;
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
  const [draggedContentId, setDraggedContentId] = useState<string | null>(null);
  const [contentDropTargetId, setContentDropTargetId] = useState<string | null>(null);

  const startContentDrag = (event: DragEvent<HTMLSpanElement>, contentId: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', contentId);
    setDraggedContentId(contentId);
  };

  const dropContent = (event: DragEvent<HTMLElement>, targetContentId: string) => {
    event.preventDefault();
    if (draggedContentId && draggedContentId !== targetContentId) {
      onReorderContent(draggedContentId, targetContentId);
    }
    setDraggedContentId(null);
    setContentDropTargetId(null);
  };

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
            <ReorderRow
              key={content.id}
              data-testid={`lesson-content-${content.id}`}
              disableGutters
              dropTarget={contentDropTargetId === content.id}
              onDragOver={(event) => {
                if (!draggedContentId || draggedContentId === content.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setContentDropTargetId(content.id);
              }}
              onDragLeave={(event) => {
                if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                setContentDropTargetId(null);
              }}
              onDrop={(event) => dropContent(event, content.id)}
              sx={{
                alignItems: { xs: 'stretch', sm: 'center' },
                flexDirection: { xs: 'column', sm: 'row' },
                gap: '0.5rem',
              }}
            >
              <ListItemText
                primary={content.name}
                secondary={lessonName(lessons, content.lessonId, t)}
                sx={{ minWidth: 0 }}
              />
              <Stack
                direction="row"
                useFlexGap
                spacing="0.25rem"
                sx={{ alignSelf: { xs: 'flex-end', sm: 'auto' }, flexWrap: 'wrap', justifyContent: 'flex-end' }}
              >
                <ReorderDragHandle
                  aria-hidden
                  data-testid={`lesson-drag-handle-${content.id}`}
                  draggable={!pending}
                  pending={pending}
                  onDragStart={(event) => startContentDrag(event, content.id)}
                  onDragEnd={() => {
                    setDraggedContentId(null);
                    setContentDropTargetId(null);
                  }}
                >
                  ⠿
                </ReorderDragHandle>
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
            </ReorderRow>
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

const moveTo = <T,>(items: T[], sourceIndex: number, targetIndex: number): T[] => {
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= items.length || sourceIndex === targetIndex) return items;
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) return items;
  next.splice(targetIndex, 0, moved);
  return next;
};

const move = <T,>(items: T[], index: number, direction: -1 | 1): T[] =>
  moveTo(items, index, index + direction);

const ModuleCard = ({
  module,
  lessons,
  onMoveUp,
  onMoveDown,
  onDetach,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  isDropTarget,
  canMoveUp,
  canMoveDown,
  reorderPending,
}: {
  module: CourseModule;
  lessons: CourseLesson[];
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDetach: () => void;
  onDragStart: (event: DragEvent<HTMLSpanElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  isDropTarget: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  reorderPending: boolean;
}) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(module.title);
  const [prefix, setPrefix] = useState(module.prefix ?? '');
  const [chapterName, setChapterName] = useState('');
  const [chapterToRemove, setChapterToRemove] = useState<Chapter | null>(null);

  const updateModule = useMutation({
    ...actions.updateModule,
    onMutate: async ({ id, chapters }) => {
      if (!chapters) return { previous: undefined };
      await queryClient.cancelQueries(actions.modulesInvalidates());
      const previous = queryClient.getQueryData<ModulesData>(actions.modules.queryKey);
      queryClient.setQueryData<ModulesData>(actions.modules.queryKey, (current) =>
        current
          ? {
              ...current,
              modules: current.modules.map((entry) => (entry.id === id ? { ...entry, chapters } : entry)),
            }
          : current,
      );
      return { previous: previous?.modules.find((entry) => entry.id === id) };
    },
    onError: (_error, input, context) => {
      if (!context?.previous) return;
      const previous = context.previous;
      queryClient.setQueryData<ModulesData>(actions.modules.queryKey, (current) =>
        current
          ? {
              ...current,
              modules: current.modules.map((entry) => (entry.id === input.id ? previous : entry)),
            }
          : current,
      );
    },
    onSettled: async () => {
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

  const reorderContent = (chapterId: string, contentId: string, targetContentId: string) =>
    saveChapters(
      module.chapters.map((chapter) => {
        if (chapter.id !== chapterId) return chapter;
        const sourceIndex = chapter.contents.findIndex((content) => content.id === contentId);
        const targetIndex = chapter.contents.findIndex((content) => content.id === targetContentId);
        return { ...chapter, contents: moveTo(chapter.contents, sourceIndex, targetIndex) };
      }),
    );

  const renameModule = () => updateModule.mutate({ id: module.id, title: title.trim(), prefix: prefix.trim() || null });

  return (
    <ReorderCard
      elevation={1}
      sx={{ p: '1.1rem', display: 'grid', gap: '1rem' }}
      data-testid="module-card"
      dropTarget={isDropTarget}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <TreeModuleTitle component="h3">{module.name}</TreeModuleTitle>
        <Box sx={{ flex: 1 }} />
        <ReorderDragHandle
          aria-hidden
          data-testid={`module-drag-handle-${module.id}`}
          draggable={!pending}
          pending={pending}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          ⠿
        </ReorderDragHandle>
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
              onRemove={() => setChapterToRemove(chapter)}
              onAddContent={(lessonId, name) => addContent(chapter.id, lessonId, name)}
              onRemoveContent={(contentId) => removeContent(chapter.id, contentId)}
              onMoveContent={(contentId, direction) => moveContent(chapter.id, contentId, direction)}
              onReorderContent={(contentId, targetContentId) =>
                reorderContent(chapter.id, contentId, targetContentId)
              }
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

      {chapterToRemove ? (
        <ConfirmDialog
          open
          title={t.courses.removeChapterConfirmTitle}
          body={
            <>
              <Typography variant="body1">
                {t.courses.removeChapterConfirmIntro({ name: chapterToRemove.name })}
              </Typography>
              {chapterToRemove.contents.length > 0 ? (
                <Typography variant="body2">
                  {t.courses.removeChapterLessonCount({ count: chapterToRemove.contents.length })}
                </Typography>
              ) : null}
              {module.courseIds.length > 1 ? (
                <Typography variant="body2" color="warning.main">
                  {t.courses.removeChapterSharedWarning({ count: module.courseIds.length - 1 })}
                </Typography>
              ) : null}
            </>
          }
          confirmLabel={t.courses.removeChapterConfirm}
          cancelLabel={t.common.cancel}
          pending={pending}
          onClose={() => setChapterToRemove(null)}
          onConfirm={() => {
            removeChapter(chapterToRemove.id);
            setChapterToRemove(null);
          }}
          confirmTestId="chapter-delete-confirm"
        />
      ) : null}
    </ReorderCard>
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
    <SectionCard title={t.courses.attachExisting} onSubmit={submit}>
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
    </SectionCard>
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

const CourseDetailsSection = ({ course }: { course: Course }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [name, setName] = useState(course.name);
  const [description, setDescription] = useState(course.description);
  const [imageUrl, setImageUrl] = useState(course.imageUrl ?? '');
  const errorId = 'course-details-error';
  const save = useMutation({
    ...actions.updateCourse,
    onSuccess: async () => queryClient.invalidateQueries(actions.coursesInvalidates()),
  });

  const resetFeedback = () => {
    if (save.isSuccess || save.isError) save.reset();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate({
      id: course.id,
      name: name.trim(),
      description,
      imageUrl: imageUrl.trim() === '' ? null : imageUrl.trim(),
    });
  };

  return (
    <SectionCard
      title={t.courses.detailsHeading}
      onSubmit={submit}
      actions={(
        <Button type="submit" variant="contained" disabled={save.isPending || name.trim().length === 0}>
          {save.isPending ? t.courses.savingDetails : t.courses.saveDetails}
        </Button>
      )}
      data-testid="course-details-section"
    >
      <FormControl fullWidth>
        <FormLabel htmlFor="course-name">{t.courses.titleLabel}</FormLabel>
        <OutlinedInput
          id="course-name"
          value={name}
          required
          aria-describedby={save.isError ? errorId : undefined}
          onChange={(event) => {
            resetFeedback();
            setName(event.target.value);
          }}
        />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="course-description">{t.common.description}</FormLabel>
        <OutlinedInput
          id="course-description"
          value={description}
          multiline
          minRows={3}
          aria-describedby={save.isError ? errorId : undefined}
          onChange={(event) => {
            resetFeedback();
            setDescription(event.target.value);
          }}
        />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="course-image">{t.courses.imageUrl}</FormLabel>
        <OutlinedInput
          id="course-image"
          type="url"
          value={imageUrl}
          aria-describedby={save.isError ? errorId : undefined}
          onChange={(event) => {
            resetFeedback();
            setImageUrl(event.target.value);
          }}
        />
      </FormControl>
      {save.isSuccess ? <Alert severity="success">{t.courses.detailsSaved}</Alert> : null}
      {save.isError ? (
        <MutationError
          error={save.error}
          id={errorId}
          fields={[
            { name: 'name', id: 'course-name', label: t.courses.titleLabel },
            { name: 'description', id: 'course-description', label: t.common.description },
            { name: 'imageUrl', id: 'course-image', label: t.courses.imageUrl },
          ]}
        />
      ) : null}
    </SectionCard>
  );
};

export const CourseDetail = ({ course, onBack }: { course: Course; onBack: () => void }) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const modules = useQuery(actions.modules);
  const lessons = useQuery(actions.lessons);
  const [moduleToDetach, setModuleToDetach] = useState<CourseModule | null>(null);
  const [draggedModuleId, setDraggedModuleId] = useState<string | null>(null);
  const [moduleDropTargetId, setModuleDropTargetId] = useState<string | null>(null);

  const invalidateTree = async () => {
    await Promise.all([
      queryClient.invalidateQueries(actions.modulesInvalidates()),
      queryClient.invalidateQueries(actions.coursesInvalidates()),
    ]);
  };

  const reorderModules = useMutation({
    ...actions.updateCourse,
    onMutate: async ({ id, moduleOrder }) => {
      if (!moduleOrder) return { previous: undefined };
      await queryClient.cancelQueries(actions.coursesInvalidates());
      const previous = queryClient.getQueryData<CoursesData>(actions.courses.queryKey);
      queryClient.setQueryData<CoursesData>(actions.courses.queryKey, (current) =>
        current
          ? {
              ...current,
              courses: current.courses.map((entry) => (entry.id === id ? { ...entry, moduleOrder } : entry)),
            }
          : current,
      );
      return { previous: previous?.courses.find((entry) => entry.id === id) };
    },
    onError: (_error, input, context) => {
      if (!context?.previous) return;
      const previous = context.previous;
      queryClient.setQueryData<CoursesData>(actions.courses.queryKey, (current) =>
        current
          ? {
              ...current,
              courses: current.courses.map((entry) => (entry.id === input.id ? previous : entry)),
            }
          : current,
      );
    },
    onSettled: invalidateTree,
  });
  const detachModule = useMutation({ ...actions.detachModule, onSuccess: invalidateTree });

  if (modules.isPending || lessons.isPending) {
    return <PanelPage title={course.name} backTo={{ label: t.courses.allCourses, href: '/panel/courses' }} state={{ kind: 'loading', label: t.courses.loadingCourse }} />;
  }
  if (modules.isError) return <PanelPage title={course.name} backTo={{ label: t.courses.allCourses, href: '/panel/courses' }} state={{ kind: 'error', message: localizeError(modules.error, t), retry: { label: t.common.retry, onRetry: () => void modules.refetch() } }} />;
  if (lessons.isError) return <PanelPage title={course.name} backTo={{ label: t.courses.allCourses, href: '/panel/courses' }} state={{ kind: 'error', message: localizeError(lessons.error, t), retry: { label: t.common.retry, onRetry: () => void lessons.refetch() } }} />;

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

  const dropModule = (event: DragEvent<HTMLElement>, targetModuleId: string) => {
    event.preventDefault();
    if (draggedModuleId && draggedModuleId !== targetModuleId) {
      const sourceIndex = attached.findIndex((module) => module.id === draggedModuleId);
      const targetIndex = attached.findIndex((module) => module.id === targetModuleId);
      const reordered = moveTo(attached, sourceIndex, targetIndex);
      reorderModules.mutate({ id: course.id, moduleOrder: reordered.map((module) => module.id) });
    }
    setDraggedModuleId(null);
    setModuleDropTargetId(null);
  };

  return (
    <PanelPage
      title={course.name}
      backTo={{
        label: t.courses.allCourses,
        href: '/panel/courses',
        onClick: (event) => {
          event.preventDefault();
          onBack();
        },
      }}
      action={
        <Button
          variant="contained"
          data-testid="add-module"
          onClick={() =>
            void navigate({ to: '/panel/courses/$courseId/modules/new', params: { courseId: course.id } })
          }
        >
          + {t.courses.addModule}
        </Button>
      }
    >
      <CourseDetailsSection course={course} />
      <AttachModuleForm courseId={course.id} modules={unattached} />
      <HistoryPanel courseId={course.id} />

      <Box component="section">
        <Typography variant="h2" component="h3" sx={{ mb: '1rem' }}>
          {t.courses.modulesHeading}
        </Typography>
        {reorderModules.isError ? <MutationError error={reorderModules.error} /> : null}
        {detachModule.isError ? <MutationError error={detachModule.error} /> : null}
        {attached.length === 0 ? (
          <StatusView state={{ kind: 'empty', title: t.courses.noModulesInCourse }} />
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
                onDetach={() => setModuleToDetach(module)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', module.id);
                  setDraggedModuleId(module.id);
                }}
                onDragEnd={() => {
                  setDraggedModuleId(null);
                  setModuleDropTargetId(null);
                }}
                onDragOver={(event) => {
                  if (!draggedModuleId || draggedModuleId === module.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setModuleDropTargetId(module.id);
                }}
                onDragLeave={(event) => {
                  if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                  setModuleDropTargetId(null);
                }}
                onDrop={(event) => dropModule(event, module.id)}
                isDropTarget={moduleDropTargetId === module.id}
              />
            ))}
          </Stack>
        )}
      </Box>

      {moduleToDetach ? (
        <ConfirmDialog
          open
          title={t.courses.detachModuleConfirmTitle}
          body={
            <>
              <Typography variant="body1">
                {t.courses.detachModuleConfirmIntro({ name: moduleToDetach.name })}
              </Typography>
              {moduleToDetach.courseIds.length > 1 ? (
                <Typography variant="body2">
                  {t.courses.detachModuleSharedNote({ count: moduleToDetach.courseIds.length - 1 })}
                </Typography>
              ) : null}
            </>
          }
          confirmLabel={t.courses.detachModuleConfirm}
          cancelLabel={t.common.cancel}
          pending={detachModule.isPending}
          onClose={() => setModuleToDetach(null)}
          onConfirm={() => {
            detachModule.mutate({ courseId: course.id, moduleId: moduleToDetach.id });
            setModuleToDetach(null);
          }}
          confirmTestId="module-detach-confirm"
        />
      ) : null}
    </PanelPage>
  );
};
