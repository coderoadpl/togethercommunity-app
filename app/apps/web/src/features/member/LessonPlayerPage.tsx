import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Link as MuiLink,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import DOMPurify from 'dompurify';

import { ApiError } from '#core/client/index.js';
import type { CourseStructureWithAccess, LessonBlock, PlayableLessonBlock } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { SectionCard, StatusView } from '../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations, type Messages } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';
import {
  DataValue,
  Eyebrow,
  LessonFooterBar,
  LessonHtmlContent,
  LessonMediaClip,
  LessonMediaFrame,
  LessonMediaIframe,
  LessonPlaceholder,
} from '../../theme.js';
import { CurriculumCard } from './CourseRail.js';
import { DiscussionSection } from './DiscussionSection.js';
import { CodeIcon, LinkIcon, LockedState } from './lesson-icons.js';
import { MemberSurface } from './MemberSurface.js';
import { EmptyLessonIcon } from './overview-icons.js';
import { CompletionFull } from './tree-icons.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

const VIDEO_ALLOW = 'accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture;';

const useShellOwnsProgram = () => {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.up('md'));
};

const blockLabel = (t: Messages, type: LessonBlock['type']): string => {
  switch (type) {
    case 'video':
      return t.lesson.labelVideo;
    case 'pdf':
      return t.lesson.labelDocument;
    case 'embed':
      return t.lesson.labelEmbed;
    case 'html':
      return t.lesson.labelReading;
    case 'link':
      return t.lesson.labelLink;
  }
};

const MediaIframe = ({
  frameSx,
  ...iframeProps
}: { frameSx: SxProps<Theme> } & ComponentProps<typeof LessonMediaIframe>) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <LessonMediaFrame sx={frameSx}>
      <LessonMediaClip>
        {loaded ? null : (
          <Skeleton
            variant="rectangular"
            data-testid="lesson-media-skeleton"
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />
        )}
        <LessonMediaIframe {...iframeProps} onLoad={() => setLoaded(true)} />
      </LessonMediaClip>
    </LessonMediaFrame>
  );
};

const BlockBody = ({ block }: { block: PlayableLessonBlock }) => {
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
      <MediaIframe
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
        <MediaIframe
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
      <MediaIframe
        frameSx={{ aspectRatio: '16 / 9' }}
        data-testid="lesson-embed"
        src={block.embedUrl}
        title={t.lesson.embedTitle}
        allow={VIDEO_ALLOW}
        allowFullScreen
      />
    );
  }

  if (block.type === 'html') {
    return (
      <LessonHtmlContent
        data-testid="lesson-html"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(block.html) }}
      />
    );
  }

  const github = /(^|\.)github\.com/i.test(new URL(block.url).hostname);
  return (
    <Stack useFlexGap spacing="0.5rem">
      <Box>
        <Button
          component="a"
          href={block.url}
          target="_blank"
          rel="noopener noreferrer"
          variant="outlined"
          startIcon={github ? <CodeIcon /> : <LinkIcon />}
        >
          {block.description ?? block.url}
        </Button>
      </Box>
      {block.description !== undefined && (
        <Typography variant="body2" color="text.secondary">
          {block.url}
        </Typography>
      )}
    </Stack>
  );
};

const LockedView = ({
  courseId,
  lessonName,
  courseName,
  structure,
  unlockProductId,
}: {
  courseId: string;
  lessonName?: string | undefined;
  courseName?: string | undefined;
  structure?: CourseStructureWithAccess | undefined;
  unlockProductId?: string;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const shellOwnsProgram = useShellOwnsProgram();
  const offer = useQuery({ ...actions.publicOffer, enabled: unlockProductId !== undefined });
  const product = offer.data?.products.find((candidate) => candidate.id === unlockProductId);
  return (
    <MemberSurface
      title={lessonName ?? t.lesson.contentLocked}
      eyebrow={t.lesson.eyebrow}
      width="wide"
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
      {...(structure === undefined || shellOwnsProgram
        ? {}
        : { rail: <CurriculumCard courseId={courseId} structure={structure} /> })}
      mobileRail="after"
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
              <DataValue>{formatPrice(product.priceCents, product.currency, language)}</DataValue>
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
}: {
  courseId: string;
  lessonId: string;
}) => {
  const t = useTranslations();
  const shellOwnsProgram = useShellOwnsProgram();
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
  const structure = useQuery({ ...actions.courseStructure(courseId), enabled: authenticated });
  const progress = useQuery({ ...actions.studentProgress(courseId), enabled: authenticated });
  const next = useQuery({ ...actions.nextLesson(lessonId), enabled: authenticated });
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
  const transitioning = lesson.isPlaceholderData;

  const lastViewed = useMutation(actions.updateLastViewed);
  const lastViewedRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !authenticated ||
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
  }, [authenticated, lesson.isSuccess, lesson.isPlaceholderData, structure.isPending, location, courseId, lessonId, lastViewed]);

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

  const nextLesson = next.data?.next ?? null;
  useEffect(() => {
    if (nextLesson !== null) {
      void queryClient.prefetchQuery(actions.studentLesson(nextLesson.id));
    }
  }, [queryClient, nextLesson]);

  if (lesson.isPending) {
    return (
      <MemberSurface
        authenticated={authenticated}
        title={t.lesson.loading}
        eyebrow={t.lesson.eyebrow}
        width="wide"
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
            authenticated
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
          courseName={structure.data?.structure.name}
          structure={structure.data?.structure}
          {...(lockedRow?.unlockProductId === undefined
            ? {}
            : { unlockProductId: lockedRow.unlockProductId })}
        />
      );
    }
    return (
      <MemberSurface
        authenticated={authenticated}
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

  const blocks = lesson.data.lesson.contents;
  const nextHref = nextLesson === null ? null : `/my/courses/${courseId}/lessons/${nextLesson.id}`;
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
      authenticated={authenticated}
      title={lessonName}
      eyebrow={t.lesson.eyebrow}
      width="wide"
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
      {...(structure.data === undefined || shellOwnsProgram
        ? {}
        : {
            rail: (
              <CurriculumCard
                courseId={courseId}
                structure={structure.data.structure}
                currentLessonId={lessonId}
              />
            ),
          })}
      mobileRail="after"
    >
      <Box sx={{ minWidth: 0 }}>
        {transitioning ? (
          <StatusView
            state={{ kind: 'loading', label: t.lesson.loading }}
            data-testid="lesson-transition-loading"
          />
        ) : (
          <>
        <Stack useFlexGap spacing="0.75rem" sx={{ mb: '1rem' }}>
          {structure.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(structure.error, t), retry: { label: t.common.retry, onRetry: () => void structure.refetch() } }} /> : null}
          {progress.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(progress.error, t), retry: { label: t.common.retry, onRetry: () => void progress.refetch() } }} /> : null}
          {next.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(next.error, t), retry: { label: t.common.retry, onRetry: () => void next.refetch() } }} /> : null}
          {attachments.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(attachments.error, t), retry: { label: t.common.retry, onRetry: () => void attachments.refetch() } }} /> : null}
          {lastViewed.isError ? <Alert severity="error">{localizeError(lastViewed.error, t)}</Alert> : null}
          {complete.isError ? <Alert severity="error">{localizeError(complete.error, t)}</Alert> : null}
          {uncomplete.isError ? <Alert severity="error">{localizeError(uncomplete.error, t)}</Alert> : null}
        </Stack>
        <Stack component="section" useFlexGap spacing="1.5rem">
          {blocks.length === 0 ? (
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
            blocks.map((block, index) => (
              <Paper
                key={index}
                elevation={1}
                sx={{ p: '1.5rem' }}
                data-testid={`lesson-block-${index}`}
                data-block-type={block.type}
              >
                <Eyebrow variant="overline" component="p" sx={{ mb: '0.75rem' }}>
                  {blockLabel(t, block.type)}
                </Eyebrow>
                <BlockBody block={block} />
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
            {progress.isSuccess && (
              completed ? (
                <Button
                  variant="outlined"
                  data-testid="unmark-complete"
                  onClick={() => uncomplete.mutate({ lessonId })}
                  disabled={uncomplete.isPending}
                  startIcon={<CompletionFull />}
                  title={t.lesson.unmarkCompletedHint}
                >
                  {t.lesson.unmarkCompleted}
                </Button>
              ) : (
                <Button
                  variant="outlined"
                  data-testid="mark-complete"
                  onClick={() => complete.mutate({ lessonId })}
                  disabled={complete.isPending}
                >
                  {t.lesson.markCompleted}
                </Button>
              )
            )}
            {nextHref !== null && (
              <Button
                variant="contained"
                data-testid="complete-continue"
                onClick={continueToNext}
                disabled={complete.isPending}
              >
                {t.lesson.completeContinue}
              </Button>
            )}
            <Box sx={{ flex: 1 }} />
            {next.isSuccess &&
              (nextLesson === null ? (
                structure.data?.structure.completionStatus === 'fully-completed' ? (
                  <Chip data-testid="course-completed" label={t.lesson.courseCompleted} />
                ) : (
                  <Chip variant="outlined" data-testid="course-end" label={t.lesson.lastLesson} />
                )
              ) : (
                <MuiLink component={Link} to={`/my/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(nextLesson.id)}`} data-testid="next-lesson">
                  {t.lesson.next({ name: nextLesson.name })}
                </MuiLink>
              ))}
          </Stack>
        </LessonFooterBar>}

        {authenticated && <DiscussionSection lessonId={lessonId} />}
          </>
        )}
      </Box>
    </MemberSurface>
  );
};
