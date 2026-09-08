import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Link as MuiLink,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import {
  groupLessonBlocks,
  resolveVideoAutoplay,
  withVideoAutoplay,
  type LessonContentGroup,
  type RenderableLessonBlock,
} from '#core/domain/index.js';

import { actions } from '../../api.js';
import { SectionCard, StatusView } from '../../components/layout/index.js';
import { CompletionMark } from '../../components/ui/CompletionMark.js';
import { LessonLinkList, LessonSandboxEmbed } from '../../components/ui/LessonLinks.js';
import { CollapsibleEmbed, LessonMediaEmbed, LessonMediaError } from '../../components/ui/LessonMedia.js';
import { RichTextContent } from '../../components/ui/RichTextContent.js';
import { localizeError, useLanguage, useTranslations, type Messages } from '../../i18n/index.js';
import { formatOfferPrice } from '../../lib/format.js';
import {
  DataValue,
  Eyebrow,
  LessonFooterBar,
  LessonMediaFrame,
  LessonPlaceholder,
  LESSON_CARD_BLEED_X,
  LESSON_CARD_OUTDENT_X,
  LESSON_CARD_PADDING_X,
  LESSON_DOCUMENT_FRAME_SX,
  LESSON_VIDEO_FRAME_SX,
} from '../../theme.js';
import { DiscussionSection } from './DiscussionSection.js';
import { LinkIcon, LockedState } from './lesson-icons.js';
import { lessonNeighbours, lessonPath, linearizeCourse, locateLesson } from './lesson-nav.js';
import { CourseLoading, CourseLoadingContent } from './CourseLoading.js';
import { MemberSurface } from './MemberSurface.js';
import { EmptyLessonIcon } from './overview-icons.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

const VIDEO_ALLOW = 'accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture;';

const blockLabel = (t: Messages, type: RenderableLessonBlock['type']): string => {
  switch (type) {
    case 'video':
      return t.lesson.labelVideo;
    case 'pdf':
      return t.lesson.labelDocument;
    case 'embed':
      return t.lesson.labelEmbed;
    case 'html':
      return t.lesson.labelReading;
  }
};

const groupLabel = (t: Messages, group: LessonContentGroup): string => {
  switch (group.kind) {
    case 'block':
      return blockLabel(t, group.block.type);
    case 'sandbox':
      return t.lesson.labelSandbox({ provider: group.providerName });
    case 'links':
      return t.lesson.linksHeading;
  }
};

const UnavailableVideo = ({ lessonId, storageKey, autoplay, authenticated }: { lessonId: string; storageKey: string; autoplay: boolean; authenticated: boolean }) => {
  const t = useTranslations();
  const playback = useQuery({ ...actions.studentLessonPlayback(lessonId), enabled: authenticated });
  if (!authenticated) return <LessonPlaceholder data-testid="lesson-video-placeholder">{t.lesson.videoPlaceholder}</LessonPlaceholder>;
  const video = playback.data?.videos.find((video) => video.kind !== 'external' && video.storageKey === storageKey);
  if (video?.kind === 'bunny') {
    return <LessonMediaEmbed frameSx={LESSON_VIDEO_FRAME_SX} data-testid="lesson-video" src={withVideoAutoplay(video.embedUrl, autoplay)} title={t.lesson.videoTitle} failureMessage={t.lesson.videoFailedTitle} allow={VIDEO_ALLOW} allowFullScreen />;
  }
  if (video?.kind === 'unavailable' || playback.isError) {
    const message = video?.kind === 'unavailable'
      ? video.reason === 'missing_library_id' ? t.lesson.videoMissingLibrary : t.lesson.videoSecretInvalid
      : t.lesson.videoFailedTitle;
    return (
      <LessonMediaFrame sx={{ ...LESSON_VIDEO_FRAME_SX, display: 'grid' }}>
        <LessonMediaError message={message} onRetry={() => void playback.refetch()} />
      </LessonMediaFrame>
    );
  }
  if (playback.isPending) return <LessonMediaFrame sx={LESSON_VIDEO_FRAME_SX}><Skeleton variant="rectangular" data-testid="lesson-media-skeleton" sx={{ position: 'absolute', inset: 0, height: '100%' }} /></LessonMediaFrame>;
  return <LessonPlaceholder data-testid="lesson-video-placeholder">{t.lesson.videoPlaceholder}</LessonPlaceholder>;
};

const BlockBody = ({ block, autoplay, lessonId, authenticated }: { block: RenderableLessonBlock; autoplay: boolean; lessonId: string; authenticated: boolean }) => {
  const t = useTranslations();
  if (block.type === 'video') {
    if (block.embedUrl === undefined) {
      return <UnavailableVideo key={lessonId} lessonId={lessonId} storageKey={block.storageKey} autoplay={autoplay} authenticated={authenticated} />;
    }
    return (
      <LessonMediaEmbed
        frameSx={LESSON_VIDEO_FRAME_SX}
        data-testid="lesson-video"
        src={withVideoAutoplay(block.embedUrl, autoplay)}
        title={t.lesson.videoTitle}
        failureMessage={t.lesson.videoFailedTitle}
        allow={VIDEO_ALLOW}
        allowFullScreen
      />
    );
  }

  if (block.type === 'pdf') {
    return (
      <Stack useFlexGap spacing="0.75rem">
        <LessonMediaEmbed
          frameSx={LESSON_DOCUMENT_FRAME_SX}
          data-testid="lesson-pdf"
          src={block.pdfUrl}
          externalUrl={block.pdfUrl}
          loading="lazy"
          title={block.name ?? t.lesson.pdfTitle}
        />
        <Box>
          <Button
            component="a"
            href={block.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="outlined"
          >
            {t.lesson.openPdf}
          </Button>
        </Box>
      </Stack>
    );
  }

  if (block.type === 'embed') {
    const frame = (
      <LessonMediaEmbed
        frameSx={LESSON_VIDEO_FRAME_SX}
        data-testid="lesson-embed"
        externalUrl={block.embedUrl}
        src={withVideoAutoplay(block.embedUrl, autoplay)}
        title={t.lesson.embedTitle}
        failureMessage={t.lesson.videoFailedTitle}
        allow={VIDEO_ALLOW}
        allowFullScreen
      />
    );
    return block.collapsed === true ? <CollapsibleEmbed>{frame}</CollapsibleEmbed> : frame;
  }

  return <RichTextContent html={block.html} data-testid="lesson-html" />;
};

const GroupBody = ({ group, autoplay, lessonId, authenticated }: { group: LessonContentGroup; autoplay: boolean; lessonId: string; authenticated: boolean }) => {
  switch (group.kind) {
    case 'block':
      return <BlockBody block={group.block} autoplay={autoplay} lessonId={lessonId} authenticated={authenticated} />;
    case 'sandbox':
      return (
        <LessonSandboxEmbed
          embedUrl={group.embedUrl}
          canonicalUrl={group.canonicalUrl}
          providerName={group.providerName}
          caption={group.caption}
          collapsed={group.collapsed}
          outdentX={LESSON_CARD_BLEED_X}
        />
      );
    case 'links':
      return <LessonLinkList links={group.links} />;
  }
};

const LockedView = ({
  courseId,
  lessonName,
  unlockProductId,
}: {
  courseId: string;
  lessonName?: string | undefined;
  unlockProductId?: string;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const offer = useQuery({ ...actions.publicOffer, enabled: unlockProductId !== undefined });
  const product = offer.data?.products.find((candidate) => candidate.id === unlockProductId);
  return (
    <MemberSurface
      title={lessonName ?? t.lesson.contentLocked}
      eyebrow={t.lesson.eyebrow}
      width="prose"
    >
      {offer.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(offer.error, t), retry: { label: t.common.retry, onRetry: () => void offer.refetch() } }} /> : null}
      <SectionCard
        title={product?.title ?? t.lesson.contentLocked}
        description={t.lesson.noAccessYet}
        actions={
          unlockProductId === undefined ? undefined : (
            <Button
              component={Link}
              to={`/checkout/${encodeURIComponent(unlockProductId)}`}
              variant="contained"
              data-testid="unlock-lesson-cta"
            >
              {t.courseTree.unlockAccess}
            </Button>
          )
        }
        data-testid="locked-lesson-upsell"
      >
        <Stack useFlexGap spacing="1rem" sx={{ alignItems: 'flex-start' }}>
          <LockedState />
          {product !== undefined && (
            <Typography variant="h3" component="p" data-testid="locked-product-price">
              <DataValue>{formatOfferPrice(product.priceCents, product.currency, language, t.common.free)}</DataValue>
            </Typography>
          )}
          <MuiLink component={Link} to={`/my/courses/${encodeURIComponent(courseId)}`}>{t.lesson.backToCourse}</MuiLink>
        </Stack>
      </SectionCard>
    </MemberSurface>
  );
};

export const LessonPlayerPage = ({
  courseId,
  lessonId,
  threadRootPostId = null,
}: {
  courseId: string;
  lessonId: string;
  threadRootPostId?: string | null;
}) => {
  const t = useTranslations();
  const lesson = useQuery({
    ...actions.studentLesson(lessonId),
    placeholderData: (previous) => previous,
  });
  const queryClient = useQueryClient();
  const cachedMe = queryClient.getQueryData(actions.me.queryKey);
  const authenticated =
    lesson.data?.authenticated === true ||
    isForbidden(lesson.error) ||
    (lesson.isPending && cachedMe !== undefined);
  const me = useQuery({ ...actions.me, enabled: authenticated });
  const tenantSettings = useQuery({ ...actions.tenantSettings, enabled: authenticated });
  const ownProgress = me.data !== undefined && me.data.impersonation === null;
  const structure = useQuery({ ...actions.courseStructure(courseId), enabled: authenticated });
  const progress = useQuery({ ...actions.studentProgress(courseId), enabled: authenticated });
  const attachments = useQuery({
    ...actions.studentLessonAttachments(lessonId),
    enabled: authenticated && lesson.isSuccess,
  });
  const navigate = useNavigate();

  const unauthorized = isUnauthorized(lesson.error);

  const location = useMemo(() => {
    const tree = structure.data?.structure;
    return tree === undefined ? null : locateLesson(tree, lessonId);
  }, [structure.data, lessonId]);
  const neighbours = useMemo(() => {
    const tree = structure.data?.structure;
    return tree === undefined ? null : lessonNeighbours(linearizeCourse(tree), lessonId);
  }, [structure.data, lessonId]);
  const transitioning = lesson.isPlaceholderData;

  const lastViewed = useMutation({
    ...actions.updateLastViewed,
    onError: (error) => console.warn('Failed to update last-viewed lesson', error),
  });
  const lastViewedRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !authenticated ||
      !ownProgress ||
      lastViewedRef.current === lessonId ||
      !lesson.isSuccess ||
      lesson.isPlaceholderData ||
      structure.isPending
    ) return;
    lastViewedRef.current = lessonId;
    lastViewed.mutate({
      courseId,
      lessonId,
      moduleId: location?.module?.id,
      chapterId: location?.chapter?.id,
    });
  }, [authenticated, ownProgress, lesson.isSuccess, lesson.isPlaceholderData, structure.isPending, location, courseId, lessonId, lastViewed]);

  const [continuing, setContinuing] = useState(false);
  useEffect(() => {
    setContinuing(false);
  }, [lessonId]);

  const [optimisticDone, setOptimisticDone] = useState<{
    lessonId: string;
    done: boolean;
  } | null>(null);
  const completedFromServer =
    progress.data?.progress.completedLessonIds.includes(lessonId) ?? false;
  const completed = optimisticDone?.lessonId === lessonId
    ? optimisticDone.done
    : completedFromServer;

  const settleCompletion = async () => {
    await Promise.all([
      queryClient.invalidateQueries(actions.studentCourseInvalidates()),
      queryClient.invalidateQueries(actions.memberNavigationInvalidates()),
    ]);
    setOptimisticDone(null);
  };

  const complete = useMutation({
    ...actions.completeLesson,
    onMutate: ({ lessonId: completedLessonId }) =>
      setOptimisticDone({ lessonId: completedLessonId, done: true }),
    onError: () => setOptimisticDone(null),
    onSettled: settleCompletion,
  });

  const uncomplete = useMutation({
    ...actions.uncompleteLesson,
    onMutate: ({ lessonId: uncompletedLessonId }) =>
      setOptimisticDone({ lessonId: uncompletedLessonId, done: false }),
    onError: () => setOptimisticDone(null),
    onSettled: settleCompletion,
  });

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  const nextLesson = neighbours?.nextUnlocked ?? null;
  useEffect(() => {
    if (nextLesson !== null) {
      void queryClient.prefetchQuery(actions.studentLesson(nextLesson.lessonId));
    }
  }, [queryClient, nextLesson]);

  if (lesson.isPending) {
    return <CourseLoading />;
  }

  if (unauthorized) return null;

  if (lesson.isError) {
    if (isForbidden(lesson.error)) {
      if (structure.isError) {
        return (
          <MemberSurface
            title={t.lesson.unavailable}
            eyebrow={t.lesson.eyebrow}
            width="wide"
            state={{ kind: 'error', message: localizeError(structure.error, t), retry: { label: t.common.retry, onRetry: () => void structure.refetch() } }}
          />
        );
      }
      const lockedRow = structure.data?.structure.modules
        .flatMap((module) => module.chapters.flatMap((chapter) => chapter.lessons))
        .find((entry) => entry.lessonId === lessonId);
      return (
        <LockedView
          courseId={courseId}
          lessonName={lockedRow?.name}
          {...(lockedRow?.unlockProductId === undefined
            ? {}
            : { unlockProductId: lockedRow.unlockProductId })}
        />
      );
    }
    return (
      <MemberSurface
          title={t.lesson.unavailable}
        eyebrow={t.lesson.eyebrow}
        width="wide"
        state={{
          kind: 'error',
          message: localizeError(lesson.error, t),
          retry: { label: t.common.retry, onRetry: () => void lesson.refetch() },
        }}
      />
    );
  }

  if (authenticated && tenantSettings.isPending) {
    return <CourseLoading />;
  }

  const groups = groupLessonBlocks(lesson.data.lesson.contents);
  const videoAutoplay = tenantSettings.data === undefined
    ? false
    : resolveVideoAutoplay(
        tenantSettings.data.settings,
        me.data?.tenant?.videoAutoplay ?? null,
      );
  const hasSideErrors = [tenantSettings, structure, progress, attachments, lastViewed, complete, uncomplete]
    .some((query) => query.isError);
  const nextHref = nextLesson === null ? null : lessonPath(courseId, nextLesson.lessonId);
  const previousLesson = neighbours?.previous ?? null;
  const lockedAhead = nextLesson === null && (neighbours?.next ?? null) !== null;
  const atCourseEnd = neighbours !== null && neighbours.next === null;
  const lessonName = transitioning
    ? location?.row?.name ?? lesson.data.lesson.name
    : lesson.data.lesson.name;

  const continueToNext = () => {
    setContinuing(true);
    complete.mutate(
      { lessonId },
      {
        onSuccess: () => {
          if (nextHref === null) setContinuing(false);
          else void navigate({ to: nextHref });
        },
        onError: () => setContinuing(false),
      },
    );
  };

  return (
    <MemberSurface
      title={lessonName}
      eyebrow={t.lesson.eyebrow}
      width="wide"
      dense
    >
      <Box sx={{ minWidth: 0 }}>
        {transitioning ? (
          <CourseLoadingContent
            label={t.lesson.loading}
            data-testid="lesson-transition-loading"
          />
        ) : (
          <>
        {hasSideErrors ? (
          <Stack useFlexGap spacing="0.75rem" sx={{ mb: '1rem' }}>
            {tenantSettings.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(tenantSettings.error, t), retry: { label: t.common.retry, onRetry: () => void tenantSettings.refetch() } }} /> : null}
            {structure.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(structure.error, t), retry: { label: t.common.retry, onRetry: () => void structure.refetch() } }} /> : null}
            {progress.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(progress.error, t), retry: { label: t.common.retry, onRetry: () => void progress.refetch() } }} /> : null}
            {attachments.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(attachments.error, t), retry: { label: t.common.retry, onRetry: () => void attachments.refetch() } }} /> : null}
            {complete.isError ? <Alert severity="error">{localizeError(complete.error, t)}</Alert> : null}
            {uncomplete.isError ? <Alert severity="error">{localizeError(uncomplete.error, t)}</Alert> : null}
          </Stack>
        ) : null}
        <Stack component="section" useFlexGap spacing="1.5rem">
          {groups.length === 0 ? (
            <StatusView
              state={{
                kind: 'empty',
                icon: <EmptyLessonIcon />,
                title: t.lesson.noContentTitle,
                body: t.lesson.noContent,
              }}
              data-testid="lesson-empty-state"
            />
          ) : (
            groups.map((group, index) => (
              <Paper
                key={index}
                elevation={1}
                sx={{
                  px: LESSON_CARD_PADDING_X,
                  py: { xs: '1rem', sm: '1.5rem' },
                  mx: LESSON_CARD_OUTDENT_X,
                }}
                data-testid={`lesson-block-${index}`}
                data-block-type={group.kind === 'block' ? group.block.type : group.kind}
              >
                <Eyebrow variant="overline" component="p" sx={{ mb: '0.75rem' }}>
                  {groupLabel(t, group)}
                </Eyebrow>
                <GroupBody group={group} autoplay={videoAutoplay} lessonId={lessonId} authenticated={authenticated} />
              </Paper>
            ))
          )}
        </Stack>

        {attachments.isSuccess && attachments.data.attachments.length > 0 ? (
          <SectionCard title={t.lesson.attachmentsHeading} data-testid="lesson-attachments">
            <Stack useFlexGap spacing="0.75rem" sx={{ alignItems: 'flex-start' }}>
              {attachments.data.attachments.map((attachment) => (
                <Button
                  key={attachment.id}
                  component="a"
                  href={attachment.downloadPath}
                  variant="outlined"
                  startIcon={<LinkIcon />}
                >
                  {t.lesson.downloadAttachment({ name: attachment.fileName })}
                </Button>
              ))}
            </Stack>
          </SectionCard>
        ) : null}

        {authenticated && <LessonFooterBar component="footer" sx={{ mt: '2.5rem' }}>
          <Stack
            direction="row"
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem', '& > .MuiButton-root, & > span': { flex: { xs: '1 1 40%', md: '0 1 auto' } }, '& > span > .MuiButton-root': { width: '100%' } }}
          >
            {neighbours !== null && (
              previousLesson === null || previousLesson.locked ? (
                <Tooltip title={previousLesson === null ? t.lesson.firstLesson : t.courseTree.lockedTooltip}>
                  <Box component="span">
                    <Button variant="outlined" data-testid="prev-lesson" disabled>
                      {t.lesson.previousLesson}
                    </Button>
                  </Box>
                </Tooltip>
              ) : (
                <Button
                  component={Link}
                  to={lessonPath(courseId, previousLesson.lessonId)}
                  variant="outlined"
                  data-testid="prev-lesson"
                >
                  {t.lesson.previousLesson}
                </Button>
              )
            )}
            {!continuing && !completed && nextLesson !== null && (
              <Button
                component={Link}
                to={lessonPath(courseId, nextLesson.lessonId)}
                variant="outlined"
                data-testid="skip-to-next-lesson"
              >
                {t.lesson.nextLesson}
              </Button>
            )}
            <Box sx={{ flex: 1, display: { xs: 'none', md: 'block' } }} />
            {!continuing && progress.isSuccess && completed && (
              <Button
                variant="outlined"
                data-testid="unmark-complete"
                onClick={() => uncomplete.mutate({ lessonId })}
                disabled={uncomplete.isPending}
                startIcon={<CompletionMark label={t.courseTree.completionComplete} />}
                title={t.lesson.unmarkCompletedHint}
              >
                {t.lesson.unmarkCompleted}
              </Button>
            )}
            {!continuing && progress.isSuccess && !completed && (
              <Button
                variant={nextHref === null ? 'contained' : 'outlined'}
                data-testid="mark-complete"
                onClick={() => complete.mutate({ lessonId })}
                disabled={complete.isPending}
              >
                {t.lesson.markCompleted}
              </Button>
            )}
            {continuing ? (
              <Button variant="contained" data-testid="complete-continue" disabled>
                {t.lesson.completing}
              </Button>
            ) : !completed && nextHref !== null ? (
              <Button
                variant="contained"
                data-testid="complete-continue"
                onClick={continueToNext}
                disabled={complete.isPending}
              >
                {t.lesson.completeContinue}
              </Button>
            ) : null}
            {!continuing && completed && nextLesson !== null && (
              <Button
                component={Link}
                to={lessonPath(courseId, nextLesson.lessonId)}
                variant="contained"
                data-testid="next-lesson"
              >
                {t.lesson.next({ name: nextLesson.name })}
              </Button>
            )}
            {lockedAhead && (
              <Tooltip title={t.courseTree.lockedTooltip}>
                <Box component="span">
                  <Button variant="outlined" data-testid="next-locked" disabled>
                    {t.lesson.nextLocked}
                  </Button>
                </Box>
              </Tooltip>
            )}
            {atCourseEnd && (
              structure.data?.structure.completionStatus === 'fully-completed' ? (
                <Chip data-testid="course-completed" label={t.lesson.courseCompleted} />
              ) : (
                <Chip variant="outlined" data-testid="course-end" label={t.lesson.lastLesson} />
              )
            )}
          </Stack>
        </LessonFooterBar>}

        {authenticated && (
          <DiscussionSection
            key={threadRootPostId ?? 'all-threads'}
            lessonId={lessonId}
            {...(threadRootPostId === null
              ? {}
              : {
                  focusThread: {
                    rootPostId: threadRootPostId,
                    onExit: () =>
                      void navigate({
                        to: '/my/courses/$courseId/lessons/$lessonId',
                        params: { courseId, lessonId },
                        search: {},
                      }),
                  },
                })}
          />
        )}
          </>
        )}
      </Box>
    </MemberSurface>
  );
};
