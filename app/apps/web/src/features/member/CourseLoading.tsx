import { Skeleton, Stack } from '@mui/material';

import { useTranslations } from '../../i18n/index.js';
import { VisuallyHidden } from '../../theme.js';
import { MemberSurface } from './MemberSurface.js';

export const CourseLoadingContent = ({
  label,
  'data-testid': testId,
}: {
  label: string;
  'data-testid'?: string;
}) => (
  <Stack role="status" aria-label={label} aria-busy="true" spacing="1rem" data-testid={testId}>
    <Skeleton variant="rounded" height="18rem" />
    <Skeleton width="90%" />
    <Skeleton width="70%" />
  </Stack>
);

export const CourseLoading = ({ lesson = true, anonymous = false }: { lesson?: boolean; anonymous?: boolean }) => {
  const t = useTranslations();
  const label = lesson ? t.lesson.loading : t.courseTree.loadingCourse;
  return (
    <MemberSurface
      title={(
        <>
          <VisuallyHidden>{label}</VisuallyHidden>
          <Skeleton width="min(24rem, 65vw)" aria-hidden />
        </>
      )}
      eyebrow={lesson ? t.lesson.eyebrow : anonymous ? t.anon.eyebrow : t.student.courseEyebrow}
      width="wide"
      dense={lesson}
      hideSocialLinks
      data-testid="course-loading"
    >
      <CourseLoadingContent label={label} />
    </MemberSurface>
  );
};
