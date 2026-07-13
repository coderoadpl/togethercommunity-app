import { useState, type FormEvent, type MouseEvent } from 'react';
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  List,
  ListItem,
  ListItemText,
  OutlinedInput,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Course } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { DataValue, EntryDate } from '../../../theme.js';
import { CourseDetail } from './CourseDetail.js';
import { displayDate, MutationError } from './feedback.js';
import { LessonsSection } from './LessonsSection.js';

const CreateCourseForm = () => {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const createCourse = useMutation({
    ...actions.createCourse,
    onSuccess: async () => {
      setName('');
      setDescription('');
      setImageUrl('');
      await queryClient.invalidateQueries(actions.coursesInvalidates());
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createCourse.mutate({
      name: name.trim(),
      description,
      imageUrl: imageUrl.trim() ? imageUrl.trim() : null,
    });
  };

  return (
    <Paper elevation={1} component="form" onSubmit={submit} sx={{ p: '1rem', display: 'grid', gap: '1rem' }}>
      <Typography variant="h2" component="h3">
        New course
      </Typography>
      <FormControl fullWidth>
        <FormLabel htmlFor="course-name">name</FormLabel>
        <OutlinedInput id="course-name" value={name} onChange={(event) => setName(event.target.value)} required />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="course-description">description</FormLabel>
        <OutlinedInput
          id="course-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          multiline
          minRows={3}
        />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="course-image">image URL</FormLabel>
        <OutlinedInput
          id="course-image"
          value={imageUrl}
          onChange={(event) => setImageUrl(event.target.value)}
          placeholder="https://…"
        />
      </FormControl>
      <Button type="submit" variant="contained" disabled={createCourse.isPending || name.trim().length === 0}>
        {createCourse.isPending ? 'creating…' : 'create course'}
      </Button>
      {createCourse.isError ? <MutationError error={createCourse.error} /> : null}
    </Paper>
  );
};

const CoursesSection = () => {
  const courses = useQuery(actions.courses);
  const modules = useQuery(actions.modules);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const moduleCount = (course: Course): number =>
    modules.data ? modules.data.modules.filter((module) => module.courseIds.includes(course.id)).length : 0;

  const selected = courses.data?.courses.find((course) => course.id === selectedId) ?? null;
  if (selected) return <CourseDetail course={selected} onBack={() => setSelectedId(null)} />;

  return (
    <Stack useFlexGap spacing="2rem">
      <CreateCourseForm />
      <Box component="section">
        <Typography variant="h2" component="h3" sx={{ mb: '1rem' }}>
          Courses
        </Typography>
        {courses.isPending ? (
          <Typography variant="body1">loading courses…</Typography>
        ) : courses.isError ? (
          <MutationError error={courses.error} />
        ) : courses.data.courses.length === 0 ? (
          <Typography variant="body1">No courses yet.</Typography>
        ) : (
          <List disablePadding>
            {courses.data.courses.map((course) => (
              <ListItem
                key={course.id}
                data-testid="course-row"
                secondaryAction={
                  <Button variant="text" onClick={() => setSelectedId(course.id)}>
                    manage
                  </Button>
                }
              >
                <ListItemText
                  primary={course.name}
                  slotProps={{ secondary: { component: 'div' } }}
                  secondary={
                    <Stack useFlexGap spacing="0.2rem">
                      <span>
                        <DataValue>{moduleCount(course)}</DataValue> module{moduleCount(course) === 1 ? '' : 's'}
                      </span>
                      <EntryDate component="time" dateTime={course.createdAt}>
                        {displayDate(course.createdAt)}
                      </EntryDate>
                    </Stack>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </Box>
    </Stack>
  );
};

type CoursesTab = 'tree' | 'lessons';

export const CoursesPanel = () => {
  const [tab, setTab] = useState<CoursesTab>('tree');

  const changeTab = (_event: MouseEvent<HTMLElement>, value: CoursesTab | null) => {
    if (value) setTab(value);
  };

  return (
    <Stack useFlexGap spacing="1.5rem">
      <ToggleButtonGroup exclusive value={tab} onChange={changeTab} aria-label="Course tree or lessons">
        <ToggleButton value="tree" data-testid="courses-tab-tree">
          Course tree
        </ToggleButton>
        <ToggleButton value="lessons" data-testid="courses-tab-lessons">
          Lessons
        </ToggleButton>
      </ToggleButtonGroup>
      {tab === 'tree' ? <CoursesSection /> : <LessonsSection />}
    </Stack>
  );
};
