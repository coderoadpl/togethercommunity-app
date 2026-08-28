import { useState, type FormEvent } from 'react';
import { Alert, Button, FormControl, FormHelperText, FormLabel, OutlinedInput, Stack } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { inspectVideoEmbedUrl, type PublicSpaceEvent } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard } from '../../../components/layout/index.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';
import { PanelBackLink } from '../PanelBackLink.js';

interface EventFormValues {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location: string;
  url: string;
  liveEmbedUrl: string;
  replayUrl: string;
}

const pad = (value: number): string => String(value).padStart(2, '0');

const toLocalInputValue = (iso: string): string => {
  const date = new Date(iso);
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const optionalText = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const embedRejected = (value: string): boolean =>
  value.trim().length > 0 && inspectVideoEmbedUrl(value.trim()).kind !== 'supported';

const EventForm = ({
  mode,
  initial,
  pending,
  error,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initial: EventFormValues;
  pending: boolean;
  error: unknown;
  onSubmit: (values: EventFormValues) => void;
}) => {
  const t = useTranslations();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [endsAt, setEndsAt] = useState(initial.endsAt);
  const [location, setLocation] = useState(initial.location);
  const [url, setUrl] = useState(initial.url);
  const [liveEmbedUrl, setLiveEmbedUrl] = useState(initial.liveEmbedUrl);
  const [replayUrl, setReplayUrl] = useState(initial.replayUrl);

  const timesFilled = startsAt.length > 0 && endsAt.length > 0;
  const timeOrderBroken = timesFilled && new Date(endsAt).getTime() <= new Date(startsAt).getTime();
  const liveEmbedBroken = embedRejected(liveEmbedUrl);
  const replayBroken = embedRejected(replayUrl);
  const submittable =
    title.trim().length > 0 && timesFilled && !timeOrderBroken && !liveEmbedBroken && !replayBroken;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!submittable) return;
    onSubmit({
      title: title.trim(),
      description,
      startsAt,
      endsAt,
      location,
      url,
      liveEmbedUrl,
      replayUrl,
    });
  };

  return (
    <SectionCard
      title={t.events.detailsHeading}
      onSubmit={submit}
      actions={
        <Button
          type="submit"
          variant="contained"
          disabled={pending || !submittable}
          data-testid="event-form-submit"
        >
          {mode === 'create'
            ? pending
              ? t.events.creating
              : t.events.create
            : pending
              ? t.events.saving
              : t.common.save}
        </Button>
      }
    >
      <FormControl fullWidth>
        <FormLabel htmlFor="event-title">{t.events.titleLabel}</FormLabel>
        <OutlinedInput
          id="event-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </FormControl>

      <FormControl fullWidth>
        <FormLabel htmlFor="event-description">{t.events.descriptionLabel}</FormLabel>
        <OutlinedInput
          id="event-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          multiline
          minRows={3}
        />
      </FormControl>

      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="1rem">
        <FormControl fullWidth error={timeOrderBroken}>
          <FormLabel htmlFor="event-starts-at">{t.events.startsAtLabel}</FormLabel>
          <OutlinedInput
            id="event-starts-at"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            required
          />
        </FormControl>
        <FormControl fullWidth error={timeOrderBroken}>
          <FormLabel htmlFor="event-ends-at">{t.events.endsAtLabel}</FormLabel>
          <OutlinedInput
            id="event-ends-at"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            required
          />
          {timeOrderBroken ? (
            <FormHelperText data-testid="event-time-order-error">{t.events.timeOrderError}</FormHelperText>
          ) : null}
        </FormControl>
      </Stack>

      <FormControl fullWidth>
        <FormLabel htmlFor="event-location">{t.events.locationLabel}</FormLabel>
        <OutlinedInput
          id="event-location"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
        />
      </FormControl>

      <FormControl fullWidth>
        <FormLabel htmlFor="event-url">{t.events.urlLabel}</FormLabel>
        <OutlinedInput
          id="event-url"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </FormControl>

      <FormControl fullWidth error={liveEmbedBroken}>
        <FormLabel htmlFor="event-live-embed-url">{t.events.liveEmbedUrlLabel}</FormLabel>
        <OutlinedInput
          id="event-live-embed-url"
          type="url"
          value={liveEmbedUrl}
          onChange={(event) => setLiveEmbedUrl(event.target.value)}
        />
        <FormHelperText data-testid="event-live-embed-help">
          {liveEmbedBroken ? t.events.embedUrlError : t.events.liveEmbedUrlHint}
        </FormHelperText>
      </FormControl>

      <FormControl fullWidth error={replayBroken}>
        <FormLabel htmlFor="event-replay-url">{t.events.replayUrlLabel}</FormLabel>
        <OutlinedInput
          id="event-replay-url"
          type="url"
          value={replayUrl}
          onChange={(event) => setReplayUrl(event.target.value)}
        />
        <FormHelperText data-testid="event-replay-help">
          {replayBroken ? t.events.embedUrlError : t.events.replayUrlHint}
        </FormHelperText>
      </FormControl>

      {error !== undefined && error !== null ? <Alert severity="error">{localizePanelError(error, t)}</Alert> : null}
    </SectionCard>
  );
};

const eventsBackLink = (spaceId: string) => `/panel/spaces/${encodeURIComponent(spaceId)}/events`;

export const EventCreatePage = ({ spaceId }: { spaceId: string }) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const createEvent = useMutation({
    ...actions.createEvent,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.eventsInvalidates());
      await navigate({ to: '/panel/spaces/$spaceId/events', params: { spaceId } });
    },
  });

  const submit = (values: EventFormValues) => {
    const location = optionalText(values.location);
    const url = optionalText(values.url);
    const description = optionalText(values.description);
    const liveEmbedUrl = optionalText(values.liveEmbedUrl);
    const replayUrl = optionalText(values.replayUrl);
    createEvent.mutate({
      spaceId,
      title: values.title,
      startsAt: new Date(values.startsAt).toISOString(),
      endsAt: new Date(values.endsAt).toISOString(),
      ...(description === null ? {} : { description }),
      ...(location === null ? {} : { location }),
      ...(url === null ? {} : { url }),
      ...(liveEmbedUrl === null ? {} : { liveEmbedUrl }),
      ...(replayUrl === null ? {} : { replayUrl }),
    });
  };

  return (
    <PanelPage
      title={t.events.newEvent}
      backTo={<PanelBackLink to={eventsBackLink(spaceId)}>{t.events.allEvents}</PanelBackLink>}
    >
      <EventForm
        mode="create"
        initial={{
          title: '',
          description: '',
          startsAt: '',
          endsAt: '',
          location: '',
          url: '',
          liveEmbedUrl: '',
          replayUrl: '',
        }}
        pending={createEvent.isPending}
        error={createEvent.isError ? createEvent.error : null}
        onSubmit={submit}
      />
    </PanelPage>
  );
};

const EventEditForm = ({ spaceId, event }: { spaceId: string; event: PublicSpaceEvent }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const updateEvent = useMutation({
    ...actions.updateEvent,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.eventsInvalidates());
      await navigate({ to: '/panel/spaces/$spaceId/events', params: { spaceId } });
    },
  });

  const submit = (values: EventFormValues) =>
    updateEvent.mutate({
      eventId: event.id,
      title: values.title,
      description: optionalText(values.description),
      startsAt: new Date(values.startsAt).toISOString(),
      endsAt: new Date(values.endsAt).toISOString(),
      location: optionalText(values.location),
      url: optionalText(values.url),
      liveEmbedUrl: optionalText(values.liveEmbedUrl),
      replayUrl: optionalText(values.replayUrl),
    });

  return (
    <EventForm
      mode="edit"
      initial={{
        title: event.title,
        description: event.description ?? '',
        startsAt: toLocalInputValue(event.startsAt),
        endsAt: toLocalInputValue(event.endsAt),
        location: event.location ?? '',
        url: event.url ?? '',
        liveEmbedUrl: event.liveEmbedUrl ?? '',
        replayUrl: event.replayUrl ?? '',
      }}
      pending={updateEvent.isPending}
      error={updateEvent.isError ? updateEvent.error : null}
      onSubmit={submit}
    />
  );
};

export const EventEditPage = ({ spaceId, eventId }: { spaceId: string; eventId: string }) => {
  const t = useTranslations();
  const event = useQuery(actions.event(eventId));
  const backTo = <PanelBackLink to={eventsBackLink(spaceId)}>{t.events.allEvents}</PanelBackLink>;

  if (event.isPending) {
    return (
      <PanelPage
        title={t.events.editEvent}
        backTo={backTo}
        state={{ kind: 'loading', label: t.events.loading }}
      />
    );
  }

  if (event.isError) {
    return (
      <PanelPage
        title={t.events.editEvent}
        backTo={backTo}
        state={{
          kind: 'error',
          message: localizePanelError(event.error, t),
          retry: { label: t.common.retry, onRetry: () => void event.refetch() },
        }}
      />
    );
  }

  return (
    <PanelPage title={event.data.event.title} description={t.events.editEvent} backTo={backTo}>
      <EventEditForm spaceId={spaceId} event={event.data.event} />
    </PanelPage>
  );
};
