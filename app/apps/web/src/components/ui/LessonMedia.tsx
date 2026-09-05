import { useState, type ComponentProps, type ReactNode } from 'react';
import { Alert, Box, Button, Skeleton, Stack } from '@mui/material';
import { type SxProps, type Theme } from '@mui/material/styles';

import { useTranslations } from '../../i18n/index.js';
import { LessonMediaClip, LessonMediaFrame, LessonMediaIframe } from '../../theme.js';

export const LessonMediaEmbed = ({
  frameSx,
  src,
  ...iframeProps
}: { frameSx: SxProps<Theme>; src: string } & ComponentProps<typeof LessonMediaIframe>) => {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  return (
    <LessonMediaFrame sx={frameSx}>
      <LessonMediaClip>
        {loadedSrc === src ? null : (
          <Skeleton
            variant="rectangular"
            data-testid="lesson-media-skeleton"
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />
        )}
        <LessonMediaIframe {...iframeProps} src={src} onLoad={() => setLoadedSrc(src)} />
      </LessonMediaClip>
    </LessonMediaFrame>
  );
};

/**
 * Authors mark embeds whose code calls alert/confirm/prompt as collapsed: the
 * iframe must stay unmounted until the reader asks for it, otherwise the dialogs
 * fire while the lesson is still loading.
 */
export const CollapsibleEmbed = ({ children }: { children: ReactNode }) => {
  const t = useTranslations();
  const [expanded, setExpanded] = useState(false);
  return (
    <Stack useFlexGap spacing="0.75rem" sx={{ minWidth: 0 }}>
      {expanded ? null : (
        <Alert severity="warning" data-testid="lesson-embed-collapsed-warning">
          {t.lesson.collapsedEmbedWarning}
        </Alert>
      )}
      <Box>
        <Button
          variant="outlined"
          data-testid="lesson-embed-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t.lesson.collapseEmbed : t.lesson.expandEmbed}
        </Button>
      </Box>
      {expanded ? children : null}
    </Stack>
  );
};
