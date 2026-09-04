import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Link as MuiLink,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import DOMPurify from 'dompurify';

import { ApiError } from '#core/client/index.js';
import { groupLessonBlocks, type LessonContentGroup, type RenderableLessonBlock } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { SectionCard, StatusView } from '../../components/layout/index.js';
import { LessonLinkList, LessonSandboxEmbed } from '../../components/ui/LessonLinks.js';
import { LessonMediaEmbed } from '../../components/ui/LessonMedia.js';
import { localizeError, useLanguage, useTranslations, type Messages } from '../../i18n/index.js';
import { formatOfferPrice } from '../../lib/format.js';
import {
  DataValue,
  Eyebrow,
  LessonFooterBar,
  LessonHtmlContent,
  LessonPlaceholder,
} from '../../theme.js';
import { DiscussionSection } from './DiscussionSection.js';
import { LinkIcon, LockedState } from './lesson-icons.js';
import { lessonNeighbours, lessonPath, linearizeCourse } from './lesson-nav.js';
import { MemberSurface } from './MemberSurface.js';
import { EmptyLessonIcon } from './overview-icons.js';
import { CompletionFull } from './tree-icons.js';

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

const BlockBody = ({ block }: { block: RenderableLessonBlock }) => {
  const t = useTranslations();
  if (block.type === 'video') {
    if (block.embedUrl === undefined) {
      return (
        <LessonPlaceholder data-testid="lesson-video-placeholder">
          {t.lesson.videoPlaceholder}
        </LessonPlaceholder>
      );
    }
    return (
      <LessonMediaEmbed
        frameSx={{ aspectRatio: '16 / 9' }}
        data-testid="lesson-video"
        src={block.embedUrl}
        title={t.lesson.videoTitle}
        allow={VIDEO_ALLOW}
        allowFullScreen
      />
    );
  }

  if (block.type === 'pdf') {
    return (
      <Stack useFlexGap spacing="0.75rem">
        <LessonMediaEmbed
          frameSx={{ aspectRatio: '10 / 7', minHeight: '24rem' }}
          data-testid="lesson-pdf"
          src={block.pdfUrl}
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
    return (
      <LessonMediaEmbed
        frameSx={{ aspectRatio: '16 / 9' }}
        data-testid="lesson-embed"
        src={block.embedUrl}
        title={t.lesson.embedTitle}
        allow={VIDEO_ALLOW}
        allowFullScreen
      />
    );
  }

  return (
    <LessonHtmlContent
      data-testid="lesson-html"
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(block.html) }}
    />
  );
};

const GroupBody = ({ group }: { group: LessonContentGroup }) => {
  switch (group.kind) {
    case 'block':
      return <BlockBody block={group.block} />;
    case 'sandbox':
      return (
        <LessonSandboxEmbed
          embedUrl={group.embedUrl}
          canonicalUrl={group.canonicalUrl}
          providerName={group.providerName}
          caption={group.caption}
        />
      );
    case 'links':
      return <LessonLinkList links={group.links} />;
  }
};

const LockedView = ({
  courseId,
  lessonName,
  courseName,
  unlockProductId,
}: {
  courseId: string;
  lessonName?: string | undefined;
  courseName?: string | undefined;
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
      width="lesson"
      {...(courseName === undefined
        ? {}
        : {
            breadcrumbs: [
              {
                label: courseName,
                link: <MuiLink component={Link} to={`/my/courses/${encodeURIComponent(courseId)}`}>{courseName}</MuiLink>,
              },
              { label: lessonName ?? t.lesson.contentLocked },
            ],
          })}
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
    if (tree === undefined) return null;
    for (const module of tree.modules) {
      for (const chapter of module.chapters) {
        const row = chapter.lessons.find((entry) => entry.lessonId === lessonId);
        if (row !== undefined) {
          return { courseName: tree.name, module, chapter, row };
        }
      }
    }
    return { courseName: tree.name, module: null, chapter: null, row: null };
  }, [structure.data, lessonId]);
  const neighbours = useMemo(() => {
    const tree = structure.data?.structure;
    return tree === undefined ? null : lessonNeighbours(linearizeCourse(tree), lessonId);
  }, [structure.data, lessonId]);
  const transitioning = lesson.isPlaceholderData;

  const lastViewed = useMutation(actions.updateLastViewed);
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
    return (
      <MemberSurface
          title={t.lesson.loading}
        eyebrow={t.lesson.eyebrow}
        width="lesson"
        state={{ kind: 'loading', label: t.lesson.loading }}
      />
    );
  }

  if (unauthorized) return null;

  if (lesson.isError) {
    if (isForbidden(lesson.error)) {
      if (structure.isError) {
        return (
          <MemberSurface
            title={t.lesson.unavailable}
            eyebrow={t.lesson.eyebrow}
            width="lesson"
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
          courseName={structure.data?.structure.name}
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
        width="lesson"
        state={{
          kind: 'error',
          message: localizeError(lesson.error, t),
          retry: { label: t.common.retry, onRetry: () => void lesson.refetch() },
        }}
      />
    );
  }

  const groups = groupLessonBlocks(lesson.data.lesson.contents);
  const hasSideErrors = [structure, progress, attachments, lastViewed, complete, uncomplete]
    .some((query) => query.isError);
  const nextHref = nextLesson === null ? null : lessonPath(courseId, nextLesson.lessonId);
  const previousLesson = neighbours?.previous ?? null;
  const lockedAhead = nextLesson === null && (neighbours?.next ?? null) !== null;
  const atCourseEnd = neighbours !== null && neighbours.next === null;
  const lessonName = transitioning
    ? location?.row?.name ?? lesson.data.lesson.name
    : lesson.data.lesson.name;

  const continueToNext = () => {
    complete.mutate(
      { lessonId },
      {
        onSuccess: () => {
          if (nextHref !== null) void navigate({ to: nextHref });
        },
      },
    );
  };

  return (
    <MemberSurface
      title={lessonName}
      eyebrow={t.lesson.eyebrow}
      width="lesson"
      dense
      {...(location === null
        ? {}
        : {
            breadcrumbs: [
              {
                label: location.courseName,
                link: <MuiLink component={Link} to={`/my/courses/${encodeURIComponent(courseId)}`}>{location.courseName}</MuiLink>,
              },
              ...(location.module === null ? [] : [{ label: location.module.name }]),
              ...(location.chapter === null ? [] : [{ label: location.chapter.name }]),
              { label: lessonName },
            ],
          })}
    >
      <Box sx={{ minWidth: 0 }}>
        {transitioning ? (
          <StatusView
            state={{ kind: 'loading', label: t.lesson.loading }}
            data-testid="lesson-transition-loading"
          />
        ) : (
          <>
        {hasSideErrors ? (
          <Stack useFlexGap spacing="0.75rem" sx={{ mb: '1rem' }}>
            {structure.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(structure.error, t), retry: { label: t.common.retry, onRetry: () => void structure.refetch() } }} /> : null}
            {progress.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(progress.error, t), retry: { label: t.common.retry, onRetry: () => void progress.refetch() } }} /> : null}
            {attachments.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(attachments.error, t), retry: { label: t.common.retry, onRetry: () => void attachments.refetch() } }} /> : null}
            {lastViewed.isError ? <Alert severity="error">{localizeError(lastViewed.error, t)}</Alert> : null}
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
                sx={{ p: '1.5rem' }}
                data-testid={`lesson-block-${index}`}
                data-block-type={group.kind === 'block' ? group.block.type : group.kind}
              >
                <Eyebrow variant="overline" component="p" sx={{ mb: '0.75rem' }}>
                  {groupLabel(t, group)}
                </Eyebrow>
                <GroupBody group={group} />
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

        {authenticated && <LessonFooterBar component="footer" sx={{ mt: '2.5rem', pt: '1.5rem' }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            useFlexGap
            sx={{ alignItems: { sm: 'center' }, columnGap: '1rem', rowGap: '1rem' }}
          >
            {neighbours !== null && (
              previousLesson === null || previousLesson.locked ? (
                <Tooltip title={previousLesson === null ? t.lesson.firstLesson : t.courseTree.lockedTooltip}>
                  <Box component="span">
                    <Button variant="text" data-testid="prev-lesson" disabled>
                      {t.lesson.previousLesson}
                    </Button>
                  </Box>
                </Tooltip>
              ) : (
                <Button
                  component={Link}
                  to={lessonPath(courseId, previousLesson.lessonId)}
                  variant="text"
                  data-testid="prev-lesson"
                >
                  {t.lesson.previousLesson}
                </Button>
              )
            )}
            <Box sx={{ flex: 1 }} />
            {progress.isSuccess && completed && (
              <Button
                variant="text"
                size="small"
                data-testid="unmark-complete"
                onClick={() => uncomplete.mutate({ lessonId })}
                disabled={uncomplete.isPending}
                startIcon={<CompletionFull />}
                title={t.lesson.unmarkCompletedHint}
              >
                {t.lesson.unmarkCompleted}
              </Button>
            )}
            {progress.isSuccess && !completed && (
              <Button
                variant={nextHref === null ? 'contained' : 'text'}
                size={nextHref === null ? 'medium' : 'small'}
                data-testid="mark-complete"
                onClick={() => complete.mutate({ lessonId })}
                disabled={complete.isPending}
              >
                {t.lesson.markCompleted}
              </Button>
            )}
            {!completed && nextHref !== null && (
              <Button
                variant="contained"
                data-testid="complete-continue"
                onClick={continueToNext}
                disabled={complete.isPending}
              >
                {t.lesson.completeContinue}
              </Button>
            )}
            {completed && nextLesson !== null && (
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
