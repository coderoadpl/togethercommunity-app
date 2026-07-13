import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Breadcrumbs,
  Button,
  Chip,
  Container,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import DOMPurify from 'dompurify';

import { ApiError } from '@core/client/index.js';
import type { LessonBlock } from '@core/domain/index.js';

import { actions } from '../../api.js';
import { useTranslations, type Messages } from '../../i18n/index.js';
import {
  CardTitle,
  Eyebrow,
  LedgerHeader,
  LessonFooterBar,
  LessonHtmlContent,
  LessonMediaFrame,
  LessonMediaIframe,
  LessonPlaceholder,
} from '../../theme.js';
import { CodeIcon, LinkIcon, LockedState } from './lesson-icons.js';
import { CompletionFull } from './tree-icons.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

const VIDEO_ALLOW = 'accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture;';

const BLOCK_RANK: Record<LessonBlock['type'], number> = {
  video: 0,
  pdf: 1,
  embed: 2,
  html: 3,
  link: 4,
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

const sortBlocks = (blocks: readonly LessonBlock[]): LessonBlock[] =>
  blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => BLOCK_RANK[a.block.type] - BLOCK_RANK[b.block.type] || a.index - b.index)
    .map((entry) => entry.block);

const BlockBody = ({ block }: { block: LessonBlock }) => {
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
      <LessonMediaFrame sx={{ aspectRatio: '16 / 9' }}>
        <LessonMediaIframe
          data-testid="lesson-video"
          src={`https://iframe.mediadelivery.net/embed/${block.streamLibraryId}/${block.streamVideoId}`}
          title={t.lesson.videoTitle}
          allow={VIDEO_ALLOW}
          allowFullScreen
        />
      </LessonMediaFrame>
    );
  }

  if (block.type === 'pdf') {
    return (
      <Stack useFlexGap spacing="0.75rem">
        <LessonMediaFrame sx={{ aspectRatio: '10 / 7' }}>
          <LessonMediaIframe
            data-testid="lesson-pdf"
            src={block.pdfUrl}
            title={block.name ?? t.lesson.pdfTitle}
          />
        </LessonMediaFrame>
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
      <LessonMediaFrame sx={{ aspectRatio: '16 / 9' }}>
        <LessonMediaIframe
          data-testid="lesson-embed"
          src={block.embedUrl}
          title={t.lesson.embedTitle}
          allow={VIDEO_ALLOW}
          allowFullScreen
        />
      </LessonMediaFrame>
    );
  }

  if (block.type === 'html') {
    // Legacy injected lesson HTML raw (a trust-the-server XSS surface); we sanitize with DOMPurify first.
    const clean = DOMPurify.sanitize(block.html);
    return <LessonHtmlContent data-testid="lesson-html" dangerouslySetInnerHTML={{ __html: clean }} />;
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

const LockedView = ({ courseId }: { courseId: string }) => {
  const t = useTranslations();
  return (
    <Container sx={{ maxWidth: '52rem', py: 6 }}>
      <Paper elevation={1} sx={{ p: '2.5rem' }}>
        <Stack useFlexGap spacing="1rem" sx={{ alignItems: 'center' }}>
          <LockedState />
          <CardTitle variant="h1">{t.lesson.contentLocked}</CardTitle>
          <Typography variant="body1">{t.lesson.noAccessYet}</Typography>
          <Stack direction="row" useFlexGap sx={{ columnGap: '1rem', mt: '0.5rem' }}>
            <Button component="a" href={`/my/courses/${courseId}`} variant="contained">
              {t.lesson.backToCourse}
            </Button>
            <Button component="a" href="/my" variant="outlined">
              {t.lesson.browseCourses}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Container>
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
  const structure = useQuery(actions.courseStructure(courseId));
  const progress = useQuery(actions.studentProgress(courseId));
  const next = useQuery(actions.nextLesson(lessonId));
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
    if (lastViewedRef.current || !lesson.isSuccess || structure.isPending) return;
    lastViewedRef.current = true;
    lastViewed.mutate({
      courseId,
      lessonId,
      moduleId: location?.module?.id,
      chapterId: location?.chapter?.id,
    });
  }, [lesson.isSuccess, structure.isPending, location, courseId, lessonId, lastViewed]);

  const [optimisticDone, setOptimisticDone] = useState(false);
  const completedFromServer =
    progress.data?.progress.completedLessonIds.includes(lessonId) ?? false;
  const completed = completedFromServer || optimisticDone;

  const complete = useMutation({
    ...actions.completeLesson,
    onMutate: () => setOptimisticDone(true),
    onError: () => setOptimisticDone(false),
    onSettled: async () => {
      await queryClient.invalidateQueries(actions.studentCourseInvalidates());
    },
  });

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  if (lesson.isPending) {
    return (
      <Container sx={{ maxWidth: '52rem', py: 6 }}>
        <Typography variant="h2" component="p">
          {t.lesson.loading}
        </Typography>
      </Container>
    );
  }

  if (unauthorized) return null;

  if (lesson.isError) {
    if (isForbidden(lesson.error)) return <LockedView courseId={courseId} />;
    return (
      <Container sx={{ maxWidth: '52rem', py: 6 }}>
        <Paper elevation={1} sx={{ p: '1.5rem' }}>
          <CardTitle variant="h1">{t.lesson.unavailable}</CardTitle>
          <Typography variant="body1" sx={{ mt: '1rem' }}>
            {lesson.error.message}
          </Typography>
          <Box sx={{ mt: '1rem' }}>
            <Link href={`/my/courses/${courseId}`}>{t.lesson.backToCourse}</Link>
          </Box>
        </Paper>
      </Container>
    );
  }

  const blocks = sortBlocks(lesson.data.lesson.contents);
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
    <Container disableGutters sx={{ maxWidth: '52rem !important', px: '1.25rem', pb: '6rem' }}>
      <LedgerHeader component="header" sx={{ pt: '48px', pb: '21px' }}>
        {location !== null && (
          <Breadcrumbs aria-label="breadcrumb" sx={{ mb: '0.75rem' }}>
            <Link href={`/my/courses/${courseId}`}>{location.courseName}</Link>
            {location.module !== null && <Typography variant="body2">{location.module.name}</Typography>}
            {location.chapter !== null && <Typography variant="body2">{location.chapter.name}</Typography>}
            <Typography variant="body2" color="text.primary">
              {lesson.data.lesson.name}
            </Typography>
          </Breadcrumbs>
        )}
        <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '1rem' }}>
          <Typography variant="h1">{lesson.data.lesson.name}</Typography>
          <Box sx={{ flex: 1 }} />
          <Link href={`/my/courses/${courseId}`}>{t.lesson.backToCourse}</Link>
        </Stack>
        <Eyebrow variant="overline" component="p">
          {t.lesson.eyebrow}
        </Eyebrow>
      </LedgerHeader>

      <Stack component="section" useFlexGap spacing="1.5rem" sx={{ mt: '2.5rem' }}>
        {blocks.length === 0 ? (
          <Paper elevation={1} sx={{ p: '1.5rem' }}>
            <Typography variant="body1">{t.lesson.noContent}</Typography>
          </Paper>
        ) : (
          blocks.map((block, index) => (
            <Paper key={index} elevation={1} sx={{ p: '1.5rem' }}>
              <Eyebrow variant="overline" component="p" sx={{ mb: '0.75rem' }}>
                {blockLabel(t, block.type)}
              </Eyebrow>
              <BlockBody block={block} />
            </Paper>
          ))
        )}
      </Stack>

      <LessonFooterBar component="footer" sx={{ mt: '2.5rem', pt: '1.5rem' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          useFlexGap
          sx={{ alignItems: { sm: 'center' }, columnGap: '1rem', rowGap: '1rem' }}
        >
          <Button
            variant="outlined"
            data-testid="mark-complete"
            onClick={() => complete.mutate({ lessonId })}
            disabled={completed || complete.isPending}
            startIcon={completed ? <CompletionFull /> : undefined}
          >
            {completed ? t.lesson.completed : t.lesson.markCompleted}
          </Button>
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
              ) : null
            ) : (
              <Link href={nextHref ?? ''} data-testid="next-lesson">
                {t.lesson.next({ name: nextLesson.name })}
              </Link>
            ))}
        </Stack>
      </LessonFooterBar>
    </Container>
  );
};
