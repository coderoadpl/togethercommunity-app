import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Alert, Box, Button, Skeleton, Stack, Typography } from '@mui/material';
import { type SxProps, type Theme } from '@mui/material/styles';

import { useTranslations } from '../../i18n/index.js';
import { LessonMediaClip, LessonMediaFrame, LessonMediaIframe } from '../../theme.js';

export const LessonMediaError = ({ message, onRetry, externalUrl }: {
  message: string;
  onRetry: () => void;
  externalUrl?: string;
}) => {
  const t = useTranslations();
  return (
    <Stack role="status" spacing={1} sx={{ p: '1rem', minHeight: '100%', justifyContent: 'center', alignItems: 'center' }}>
      <Typography align="center">{message}</Typography>
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', justifyContent: 'center', gap: '0.5rem' }}>
        <Button variant="outlined" onClick={onRetry}>{t.common.retry}</Button>
        {externalUrl === undefined ? null : (
          <Button component="a" href={externalUrl} target="_blank" rel="noopener noreferrer" variant="outlined">
            {t.lesson.mediaOpenExternal}
          </Button>
        )}
      </Stack>
    </Stack>
  );
};

type EmbedProps = { frameSx: SxProps<Theme>; src: string; failureMessage?: string; externalUrl?: string } & ComponentProps<typeof LessonMediaIframe>;

const MediaAttempt = ({ frameSx, src, failureMessage, externalUrl, ...iframeProps }: EmbedProps) => {
  const t = useTranslations();
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (state !== 'loading' || iframeProps.loading === 'lazy') return;
    const timer = window.setTimeout(() => setState('failed'), 15_000);
    return () => window.clearTimeout(timer);
  }, [state, attempt, iframeProps.loading]);
  return (
    <LessonMediaFrame sx={[...(Array.isArray(frameSx) ? frameSx : [frameSx]), ...(state === 'failed' ? [{ display: 'grid', height: 'auto', maxHeight: 'none' }] : [])]}>
        {state === 'failed' ? (
          <LessonMediaError message={failureMessage ?? t.lesson.mediaFailedTitle} {...(externalUrl === undefined ? {} : { externalUrl })} onRetry={() => {
            setAttempt((value) => value + 1);
            setState('loading');
          }} />
        ) : (
          <LessonMediaClip>
            {state === 'loading' ? <Skeleton variant="rectangular" data-testid="lesson-media-skeleton" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} /> : null}
            <LessonMediaIframe {...iframeProps} key={attempt} src={src} onLoad={() => setState('loaded')} onErrorCapture={() => setState('failed')} />
          </LessonMediaClip>
        )}
    </LessonMediaFrame>
  );
};

export const LessonMediaEmbed = (props: EmbedProps) => <MediaAttempt key={props.src} {...props} />;

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
