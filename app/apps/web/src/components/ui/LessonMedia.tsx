import { useState, type ComponentProps } from 'react';
import { Skeleton } from '@mui/material';
import { type SxProps, type Theme } from '@mui/material/styles';

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
