import { Chip, Stack, Typography } from '@mui/material';

import type { PublicSpaceEvent } from '#core/domain/index.js';

import { useTranslations } from '../../../i18n/index.js';
import { LessonMediaClip, LessonMediaFrame, LessonMediaIframe } from '../../../theme.js';
import { hasEnded } from './event-time.js';

const EMBED_ALLOW = 'accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture;';

const EventEmbed = ({ src, title, testId }: { src: string; title: string; testId: string }) => (
  <LessonMediaFrame sx={{ aspectRatio: '16 / 9' }}>
    <LessonMediaClip>
      <LessonMediaIframe
        src={src}
        title={title}
        allow={EMBED_ALLOW}
        allowFullScreen
        data-testid={testId}
      />
    </LessonMediaClip>
  </LessonMediaFrame>
);

export const EventMedia = ({ event }: { event: PublicSpaceEvent }) => {
  const t = useTranslations();

  if (event.liveNow && event.liveEmbedUrl !== null) {
    return (
      <Stack useFlexGap sx={{ rowGap: '0.75rem' }} data-testid="event-live">
        <Stack direction="row" useFlexGap sx={{ columnGap: '0.75rem', alignItems: 'center' }}>
          <Typography variant="h3" component="h2">
            {t.events.liveHeading}
          </Typography>
          <Chip size="small" color="error" label={t.events.liveBadge} />
        </Stack>
        <EventEmbed
          src={event.liveEmbedUrl}
          title={t.events.liveFrameTitle}
          testId="event-live-embed"
        />
      </Stack>
    );
  }

  if (event.replayUrl !== null && hasEnded(event.endsAt)) {
    return (
      <Stack useFlexGap sx={{ rowGap: '0.75rem' }} data-testid="event-replay">
        <Typography variant="h3" component="h2">
          {t.events.replay}
        </Typography>
        <EventEmbed
          src={event.replayUrl}
          title={t.events.replayFrameTitle}
          testId="event-replay-embed"
        />
      </Stack>
    );
  }

  return null;
};
