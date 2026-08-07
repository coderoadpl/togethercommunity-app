import { useState } from 'react';
import { Alert, Box, Stack, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../api.js';
import { useDebouncedValue } from '../../components/ui/SearchField.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { DiscussionHitSnippet, DiscussionThread, PostAuthorName } from '../../theme.js';
import { Highlighted } from './highlight.js';
import { ThreadDiscussion } from './ThreadDiscussion.js';

const MIN_SEARCH_LENGTH = 2;

const LessonDiscussionSearch = ({ lessonId }: { lessonId: string }) => {
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
      <Typography variant="caption" color="text.secondary" data-testid="discussion-search-hint">
        {t.discussion.searchWholeWordsHint}
      </Typography>
      {enabled && (
        <Box data-testid="discussion-search-results">
          {search.isPending ? (
            <Typography variant="body2">{t.discussion.searching}</Typography>
          ) : search.isError ? (
            <Alert severity="error">{localizeError(search.error, t)}</Alert>
          ) : search.data.hits.length === 0 ? (
            <Typography variant="body2" data-testid="discussion-search-empty">
              {t.discussion.searchEmpty}
            </Typography>
          ) : (
            <Stack useFlexGap sx={{ rowGap: '0.5rem' }}>
              {search.data.hits.map((hit) => (
                <DiscussionThread key={hit.post.id} sx={{ p: '0.6rem 0.9rem' }} data-testid={`search-hit-${hit.post.id}`}>
                  <PostAuthorName component="span">{hit.post.authorDisplay}</PostAuthorName>
                  <DiscussionHitSnippet variant="body2" component="p">
                    <Highlighted text={hit.snippet} query={debounced} />
                  </DiscussionHitSnippet>
                </DiscussionThread>
              ))}
            </Stack>
          )}
        </Box>
      )}
    </Stack>
  );
};

export const DiscussionSection = ({ lessonId }: { lessonId: string }) => {
  const t = useTranslations();
  return (
    <ThreadDiscussion
      context={{ contextKind: 'lesson', contextId: lessonId }}
      heading={t.discussion.heading}
      eyebrow={t.discussion.eyebrow}
      search={<LessonDiscussionSearch lessonId={lessonId} />}
    />
  );
};
