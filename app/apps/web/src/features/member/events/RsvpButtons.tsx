import { useState } from 'react';
import { Alert, Button, Stack } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { PublicSpaceEvent, SpaceEventRsvpStatus } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { FinePrint } from '../../../theme.js';

interface Attendance {
  viewerRsvp: SpaceEventRsvpStatus | null;
  goingCount: number;
  notGoingCount: number;
}

const answered = (attendance: Attendance, status: SpaceEventRsvpStatus): Attendance => ({
  viewerRsvp: status,
  goingCount:
    attendance.goingCount
    + (status === 'going' ? 1 : 0)
    - (attendance.viewerRsvp === 'going' ? 1 : 0),
  notGoingCount:
    attendance.notGoingCount
    + (status === 'not-going' ? 1 : 0)
    - (attendance.viewerRsvp === 'not-going' ? 1 : 0),
});

export const RsvpButtons = ({ event }: { event: PublicSpaceEvent }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [override, setOverride] = useState<Attendance | null>(null);

  const rsvp = useMutation({
    ...actions.rsvpEvent,
    onSuccess: (updated) => setOverride(updated.event),
    onError: () => setOverride(null),
    onSettled: () => queryClient.invalidateQueries(actions.eventsInvalidates()),
  });

  const attendance = override ?? event;

  const answer = (status: SpaceEventRsvpStatus) => {
    setOverride(answered(attendance, status));
    rsvp.mutate({ eventId: event.id, status });
  };

  const rsvpButton = (status: SpaceEventRsvpStatus, label: string) => (
    <Button
      variant={attendance.viewerRsvp === status ? 'contained' : 'outlined'}
      aria-pressed={attendance.viewerRsvp === status}
      disabled={rsvp.isPending}
      data-testid={`event-rsvp-${status}`}
      onClick={() => answer(status)}
    >
      {label}
    </Button>
  );

  return (
    <Stack useFlexGap sx={{ rowGap: '0.6rem' }} data-testid="event-rsvp">
      <Stack direction="row" useFlexGap sx={{ columnGap: '0.75rem', flexWrap: 'wrap' }}>
        {rsvpButton('going', t.events.rsvpGoing)}
        {rsvpButton('not-going', t.events.rsvpNotGoing)}
      </Stack>
      <Stack direction="row" useFlexGap sx={{ columnGap: '1rem', flexWrap: 'wrap' }}>
        <FinePrint component="span" data-testid="event-going-count">
          {t.events.goingCount({ count: attendance.goingCount })}
        </FinePrint>
        <FinePrint component="span" data-testid="event-not-going-count">
          {t.events.notGoingCount({ count: attendance.notGoingCount })}
        </FinePrint>
      </Stack>
      {rsvp.isError ? <Alert severity="error">{localizeError(rsvp.error, t)}</Alert> : null}
    </Stack>
  );
};
