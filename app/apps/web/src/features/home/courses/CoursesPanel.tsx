import { useState, type FormEvent } from 'react';
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
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type { Course } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDate } from '../../../lib/format.js';
import { DataValue, EntryDate } from '../../../theme.js';
import { MutationError } from './feedback.js';

const CreateCourseForm = () => {
  const t = useTranslations();
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
        {t.courses.newCourse}
      </Typography>
      <FormControl fullWidth>
        <FormLabel htmlFor="course-name">{t.common.name}</FormLabel>
        <OutlinedInput id="course-name" value={name} onChange={(event) => setName(event.target.value)} required />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="course-description">{t.common.description}</FormLabel>
        <OutlinedInput
          id="course-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          multiline
          minRows={3}
        />
      </FormControl>
      <FormControl fullWidth>
        <FormLabel htmlFor="course-image">{t.courses.imageUrl}</FormLabel>
        <OutlinedInput
          id="course-image"
          value={imageUrl}
          onChange={(event) => setImageUrl(event.target.value)}
          placeholder="https://…"
        />
      </FormControl>
      <Button type="submit" variant="contained" disabled={createCourse.isPending || name.trim().length === 0}>
        {createCourse.isPending ? t.courses.creating : t.courses.create}
      </Button>
      {createCourse.isError ? <MutationError error={createCourse.error} /> : null}
    </Paper>
  );
};

export const CoursesListPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const courses = useQuery(actions.courses);
  const modules = useQuery(actions.modules);

  const moduleCount = (course: Course): number =>
    modules.data ? modules.data.modules.filter((module) => module.courseIds.includes(course.id)).length : 0;

  const openCourse = (courseId: string) =>
    void navigate({ to: '/panel/courses/$courseId', params: { courseId } });

  return (
    <Stack useFlexGap spacing="2rem">
      <CreateCourseForm />
      <Box component="section">
        <Typography variant="h2" component="h3" sx={{ mb: '1rem' }}>
          {t.courses.heading}
        </Typography>
        {courses.isPending ? (
          <Typography variant="body1">{t.courses.loading}</Typography>
        ) : courses.isError ? (
          <MutationError error={courses.error} />
        ) : courses.data.courses.length === 0 ? (
          <Typography variant="body1">{t.courses.empty}</Typography>
        ) : (
          <List disablePadding>
            {courses.data.courses.map((course) => (
              <ListItem
                key={course.id}
                data-testid="course-row"
                secondaryAction={
                  <Button variant="text" onClick={() => openCourse(course.id)}>
                    {t.courses.manage}
                  </Button>
                }
              >
                <ListItemText
                  primary={course.name}
                  slotProps={{ secondary: { component: 'div' } }}
                  secondary={
                    <Stack useFlexGap spacing="0.2rem">
                      <span>
                        <DataValue>{moduleCount(course)}</DataValue>{' '}
                        {t.courses.moduleNoun({ count: moduleCount(course) })}
                      </span>
                      <EntryDate component="time" dateTime={course.createdAt}>
                        {formatDate(course.createdAt, language)}
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
