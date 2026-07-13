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

const BLOCK_LABEL: Record<LessonBlock['type'], string> = {
  video: 'video',
  pdf: 'document',
  embed: 'embed',
  html: 'reading',
  link: 'link',
};

const sortBlocks = (blocks: readonly LessonBlock[]): LessonBlock[] =>
  blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => BLOCK_RANK[a.block.type] - BLOCK_RANK[b.block.type] || a.index - b.index)
    .map((entry) => entry.block);

const BlockBody = ({ block }: { block: LessonBlock }) => {
  if (block.type === 'video') {
    if (block.streamLibraryId === undefined) {
      return (
        <LessonPlaceholder data-testid="lesson-video-placeholder">
          Video pointer present - streaming not configured
        </LessonPlaceholder>
      );
    }
    return (
      <LessonMediaFrame sx={{ aspectRatio: '16 / 9' }}>
        <LessonMediaIframe
          data-testid="lesson-video"
          src={`https://iframe.mediadelivery.net/embed/${block.streamLibraryId}/${block.streamVideoId}`}
          title="Lesson video"
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
            title={block.name ?? 'Lesson PDF'}
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
            Open PDF in new tab
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
          title="Embedded content"
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

const LockedView = ({ courseId }: { courseId: string }) => (
  <Container sx={{ maxWidth: '52rem', py: 6 }}>
    <Paper elevation={1} sx={{ p: '2.5rem' }}>
      <Stack useFlexGap spacing="1rem" sx={{ alignItems: 'center' }}>
        <LockedState />
        <CardTitle variant="h1">Content locked</CardTitle>
        <Typography variant="body1">You don&apos;t have access to this lesson yet.</Typography>
        <Stack direction="row" useFlexGap sx={{ columnGap: '1rem', mt: '0.5rem' }}>
          <Button component="a" href={`/my/courses/${courseId}`} variant="contained">
            Back to course
          </Button>
          <Button component="a" href="/my" variant="outlined">
            Browse courses
          </Button>
        </Stack>
      </Stack>
    </Paper>
  </Container>
);

export const LessonPlayerPage = ({
  courseId,
  lessonId,
}: {
  courseId: string;
  lessonId: string;
}) => {
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
          loading lesson…
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
          <CardTitle variant="h1">Lesson unavailable</CardTitle>
          <Typography variant="body1" sx={{ mt: '1rem' }}>
            {lesson.error.message}
          </Typography>
          <Box sx={{ mt: '1rem' }}>
            <Link href={`/my/courses/${courseId}`}>Back to course</Link>
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
          <Link href={`/my/courses/${courseId}`}>Back to course</Link>
        </Stack>
        <Eyebrow variant="overline" component="p">
          lesson
        </Eyebrow>
      </LedgerHeader>

      <Stack component="section" useFlexGap spacing="1.5rem" sx={{ mt: '2.5rem' }}>
        {blocks.length === 0 ? (
          <Paper elevation={1} sx={{ p: '1.5rem' }}>
            <Typography variant="body1">This lesson has no content yet.</Typography>
          </Paper>
        ) : (
          blocks.map((block, index) => (
            <Paper key={index} elevation={1} sx={{ p: '1.5rem' }}>
              <Eyebrow variant="overline" component="p" sx={{ mb: '0.75rem' }}>
                {BLOCK_LABEL[block.type]}
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
            {completed ? 'Completed' : 'Mark as completed'}
          </Button>
          {nextHref !== null && (
            <Button
              variant="contained"
              data-testid="complete-continue"
              onClick={continueToNext}
              disabled={complete.isPending}
            >
              Complete &amp; continue
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          {next.isSuccess &&
            (nextLesson === null ? (
              <Chip data-testid="course-completed" label="Course completed" />
            ) : (
              <Link href={nextHref ?? ''} data-testid="next-lesson">
                Next: {nextLesson.name}
              </Link>
            ))}
        </Stack>
      </LessonFooterBar>
    </Container>
  );
};
