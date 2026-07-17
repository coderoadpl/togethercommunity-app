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
import { StatusView } from '../../../components/layout/index.js';
import { ListPagination, usePagedList } from '../../../components/ui/ListPagination.js';
import { matchesQuery, SearchField, useDebouncedValue } from '../../../components/ui/SearchField.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
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
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search);

  const moduleCount = (course: Course): number =>
    modules.data ? modules.data.modules.filter((module) => module.courseIds.includes(course.id)).length : 0;

  const openCourse = (courseId: string) =>
    void navigate({ to: '/panel/courses/$courseId', params: { courseId } });

  const visibleCourses = (courses.data?.courses ?? [])
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((course) => matchesQuery(query, course.name));
  const paged = usePagedList(visibleCourses, query);

  return (
    <Stack useFlexGap spacing="2rem">
      <CreateCourseForm />
      <Box component="section">
        <Stack
          direction="row"
          useFlexGap
          sx={{ mb: '1rem', flexWrap: 'wrap', alignItems: 'center', columnGap: '1rem', rowGap: '0.6rem' }}
        >
          <Typography variant="h2" component="h3">
            {t.courses.heading}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t.courses.searchPlaceholder}
            testId="courses-search"
          />
        </Stack>
        {courses.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.courses.loading }} />
        ) : courses.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(courses.error, t) }} />
        ) : courses.data.courses.length === 0 ? (
          <StatusView state={{ kind: 'empty', title: t.courses.empty }} />
        ) : visibleCourses.length === 0 ? (
          <Typography variant="body1">{t.courses.noMatches}</Typography>
        ) : (
          <List disablePadding dense>
            {paged.pageItems.map((course) => (
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
        <ListPagination paged={paged} testId="courses-pagination" />
      </Box>
    </Stack>
  );
};
