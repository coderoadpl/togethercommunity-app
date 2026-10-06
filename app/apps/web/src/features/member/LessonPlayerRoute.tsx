import { useParams, useSearch } from '@tanstack/react-router';

import { LessonPlayerPage } from './LessonPlayerPage.js';

export const validateLessonSearch = (search: Record<string, unknown>): { thread?: string } => {
  const thread = search['thread'];
  return {
    ...(typeof thread === 'string' && thread.trim().length > 0 ? { thread: thread.trim() } : {}),
  };
};

export const LessonPlayerRoute = () => {
  const params = useParams({ strict: false });
  const { thread } = useSearch({ strict: false });
  return (
    <LessonPlayerPage
      courseId={params.courseId ?? ''}
      lessonId={params.lessonId ?? ''}
      threadRootPostId={thread ?? null}
      editionNumber={params.number}
    />
  );
};
