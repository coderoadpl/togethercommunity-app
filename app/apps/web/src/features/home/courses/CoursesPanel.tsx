import { useState, type FormEvent } from 'react';
import {
  Button,
  Chip,
  FormControl,
  FormLabel,
  List,
  ListItem,
  ListItemText,
  OutlinedInput,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import type { Course } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { ListSection, PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { ListPagination, usePagedList } from '../../../components/ui/ListPagination.js';
import { matchesQuery, SearchField, useDebouncedValue } from '../../../components/ui/SearchField.js';
import { localizeError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDate } from '../../../lib/format.js';
import { DataValue, EntryDate } from '../../../theme.js';
import { MutationError } from './feedback.js';

const CreateCourseForm = ({ onCreated }: { onCreated: (courseId: string) => void }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const createCourse = useMutation({
    ...actions.createCourse,
    onSuccess: async ({ course }) => {
      await queryClient.invalidateQueries(actions.coursesInvalidates());
      onCreated(course.id);
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
    <SectionCard title={t.courses.detailsHeading} onSubmit={submit}>
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
    </SectionCard>
  );
};

export const CoursesListPanel = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const courses = useQuery(actions.courses);
  const modules = useQuery(actions.modules);
  const [search, setSearch] = useState('');
  const [structureFilter, setStructureFilter] = useState<'all' | 'with-modules' | 'without-modules'>('all');
  const query = useDebouncedValue(search);

  const moduleCount = (course: Course): number =>
    modules.data ? modules.data.modules.filter((module) => module.courseIds.includes(course.id)).length : 0;

  const openCourse = (courseId: string) =>
    void navigate({ to: '/panel/courses/$courseId', params: { courseId } });

  const visibleCourses = (courses.data?.courses ?? [])
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((course) => matchesQuery(query, course.name))
    .filter((course) => {
      if (structureFilter === 'all') return true;
      return structureFilter === 'with-modules' ? moduleCount(course) > 0 : moduleCount(course) === 0;
    });
  const paged = usePagedList(visibleCourses, `${query}|${structureFilter}`);
  const filterLabels = {
    all: t.courses.filterAll,
    'with-modules': t.courses.filterWithModules,
    'without-modules': t.courses.filterWithoutModules,
  } as const;

  return (
    <PanelPage
      title={t.sections.courses}
      action={<Button component={Link} to="/panel/courses/new" variant="contained">+ {t.common.add}</Button>}
    >
      <ListSection
        toolbar={{
          search: (
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t.courses.searchPlaceholder}
            testId="courses-search"
          />
          ),
          filters: (
            <Stack direction="row" useFlexGap spacing="0.4rem" role="group" aria-label={t.courses.structureFilterAria}>
              {(['all', 'with-modules', 'without-modules'] as const).map((value) => (
                <Chip
                  key={value}
                  size="small"
                  clickable
                  variant={structureFilter === value ? 'filled' : 'outlined'}
                  color={structureFilter === value ? 'primary' : 'default'}
                  label={filterLabels[value]}
                  aria-pressed={structureFilter === value}
                  onClick={() => setStructureFilter(value)}
                />
              ))}
            </Stack>
          ),
        }}
        pagination={courses.isSuccess && visibleCourses.length > 0 ? <ListPagination paged={paged} testId="courses-pagination" /> : undefined}
        isEmpty={courses.isSuccess && courses.data.courses.length === 0}
        empty={<StatusView state={{ kind: 'empty', title: t.courses.empty, action: <Button component={Link} to="/panel/courses/new">+ {t.common.add}</Button> }} />}
        noMatches={courses.isSuccess && courses.data.courses.length > 0 && visibleCourses.length === 0 ? <Typography variant="body1">{t.courses.noMatches}</Typography> : undefined}
      >
        {courses.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.courses.loading }} />
        ) : courses.isError ? (
          <StatusView state={{ kind: 'error', message: localizeError(courses.error, t) }} />
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
      </ListSection>
    </PanelPage>
  );
};

export const CourseCreatePage = () => {
  const t = useTranslations();
  const navigate = useNavigate();

  return (
    <PanelPage title={t.courses.newCourse} backTo={{ label: t.courses.allCourses, href: '/panel/courses' }}>
      <CreateCourseForm
        onCreated={(courseId) => void navigate({ to: '/panel/courses/$courseId', params: { courseId } })}
      />
    </PanelPage>
  );
};
