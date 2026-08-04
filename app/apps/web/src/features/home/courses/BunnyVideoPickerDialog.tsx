import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';
import type { StreamVideo } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { SearchField, useDebouncedValue } from '../../../components/ui/SearchField.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDate } from '../../../lib/format.js';
import { errorMessage } from './feedback.js';

const formatVideoLength = (lengthSeconds: number): string => {
  const hours = Math.floor(lengthSeconds / 3600);
  const minutes = Math.floor((lengthSeconds % 3600) / 60);
  const seconds = lengthSeconds % 60;
  const padded = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${padded(minutes)}:${padded(seconds)}` : `${minutes}:${padded(seconds)}`;
};

export const BunnyVideoPickerDialog = ({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (video: StreamVideo, libraryId: string) => void;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const query = useDebouncedValue(search);
  const videos = useQuery(actions.bunnyVideos({ search: query, page }));

  const notConfigured =
    videos.error instanceof ApiError && videos.error.appError.code === 'integration_not_configured';
  const result = videos.data?.page;
  const pageCount = result === undefined ? 1 : Math.max(1, Math.ceil(result.totalItems / result.pageSize));

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="bunny-picker-title">
      <DialogTitle id="bunny-picker-title">{t.lessons.videoPickerTitle}</DialogTitle>
      <DialogContent>
        <Stack useFlexGap spacing="0.9rem" sx={{ pt: '0.25rem' }}>
          <SearchField
            value={search}
            onChange={(next) => {
              setSearch(next);
              setPage(1);
            }}
            placeholder={t.lessons.videoPickerSearchPlaceholder}
            testId="bunny-picker-search"
          />
          {videos.isPending ? (
            <Typography variant="body2">{t.lessons.videoPickerLoading}</Typography>
          ) : notConfigured ? (
            <Stack useFlexGap spacing="0.5rem" data-testid="bunny-picker-not-configured">
              <Typography variant="body2">{t.lessons.videoPickerNotConfigured}</Typography>
              <Box>
                <Link href="/panel/integrations">{t.lessons.videoPickerOpenIntegrations}</Link>
              </Box>
              <Typography variant="caption" component="p">
                {t.lessons.videoPickerManualHint}
              </Typography>
            </Stack>
          ) : videos.isError ? (
            <Alert severity="error" data-testid="bunny-picker-error">{errorMessage(videos.error, t)}</Alert>
          ) : result === undefined || result.videos.length === 0 ? (
            <Typography variant="body2" data-testid="bunny-picker-empty">
              {query.trim().length > 0 ? t.lessons.videoPickerNoMatches : t.lessons.videoPickerEmptyLibrary}
            </Typography>
          ) : (
            <>
              <List disablePadding data-testid="bunny-picker-list">
                {result.videos.map((video) => (
                  <ListItemButton
                    key={video.id}
                    aria-label={t.lessons.videoPickerSelectAria({ title: video.title })}
                    data-testid="bunny-picker-video"
                    onClick={() => {
                      onSelect(video, result.libraryId);
                      onClose();
                    }}
                  >
                    <ListItemText
                      primary={video.title}
                      secondary={`${formatVideoLength(video.lengthSeconds)} · ${formatDate(video.uploadedAt, language)}`}
                    />
                  </ListItemButton>
                ))}
              </List>
              {pageCount > 1 ? (
                <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ alignItems: 'center' }}>
                  <Button
                    size="small"
                    variant="text"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    {t.lessons.videoPickerPrevPage}
                  </Button>
                  <Typography variant="caption">
                    {t.lessons.videoPickerPageInfo({ page, pages: pageCount })}
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    disabled={page >= pageCount}
                    onClick={() => setPage(page + 1)}
                  >
                    {t.lessons.videoPickerNextPage}
                  </Button>
                </Stack>
              ) : null}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          {t.common.cancel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
