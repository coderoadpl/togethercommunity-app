import { useState, type ReactNode } from 'react';
import { Box, Stack, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { createLink } from '@tanstack/react-router';

import { translateDeletedContent } from '../../i18n/deleted-content.js';
import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { useDebouncedValue } from '../../components/ui/SearchField.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { DiscussionHitCard, DiscussionHitChevron, DiscussionHitSnippet, DiscussionHitText, PostAuthorName } from '../../theme.js';
import { Highlighted } from './highlight.js';
import { ThreadDiscussion } from './ThreadDiscussion.js';

const MIN_SEARCH_LENGTH = 2;

const HitCardLink = createLink(DiscussionHitCard);

const HitChevron = () => (
  <DiscussionHitChevron aria-hidden data-testid="search-hit-chevron" viewBox="0 0 24 24"><path d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z" /></DiscussionHitChevron>
);

interface LessonPlace {
  courseId: string;
  lessonId: string;
  editionNumber?: string | undefined;
}

const ThreadHitLink = ({ place, rootPostId, testId, label, children }: { place: LessonPlace; rootPostId: string; testId: string; label: string; children: ReactNode }) => {
  const { courseId, lessonId, editionNumber } = place;
  return editionNumber === undefined ? (
    <HitCardLink
      to="/my/courses/$courseId/lessons/$lessonId"
      params={{ courseId, lessonId }}
      search={{ thread: rootPostId }}
      underline="none"
      aria-label={label}
      data-testid={testId}
    >
      {children}
    </HitCardLink>
  ) : (
    <HitCardLink
      to="/my/courses/$courseId/lessons/$lessonId/editions/$number"
      params={{ courseId, lessonId, number: editionNumber }}
      search={{ thread: rootPostId }}
      underline="none"
      aria-label={label}
      data-testid={testId}
    >
      {children}
    </HitCardLink>
  );
};

const LessonDiscussionSearch = ({ place }: { place: LessonPlace }) => {
  const { lessonId } = place;
  const t = useTranslations();
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term).trim();
  const enabled = debounced.length >= MIN_SEARCH_LENGTH;
  const search = useQuery({
    ...actions.postsSearch({ query: debounced, lessonIds: [lessonId] }),
    enabled,
  });

  return (
    <Stack useFlexGap sx={{ rowGap: '0.75rem' }}>
      <TextField
        type="search"
        size="small"
        label={t.discussion.searchLabel}
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        slotProps={{ htmlInput: { 'data-testid': 'discussion-search-input' } }}
      />
      {enabled && (
        <Box data-testid="discussion-search-results">
          {search.isPending ? (
            <Typography variant="body2">{t.discussion.searching}</Typography>
          ) : search.isError ? (
            <StatusView surface={false} state={{ kind: 'error', message: localizeError(search.error, t), retry: { label: t.common.retry, onRetry: () => void search.refetch() } }} />
          ) : search.data.hits.length === 0 ? (
            <Stack useFlexGap sx={{ rowGap: '0.35rem' }} data-testid="discussion-search-empty">
              <Typography variant="body2">{t.discussion.searchEmpty}</Typography>
              <Typography variant="caption" color="text.secondary" data-testid="discussion-search-hint">
                {t.discussion.searchHint} {t.search.stemHint}
              </Typography>
            </Stack>
          ) : (
            <Stack component="ul" useFlexGap sx={{ rowGap: '0.5rem', m: 0, p: 0, listStyle: 'none' }}>
              {search.data.hits.map((hit) => {
                const author = translateDeletedContent(hit.post.authorDisplay, t);
                return (
                  <li key={hit.post.id} data-testid={`search-hit-${hit.post.id}`}>
                    <ThreadHitLink place={place} rootPostId={hit.post.rootPostId} testId={`search-hit-link-${hit.post.id}`} label={`${author} ${hit.snippet}`}>
                      <DiscussionHitText>
                        <PostAuthorName component="span">{author}</PostAuthorName>
                        <DiscussionHitSnippet variant="body2" component="span">
                          <Highlighted text={hit.snippet} query={debounced} />
                        </DiscussionHitSnippet>
                      </DiscussionHitText>
                      <HitChevron />
                    </ThreadHitLink>
                  </li>
                );
              })}
            </Stack>
          )}
        </Box>
      )}
    </Stack>
  );
};

export const DiscussionSection = ({
  courseId,
  lessonId,
  editionNumber,
  focusThread,
}: {
  courseId: string;
  lessonId: string;
  editionNumber?: string | undefined;
  focusThread?: { rootPostId: string; onExit: () => void };
}) => {
  const t = useTranslations();
  return (
    <ThreadDiscussion
      context={{ contextKind: 'lesson', contextId: lessonId }}
      heading={t.discussion.heading}
      eyebrow={t.discussion.eyebrow}
      search={<LessonDiscussionSearch place={{ courseId, lessonId, editionNumber }} />}
      {...(focusThread === undefined
        ? {}
        : { focus: { ...focusThread, exitLabel: t.discussion.backToAll } })}
    />
  );
};
