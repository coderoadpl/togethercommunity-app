import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  Box,
  Button,
  Chip,
  Link,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
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
    if (block.streamLibraryId === undefined) {
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
        src={block.embedUrl ?? `https://iframe.mediadelivery.net/embed/${block.streamLibraryId}/${block.streamVideoId}`}
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
              { label: courseName, href: `/my/courses/${courseId}` },
              { label: lessonName ?? t.lesson.contentLocked },
            ],
          })}
      {...(structure === undefined
        ? {}
        : { rail: <CurriculumCard courseId={courseId} structure={structure} /> })}
      mobileRail="after"
    >
      <SectionCard
        title={product?.title ?? t.lesson.contentLocked}
        description={t.lesson.noAccessYet}
        actions={
          unlockProductId === undefined ? undefined : (
            <Button
              component="a"
              href={`/checkout/${unlockProductId}`}
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
          <Link href={`/my/courses/${courseId}`}>{t.lesson.backToCourse}</Link>
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
  const lesson = useQuery(actions.studentLesson(lessonId));
  const authenticated = lesson.data?.authenticated === true || isForbidden(lesson.error);
  const structure = useQuery({ ...actions.courseStructure(courseId), enabled: authenticated });
  const progress = useQuery({ ...actions.studentProgress(courseId), enabled: authenticated });
  const next = useQuery({ ...actions.nextLesson(lessonId), enabled: authenticated });
  const attachments = useQuery({
    ...actions.studentLessonAttachments(lessonId),
    enabled: authenticated && lesson.isSuccess,
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const unauthorized = isUnauthorized(lesson.error);

  const location = useMemo(() => {
    const tree = structure.data?.structure;
    if (tree === undefined) return null;
    for (const module of tree.modules) {
      for (const chapter of module.chapters) {
        if (chapter.lessons.some((entry) => entry.lessonId === lessonId)) {
          return { courseName: tree.name, module, chapter };
        }
      }
    }
    return { courseName: tree.name, module: null, chapter: null };
  }, [structure.data, lessonId]);

  const lastViewed = useMutation(actions.updateLastViewed);
  const lastViewedRef = useRef(false);
  useEffect(() => {
    if (!authenticated || lastViewedRef.current || !lesson.isSuccess || structure.isPending) return;
    lastViewedRef.current = true;
    lastViewed.mutate({
      courseId,
      lessonId,
      moduleId: location?.module?.id,
      chapterId: location?.chapter?.id,
    });
  }, [authenticated, lesson.isSuccess, structure.isPending, location, courseId, lessonId, lastViewed]);

  const [optimisticDone, setOptimisticDone] = useState<boolean | null>(null);
  const completedFromServer =
    progress.data?.progress.completedLessonIds.includes(lessonId) ?? false;
  const completed = optimisticDone ?? completedFromServer;

  const complete = useMutation({
    ...actions.completeLesson,
    onMutate: () => setOptimisticDone(true),
    onError: () => setOptimisticDone(null),
    onSettled: async () => {
      await queryClient.invalidateQueries(actions.studentCourseInvalidates());
      setOptimisticDone(null);
    },
  });

  const uncomplete = useMutation({
    ...actions.uncompleteLesson,
    onMutate: () => setOptimisticDone(false),
    onError: () => setOptimisticDone(null),
    onSettled: async () => {
      await queryClient.invalidateQueries(actions.studentCourseInvalidates());
      setOptimisticDone(null);
    },
  });

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  if (lesson.isPending) {
    return (
      <MemberSurface
        authenticated={false}
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
          kind: 'not-found',
          title: t.lesson.unavailable,
          body: localizeError(lesson.error, t),
          action: <Link href={`/my/courses/${courseId}`}>{t.lesson.backToCourse}</Link>,
        }}
      />
    );
  }

  const blocks = lesson.data.lesson.contents;
  const nextLesson = next.data?.next ?? null;
  const nextHref = nextLesson === null ? null : `/my/courses/${courseId}/lessons/${nextLesson.id}`;

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
      title={lesson.data.lesson.name}
      eyebrow={t.lesson.eyebrow}
      width="wide"
      {...(location === null
        ? {}
        : {
            breadcrumbs: [
              { label: location.courseName, href: `/my/courses/${courseId}` },
              ...(location.module === null ? [] : [{ label: location.module.name }]),
              ...(location.chapter === null ? [] : [{ label: location.chapter.name }]),
              { label: lesson.data.lesson.name },
            ],
          })}
      {...(structure.data === undefined
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
                <Link href={nextHref ?? ''} data-testid="next-lesson">
                  {t.lesson.next({ name: nextLesson.name })}
                </Link>
              ))}
          </Stack>
        </LessonFooterBar>}

        {authenticated && <DiscussionSection lessonId={lessonId} />}
      </Box>
    </MemberSurface>
  );
};
