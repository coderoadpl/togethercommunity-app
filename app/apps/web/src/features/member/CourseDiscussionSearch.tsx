import { useId, useState } from 'react';
import { Alert, Box, Link, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import type { CourseStructureWithAccess, PostSearchHit } from '@core/domain/index.js';

import { actions } from '../../api.js';
import { SearchField, useDebouncedValue } from '../../components/ui/SearchField.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { DiscussionHitSnippet, Eyebrow, TreeChapterTitle } from '../../theme.js';
import { Highlighted } from './highlight.js';

const MIN_SEARCH_LENGTH = 2;

const groupByLesson = (hits: PostSearchHit[]): Array<{ lessonId: string; hits: PostSearchHit[] }> => {
  const groups: Array<{ lessonId: string; hits: PostSearchHit[] }> = [];
  for (const hit of hits) {
    const existing = groups.find((group) => group.lessonId === hit.lessonId);
    if (existing) {
      existing.hits.push(hit);
    } else {
      groups.push({ lessonId: hit.lessonId, hits: [hit] });
    }
  }
  return groups;
};

export const CourseDiscussionSearch = ({
  courseId,
  structure,
}: {
  courseId: string;
  structure: CourseStructureWithAccess;
}) => {
  const t = useTranslations();
  const headingId = useId();
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term).trim();
  const enabled = debounced.length >= MIN_SEARCH_LENGTH;

  const lessonEntries = structure.modules.flatMap((module) =>
    module.chapters.flatMap((chapter) => chapter.lessons),
  );
  const lessonIds = [...new Set(lessonEntries.map((entry) => entry.lessonId))];
  const nameByLesson = new Map(lessonEntries.map((entry) => [entry.lessonId, entry.name]));

  const search = useQuery({
    ...actions.postsSearch({ query: debounced, lessonIds }),
    enabled: enabled && lessonIds.length > 0,
  });

  const groups = groupByLesson(search.data?.hits ?? []);

  return (
    <Paper
      elevation={1}
      component="section"
      aria-labelledby={headingId}
      data-testid="course-discussion-search"
      sx={{ p: '1.25rem' }}
    >
      <Stack useFlexGap sx={{ rowGap: '0.75rem' }}>
        <Eyebrow variant="overline" component="h2" id={headingId}>
          {t.discussion.searchCourseHeading}
        </Eyebrow>
        <SearchField
          value={term}
          onChange={setTerm}
          placeholder={t.discussion.searchCoursePlaceholder}
          testId="course-discussion-search-input"
        />
        {enabled &&
          (search.isPending ? (
            <Typography variant="body2">{t.discussion.searching}</Typography>
          ) : search.isError ? (
            <Alert>{localizeError(search.error, t)}</Alert>
          ) : groups.length === 0 ? (
            <Typography variant="body2" data-testid="course-search-empty">
              {t.discussion.searchCourseEmpty}
            </Typography>
          ) : (
            <Stack useFlexGap sx={{ rowGap: '1rem' }} data-testid="course-search-results">
              {groups.map((group) => (
                <Box key={group.lessonId} data-testid={`search-group-${group.lessonId}`}>
                  <TreeChapterTitle component="h3">
                    {nameByLesson.get(group.lessonId) ?? group.lessonId}
                  </TreeChapterTitle>
                  <Stack useFlexGap sx={{ rowGap: '0.5rem', mt: '0.35rem' }}>
                    {group.hits.map((hit) => (
                      <Box key={hit.post.id}>
                        <Link
                          href={`/my/courses/${courseId}/lessons/${hit.lessonId}`}
                          data-testid={`course-search-hit-${hit.post.id}`}
                        >
                          {hit.post.authorDisplay}
                        </Link>
                        <DiscussionHitSnippet variant="body2" component="p">
                          <Highlighted text={hit.snippet} query={debounced} />
                        </DiscussionHitSnippet>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              ))}
            </Stack>
          ))}
      </Stack>
    </Paper>
  );
};
