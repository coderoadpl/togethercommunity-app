import { useEffect } from 'react';
import { Link as MuiLink, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { SectionCard, StatusView } from '../../components/layout/index.js';
import { RichTextContent } from '../../components/ui/RichTextContent.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { useRedirectToLogin } from './use-login-redirect.js';
import { CourseRow } from './CourseCards.js';
import { MemberSurface } from './MemberSurface.js';
import { ProductDownloads } from './ProductDownloads.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

export const CoursePage = ({ productId }: { productId: string }) => {
  const t = useTranslations();
  const products = useQuery(actions.myProducts);
  const courses = useQuery(actions.studentCourses);
  const navigation = useQuery(actions.memberNavigation);
  const redirectToLogin = useRedirectToLogin();
  const unauthorized = isUnauthorized(products.error);

  useEffect(() => {
    if (unauthorized) void redirectToLogin();
  }, [redirectToLogin, unauthorized]);

  if (products.isPending) {
    return (
      <MemberSurface
        title={t.student.myProducts}
        eyebrow={t.student.courseEyebrow}
        state={{ kind: 'loading', label: t.courseTree.loadingCourse }}
      />
    );
  }

  if (unauthorized) return null;

  if (products.isError) {
    return (
      <MemberSurface
        title={t.student.myProducts}
        eyebrow={t.student.courseEyebrow}
        state={{
          kind: 'error',
          message: isForbidden(products.error) ? t.student.staffNoMember : localizeError(products.error, t),
          retry: { label: t.common.retry, onRetry: () => void products.refetch() },
        }}
      />
    );
  }

  const product = products.data.products.find((candidate) => candidate.id === productId);

  if (!product) {
    return (
      <MemberSurface
        title={t.student.courseNotFound}
        eyebrow={t.student.courseEyebrow}
        state={{
          kind: 'not-found',
          title: t.student.courseNotFound,
          body: t.student.productNotInLibrary,
          action: <MuiLink component={Link} to="/my/products">{t.student.backToMyProducts}</MuiLink>,
        }}
      />
    );
  }

  const grantedCourseIds = new Set(product.accessItems.map((item) => item.courseId));
  const accessibleCourses = (courses.data?.courses ?? []).filter((course) => grantedCourseIds.has(course.id));

  if (grantedCourseIds.size === 0 && product.downloads.length > 0) {
    return (
      <MemberSurface title={product.title} eyebrow={t.student.downloadsHeading}>
        {product.description ? <RichTextContent html={product.description} /> : null}
        <Typography>{t.student.downloadProductBody}</Typography>
        <ProductDownloads productId={product.id} productTitle={product.title} downloads={product.downloads} />
      </MemberSurface>
    );
  }

  const startedCourseIds = new Set(
    (navigation.data?.navigation.courses ?? [])
      .filter((course) => course.completedLessonCount > 0)
      .map((course) => course.courseId),
  );

  return (
    <MemberSurface title={product.title} eyebrow={t.student.courseEyebrow}>
      {product.description ? <RichTextContent html={product.description} /> : null}
      {courses.isPending ? (
        <StatusView state={{ kind: 'loading', label: t.student.loadingCourses }} />
      ) : courses.isError ? (
        <StatusView
          state={{
            kind: 'error',
            message: localizeError(courses.error, t),
            retry: { label: t.student.retryCourses, onRetry: () => void courses.refetch() },
          }}
        />
      ) : accessibleCourses.length === 0 ? (
        <StatusView
          state={{
            kind: 'empty',
            title: t.student.productWithoutCoursesTitle,
            body: t.student.productWithoutCoursesBody,
          }}
        />
      ) : (
        <SectionCard
          title={t.student.productCoursesHeading}
          description={t.student.productCoursesHint}
          data-testid="product-course-links"
        >
          <Stack useFlexGap spacing="0.75rem" sx={{ mt: '1rem' }}>
            {accessibleCourses.map((course) => (
              <CourseRow
                key={course.id}
                course={course}
                actionLabel={startedCourseIds.has(course.id) ? t.student.continueCourse : t.student.openCourse}
              />
            ))}
          </Stack>
        </SectionCard>
      )}
      <ProductDownloads productId={product.id} productTitle={product.title} downloads={product.downloads} />
    </MemberSurface>
  );
};
