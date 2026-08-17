import { useEffect, useState, type ReactNode } from 'react';
import { Box, Link as MuiLink, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import { communityPostPath, lessonPath } from '#core/contract/index.js';
import type { CourseStructureWithAccess, PostSearchHit } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { SearchField, useDebouncedValue } from '../../components/ui/SearchField.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { DiscussionHitSnippet, TreeChapterTitle } from '../../theme.js';
import { Highlighted } from './highlight.js';
import { MemberSurface } from './MemberSurface.js';

const MIN_SEARCH_LENGTH = 2;

interface LessonPlacement {
  courseId: string;
  lessonName: string;
}

interface LessonIndex {
  placements: ReadonlyMap<string, LessonPlacement>;
  pending: boolean;
}

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const withCourseLessons = (
  index: LessonIndex,
  courseId: string,
  structure: CourseStructureWithAccess,
): LessonIndex => {
  const placements = new Map(index.placements);
  for (const module of structure.modules) {
    for (const chapter of module.chapters) {
      for (const lesson of chapter.lessons) {
        placements.set(lesson.lessonId, { courseId, lessonName: lesson.name });
      }
    }
  }
  return { placements, pending: index.pending };
};

/**
 * One `useQuery` per course, chained instead of `useQueries`: descriptor
 * arrays built at runtime are not accepted by `together/query-descriptors-only`.
 */
const CourseLessons = ({
  courseId,
  rest,
  index,
  render,
}: {
  courseId: string;
  rest: readonly string[];
  index: LessonIndex;
  render: (index: LessonIndex) => ReactNode;
}) => {
  const structure = useQuery(actions.courseStructure(courseId));
  const resolved = structure.data === undefined
    ? { placements: index.placements, pending: index.pending || structure.isPending }
    : withCourseLessons(index, courseId, structure.data.structure);
  return <LessonIndexLoader courseIds={rest} index={resolved} render={render} />;
};

const LessonIndexLoader = ({
  courseIds,
  index,
  render,
}: {
  courseIds: readonly string[];
  index: LessonIndex;
  render: (index: LessonIndex) => ReactNode;
}) => {
  const [courseId, ...rest] = courseIds;
  return courseId === undefined ? (
    render(index)
  ) : (
    <CourseLessons courseId={courseId} rest={rest} index={index} render={render} />
  );
};

const groupByContext = (
  hits: PostSearchHit[],
): Array<{ contextId: string; hits: PostSearchHit[] }> => {
  const groups: Array<{ contextId: string; hits: PostSearchHit[] }> = [];
  for (const hit of hits) {
    const existing = groups.find((group) => group.contextId === hit.lessonId);
    if (existing) {
      existing.hits.push(hit);
    } else {
      groups.push({ contextId: hit.lessonId, hits: [hit] });
    }
  }
  return groups;
};

const HitRow = ({
  hit,
  query,
  href,
}: {
  hit: PostSearchHit;
  query: string;
  href: string | null;
}) => (
  <Box>
    {href === null ? (
      <Typography variant="body2" component="p" data-testid={`search-hit-${hit.post.id}`}>
        {hit.post.authorDisplay}
      </Typography>
    ) : (
      <MuiLink component={Link} to={href} data-testid={`search-hit-${hit.post.id}`}>
        {hit.post.authorDisplay}
      </MuiLink>
    )}
    <DiscussionHitSnippet variant="body2" component="p">
      <Highlighted text={hit.snippet} query={query} />
    </DiscussionHitSnippet>
  </Box>
);

const ResultSection = ({
  heading,
  testId,
  children,
}: {
  heading: string;
  testId: string;
  children: ReactNode;
}) => (
  <Box component="section" data-testid={testId}>
    <Typography variant="h3" component="h2" sx={{ mb: '0.75rem' }}>
      {heading}
    </Typography>
    <Stack useFlexGap sx={{ rowGap: '1rem' }}>
      {children}
    </Stack>
  </Box>
);

const HitGroup = ({
  heading,
  testId,
  hits,
  query,
  hrefOf,
}: {
  heading: string;
  testId: string;
  hits: PostSearchHit[];
  query: string;
  hrefOf: (hit: PostSearchHit) => string;
}) => (
  <Box data-testid={testId}>
    <TreeChapterTitle component="h3">{heading}</TreeChapterTitle>
    <Stack useFlexGap sx={{ rowGap: '0.5rem', mt: '0.35rem' }}>
      {hits.map((hit) => (
        <HitRow key={hit.post.id} hit={hit} query={query} href={hrefOf(hit)} />
      ))}
    </Stack>
  </Box>
);

const SearchResults = ({
  hits,
  spaceNames,
  index,
  query,
}: {
  hits: PostSearchHit[];
  spaceNames: ReadonlyMap<string, string>;
  index: LessonIndex;
  query: string;
}) => {
  const t = useTranslations();
  const spaceHits = hits.filter((hit) => hit.post.contextKind === 'space');
  const lessonHits = hits.filter((hit) => hit.post.contextKind === 'lesson');
  const placed = lessonHits.filter((hit) => index.placements.has(hit.lessonId));
  const unplaced = index.pending
    ? []
    : lessonHits.filter((hit) => !index.placements.has(hit.lessonId));

  return (
    <Stack useFlexGap sx={{ rowGap: '2rem' }} data-testid="search-results">
      {spaceHits.length === 0 ? null : (
        <ResultSection heading={t.search.spacesHeading} testId="search-spaces">
          {groupByContext(spaceHits).map((group) => (
            <HitGroup
              key={group.contextId}
              heading={spaceNames.get(group.contextId) ?? group.contextId}
              testId={`search-space-${group.contextId}`}
              hits={group.hits}
              query={query}
              hrefOf={(hit) => communityPostPath(group.contextId, hit.post.rootPostId)}
            />
          ))}
        </ResultSection>
      )}
      {lessonHits.length === 0 ? null : (
        <ResultSection heading={t.search.lessonsHeading} testId="search-lessons">
          {index.pending && placed.length === 0 ? (
            <Typography variant="body2">{t.discussion.searching}</Typography>
          ) : null}
          {groupByContext(placed).map((group) => {
            const placement = index.placements.get(group.contextId);
            return placement === undefined ? null : (
              <HitGroup
                key={group.contextId}
                heading={placement.lessonName}
                testId={`search-lesson-${group.contextId}`}
                hits={group.hits}
                query={query}
                hrefOf={() => lessonPath(placement.courseId, group.contextId)}
              />
            );
          })}
        </ResultSection>
      )}
      {unplaced.length === 0 ? null : (
        <ResultSection heading={t.search.unresolvedHeading} testId="search-unresolved">
          {unplaced.map((hit) => (
            <HitRow key={hit.post.id} hit={hit} query={query} href={null} />
          ))}
        </ResultSection>
      )}
    </Stack>
  );
};

export const SearchPage = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term).trim();
  const enabled = debounced.length >= MIN_SEARCH_LENGTH;
  const navigation = useQuery(actions.memberNavigation);
  const search = useQuery({ ...actions.postsSearch({ query: debounced }), enabled });
  const unauthorized = isUnauthorized(navigation.error) || isUnauthorized(search.error);

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  if (unauthorized) return null;

  const hits = search.data?.hits ?? [];
  const spaceNames = new Map(
    (navigation.data?.navigation.spaces ?? []).map((space) => [space.id, space.name]),
  );
  const courseIds = hits.some((hit) => hit.post.contextKind === 'lesson')
    ? (navigation.data?.navigation.courses ?? []).map((course) => course.courseId)
    : [];

  return (
    <MemberSurface title={t.search.title} eyebrow={t.search.eyebrow}>
      <Stack useFlexGap sx={{ rowGap: '1rem' }}>
        <SearchField
          value={term}
          onChange={setTerm}
          label={t.search.inputLabel}
          placeholder={t.search.placeholder}
          testId="search-input"
        />
        <Typography variant="caption" color="text.secondary" data-testid="search-hint">
          {t.discussion.searchWholeWordsHint}
        </Typography>
        {!enabled ? null : search.isPending ? (
          <Typography variant="body2">{t.discussion.searching}</Typography>
        ) : search.isError ? (
          <StatusView
            surface={false}
            state={{
              kind: 'error',
              message: localizeError(search.error, t),
              retry: { label: t.common.retry, onRetry: () => void search.refetch() },
            }}
          />
        ) : hits.length === 0 ? (
          <Typography variant="body2" data-testid="search-empty">
            {t.search.empty}
          </Typography>
        ) : (
          <LessonIndexLoader
            courseIds={courseIds}
            index={{ placements: new Map(), pending: false }}
            render={(index) => (
              <SearchResults hits={hits} spaceNames={spaceNames} index={index} query={debounced} />
            )}
          />
        )}
      </Stack>
    </MemberSurface>
  );
};
