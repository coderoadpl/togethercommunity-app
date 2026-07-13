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
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Chapter, Course, CourseLesson, CourseModule } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { CardTitle, Eyebrow, TreeChapterTitle, TreeModuleTitle } from '../../../theme.js';
import { MutationError, newId } from './feedback.js';

const lessonName = (lessons: CourseLesson[], lessonId: string): string =>
  lessons.find((lesson) => lesson.id === lessonId)?.name ?? 'unknown lesson';

const ChapterEditor = ({
  chapter,
  lessons,
  onRename,
  onRemove,
  onAddContent,
  onRemoveContent,
  pending,
}: {
  chapter: Chapter;
  lessons: CourseLesson[];
  onRename: (name: string) => void;
  onRemove: () => void;
  onAddContent: (lessonId: string, name: string) => void;
  onRemoveContent: (contentId: string) => void;
  pending: boolean;
}) => {
  const [name, setName] = useState(chapter.name);
  const [contentName, setContentName] = useState('');
  const [lessonId, setLessonId] = useState('');

  const submitContent = (event: FormEvent) => {
    event.preventDefault();
    if (!lessonId || contentName.trim().length === 0) return;
    onAddContent(lessonId, contentName.trim());
    setContentName('');
    setLessonId('');
  };

  return (
    <Paper variant="outlined" sx={{ p: '0.9rem', display: 'grid', gap: '0.75rem' }}>
      <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <TreeChapterTitle component="span">chapter</TreeChapterTitle>
        <OutlinedInput
          size="small"
          value={name}
          onChange={(event) => setName(event.target.value)}
          inputProps={{ 'aria-label': `chapter name ${chapter.id}` }}
        />
        <Button
          size="small"
          variant="text"
          disabled={pending || name.trim().length === 0 || name.trim() === chapter.name}
          onClick={() => onRename(name.trim())}
        >
          rename
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="text" color="error" disabled={pending} onClick={onRemove}>
          remove chapter
        </Button>
      </Stack>

      {chapter.contents.length === 0 ? (
        <Typography variant="caption">No lessons in this chapter yet.</Typography>
      ) : (
        <List disablePadding dense>
          {chapter.contents.map((content) => (
            <ListItem
              key={content.id}
              disableGutters
              secondaryAction={
                <Button
                  size="small"
                  variant="text"
                  color="error"
                  disabled={pending}
                  onClick={() => onRemoveContent(content.id)}
                >
                  remove
                </Button>
              }
            >
              <ListItemText primary={content.name} secondary={lessonName(lessons, content.lessonId)} />
            </ListItem>
          ))}
        </List>
      )}

      <Box component="form" onSubmit={submitContent} sx={{ display: 'grid', gap: '0.5rem' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.5rem">
          <FormControl sx={{ minWidth: '12rem', flex: 1 }} size="small">
            <FormLabel htmlFor={`content-lesson-${chapter.id}`}>lesson</FormLabel>
            <Select
              id={`content-lesson-${chapter.id}`}
              displayEmpty
              value={lessonId}
              onChange={(event) => setLessonId(event.target.value)}
              inputProps={{ 'aria-label': `content lesson ${chapter.id}` }}
            >
              <MenuItem value="">
                <em>select a lesson</em>
              </MenuItem>
              {lessons.map((lesson) => (
                <MenuItem key={lesson.id} value={lesson.id}>
                  {lesson.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl sx={{ flex: 1 }} size="small">
            <FormLabel htmlFor={`content-name-${chapter.id}`}>display name</FormLabel>
            <OutlinedInput
              id={`content-name-${chapter.id}`}
              size="small"
              value={contentName}
              onChange={(event) => setContentName(event.target.value)}
            />
          </FormControl>
        </Stack>
        <Box>
          <Button
            type="submit"
            size="small"
            variant="outlined"
            disabled={pending || !lessonId || contentName.trim().length === 0}
          >
            add lesson
          </Button>
        </Box>
      </Box>
    </Paper>
  );
};

const ModuleCard = ({ module, lessons }: { module: CourseModule; lessons: CourseLesson[] }) => {
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

  const pending = updateModule.isPending;
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

  const renameModule = () => updateModule.mutate({ id: module.id, title: title.trim(), prefix: prefix.trim() || null });

  return (
    <Paper elevation={1} sx={{ p: '1.1rem', display: 'grid', gap: '1rem' }} data-testid="module-card">
      <TreeModuleTitle component="h3">{module.name}</TreeModuleTitle>
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem" sx={{ alignItems: 'flex-end' }}>
        <FormControl sx={{ flex: 1 }} size="small">
          <FormLabel htmlFor={`module-title-${module.id}`}>title</FormLabel>
          <OutlinedInput
            id={`module-title-${module.id}`}
            size="small"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormControl>
        <FormControl sx={{ flex: 1 }} size="small">
          <FormLabel htmlFor={`module-prefix-${module.id}`}>prefix</FormLabel>
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
          save module
        </Button>
      </Stack>

      <Divider />

      <Stack useFlexGap spacing="0.75rem">
        <Eyebrow variant="overline" component="h4">
          Chapters
        </Eyebrow>
        {module.chapters.length === 0 ? (
          <Typography variant="caption">No chapters yet.</Typography>
        ) : (
          module.chapters.map((chapter) => (
            <ChapterEditor
              key={chapter.id}
              chapter={chapter}
              lessons={lessons}
              pending={pending}
              onRename={(name) => renameChapter(chapter.id, name)}
              onRemove={() => removeChapter(chapter.id)}
              onAddContent={(lessonId, name) => addContent(chapter.id, lessonId, name)}
              onRemoveContent={(contentId) => removeContent(chapter.id, contentId)}
            />
          ))
        )}
        <Box component="form" onSubmit={addChapter}>
          <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'flex-end' }}>
            <FormControl sx={{ flex: 1 }} size="small">
              <FormLabel htmlFor={`new-chapter-${module.id}`}>new chapter name</FormLabel>
              <OutlinedInput
                id={`new-chapter-${module.id}`}
                size="small"
                value={chapterName}
                onChange={(event) => setChapterName(event.target.value)}
              />
            </FormControl>
            <Button type="submit" variant="outlined" disabled={pending || chapterName.trim().length === 0}>
              add chapter
            </Button>
          </Stack>
        </Box>
      </Stack>

      {updateModule.isError ? <MutationError error={updateModule.error} /> : null}
    </Paper>
  );
};

const CreateModuleForm = ({ courseId }: { courseId: string }) => {
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
        New module
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem" sx={{ alignItems: 'flex-end' }}>
        <FormControl sx={{ flex: 1 }}>
          <FormLabel htmlFor="new-module-title">title</FormLabel>
          <OutlinedInput
            id="new-module-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </FormControl>
        <FormControl sx={{ flex: 1 }}>
          <FormLabel htmlFor="new-module-prefix">prefix</FormLabel>
          <OutlinedInput id="new-module-prefix" value={prefix} onChange={(event) => setPrefix(event.target.value)} />
        </FormControl>
        <Button type="submit" variant="contained" disabled={createModule.isPending || title.trim().length === 0}>
          {createModule.isPending ? 'creating…' : 'create module'}
        </Button>
      </Stack>
      {createModule.isError ? <MutationError error={createModule.error} /> : null}
    </Paper>
  );
};

const AttachModuleForm = ({ courseId, modules }: { courseId: string; modules: CourseModule[] }) => {
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
        Attach existing module
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem" sx={{ alignItems: 'flex-end' }}>
        <FormControl sx={{ flex: 1 }}>
          <FormLabel htmlFor="attach-module">module</FormLabel>
          <Select
            id="attach-module"
            displayEmpty
            value={moduleId}
            onChange={(event) => setModuleId(event.target.value)}
            inputProps={{ 'aria-label': 'attach module' }}
          >
            <MenuItem value="">
              <em>select a module</em>
            </MenuItem>
            {modules.map((module) => (
              <MenuItem key={module.id} value={module.id}>
                {module.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button type="submit" variant="outlined" disabled={attachModule.isPending || !moduleId}>
          {attachModule.isPending ? 'attaching…' : 'attach module'}
        </Button>
      </Stack>
      {attachModule.isError ? <MutationError error={attachModule.error} /> : null}
    </Paper>
  );
};

export const CourseDetail = ({ course, onBack }: { course: Course; onBack: () => void }) => {
  const modules = useQuery(actions.modules);
  const lessons = useQuery(actions.lessons);

  if (modules.isPending || lessons.isPending) {
    return <Typography variant="body1">loading course…</Typography>;
  }
  if (modules.isError) return <MutationError error={modules.error} />;
  if (lessons.isError) return <MutationError error={lessons.error} />;

  const attached = modules.data.modules.filter((module) => module.courseIds.includes(course.id));
  const unattached = modules.data.modules.filter((module) => !module.courseIds.includes(course.id));

  return (
    <Stack useFlexGap spacing="1.5rem">
      <Stack direction="row" useFlexGap spacing="1rem" sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Button variant="text" onClick={onBack}>
          ← all courses
        </Button>
        <CardTitle variant="h1" component="h2">
          {course.name}
        </CardTitle>
      </Stack>

      <CreateModuleForm courseId={course.id} />
      <AttachModuleForm courseId={course.id} modules={unattached} />

      <Box component="section">
        <Typography variant="h2" component="h3" sx={{ mb: '1rem' }}>
          Modules
        </Typography>
        {attached.length === 0 ? (
          <Typography variant="body1">No modules in this course yet.</Typography>
        ) : (
          <Stack useFlexGap spacing="1rem">
            {attached.map((module) => (
              <ModuleCard key={module.id} module={module} lessons={lessons.data.lessons} />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
};
