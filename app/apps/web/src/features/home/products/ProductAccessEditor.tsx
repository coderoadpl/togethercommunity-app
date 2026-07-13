import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AccessItem, Course, CourseModule, Product } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { MutationError } from '../courses/feedback.js';

type AccessLevel = 'course' | 'modules' | 'lessons';

const courseName = (courses: Course[], courseId: string): string =>
  courses.find((course) => course.id === courseId)?.name ?? 'unknown course';

const accessItemSummary = (item: AccessItem, courses: Course[]): string => {
  const name = courseName(courses, item.courseId);
  if (item.courseLevelAccess) return `Whole course ${name}`;
  if (item.lessonIds.length > 0) {
    return `${item.lessonIds.length} lesson${item.lessonIds.length === 1 ? '' : 's'} of ${name}`;
  }
  return `${item.moduleIds.length} module${item.moduleIds.length === 1 ? '' : 's'} of ${name}`;
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
  const queryClient = useQueryClient();
  const courses = useQuery(actions.courses);
  const modules = useQuery(actions.modules);
  const lessons = useQuery(actions.lessons);

  const [items, setItems] = useState<AccessItem[]>(product.accessItems);
  const [courseId, setCourseId] = useState('');
  const [level, setLevel] = useState<AccessLevel>('course');
  const [moduleIds, setModuleIds] = useState<string[]>([]);
  const [lessonIds, setLessonIds] = useState<string[]>([]);

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
  };

  const pickCourse = (nextCourseId: string) => {
    setCourseId(nextCourseId);
    setModuleIds([]);
    setLessonIds([]);
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

  const draftValid =
    courseId !== '' &&
    (level === 'course' ||
      (level === 'modules' && moduleIds.length > 0) ||
      (level === 'lessons' && lessonIds.length > 0));

  const addItem = () => {
    if (!draftValid) return;
    const item: AccessItem = {
      courseId,
      courseLevelAccess: level === 'course',
      moduleIds: level === 'modules' ? moduleIds : [],
      lessonIds: level === 'lessons' ? lessonIds : [],
    };
    setItems([...items, item]);
    resetDraft();
  };

  const removeItem = (index: number) => setItems(items.filter((_item, position) => position !== index));

  if (courses.isPending || modules.isPending || lessons.isPending) {
    return <Typography variant="body2">loading access data…</Typography>;
  }
  if (courses.isError) return <MutationError error={courses.error} />;
  if (modules.isError) return <MutationError error={modules.error} />;
  if (lessons.isError) return <MutationError error={lessons.error} />;

  const dirty = JSON.stringify(items) !== JSON.stringify(product.accessItems);

  return (
    <Stack useFlexGap spacing="1rem" data-testid={`access-editor-${product.id}`}>
      <Box>
        <Typography variant="overline" component="h4">
          Access
        </Typography>
        {items.length === 0 ? (
          <Typography variant="body2">No access items — this product grants nothing yet.</Typography>
        ) : (
          <List disablePadding dense>
            {items.map((item, index) => (
              <ListItem
                key={`${item.courseId}-${index}`}
                disableGutters
                data-testid="access-item"
                secondaryAction={
                  <Button size="small" variant="text" color="error" onClick={() => removeItem(index)}>
                    remove
                  </Button>
                }
              >
                <ListItemText primary={accessItemSummary(item, courses.data.courses)} />
              </ListItem>
            ))}
          </List>
        )}
      </Box>

      <Box sx={{ display: 'grid', gap: '0.75rem' }}>
        <FormControl size="small" fullWidth>
          <FormLabel htmlFor={`access-course-${product.id}`}>course</FormLabel>
          <Select
            id={`access-course-${product.id}`}
            displayEmpty
            value={courseId}
            onChange={(event) => pickCourse(event.target.value)}
            inputProps={{ 'aria-label': `access course ${product.id}` }}
          >
            <MenuItem value="">
              <em>select a course</em>
            </MenuItem>
            {courses.data.courses.map((course) => (
              <MenuItem key={course.id} value={course.id}>
                {course.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {courseId ? (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={level}
            onChange={(_event, value: AccessLevel | null) => {
              if (value) setLevel(value);
            }}
            aria-label="access level"
          >
            <ToggleButton value="course" data-testid="level-course">
              Whole course
            </ToggleButton>
            <ToggleButton value="modules" data-testid="level-modules">
              Selected modules
            </ToggleButton>
            <ToggleButton value="lessons" data-testid="level-lessons">
              Selected lessons
            </ToggleButton>
          </ToggleButtonGroup>
        ) : null}

        {courseId && level === 'modules' ? (
          <Box role="group" aria-label="modules" sx={{ display: 'grid', gap: '0.2rem' }}>
            <FormLabel component="div">modules</FormLabel>
            {availableModules.length === 0 ? (
              <Typography variant="body2">No modules attached to this course.</Typography>
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
          <Box role="group" aria-label="lessons" sx={{ display: 'grid', gap: '0.2rem' }}>
            <FormLabel component="div">lessons</FormLabel>
            {availableLessons.length === 0 ? (
              <Typography variant="body2">No lessons in this course yet.</Typography>
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
          <Button size="small" variant="outlined" disabled={!draftValid} onClick={addItem}>
            add access item
          </Button>
        </Box>
      </Box>

      <Stack direction="row" useFlexGap spacing="1rem" sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ id: product.id, accessItems: items })}
        >
          {save.isPending ? 'saving…' : 'save access'}
        </Button>
        {save.isSuccess && !dirty ? <Chip label="saved" variant="outlined" color="success" /> : null}
      </Stack>

      {save.isError ? <MutationError error={save.error} /> : null}
    </Stack>
  );
};
