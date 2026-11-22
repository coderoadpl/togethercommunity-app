import { useEffect, type ReactNode } from 'react';
import { Button, Link as MuiLink, Stack } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import type { ProductDownloadAssetView } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { SectionCard, StatusView } from '../../components/layout/index.js';
import { RichTextContent } from '../../components/ui/RichTextContent.js';
import { localizeError, useLanguage, useTranslations, type Messages } from '../../i18n/index.js';
import { formatDate } from '../../lib/format.js';
import { useRedirectToLogin } from './use-login-redirect.js';
import { CourseRow } from './CourseCards.js';
import { MemberSurface } from './MemberSurface.js';
import { ProductDownloads } from './ProductDownloads.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

const productCrumbs = (t: Messages, current: string) => [
  {
    label: t.student.myProducts,
    link: <MuiLink component={Link} to="/my/products">{t.student.myProducts}</MuiLink>,
  },
  { label: current },
];

const ProductPageStack = ({ children }: { children: ReactNode }) => (
  <Stack useFlexGap spacing="1.5rem">{children}</Stack>
);

const ProductDownloadsCard = ({ product, description }: {
  product: { id: string; title: string; downloads: ProductDownloadAssetView[] };
  description?: string;
}) => {
  const t = useTranslations();
  return (
    <SectionCard
      title={t.student.downloadsHeading}
      description={description}
      data-testid="product-downloads-card"
    >
      <ProductDownloads productId={product.id} productTitle={product.title} downloads={product.downloads} withHeading={false} />
    </SectionCard>
  );
};

const InactiveAccess = ({ product }: {
  product: { id: string; grantStatus: 'upcoming' | 'expired'; grantStartsAt: string; grantExpiresAt: string | null; purchasable: boolean };
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  if (product.grantStatus === 'upcoming') {
    return (
      <StatusView
        data-testid="product-access-upcoming"
        state={{ kind: 'empty', title: t.student.grantUpcomingNote({ date: formatDate(product.grantStartsAt, language) }) }}
      />
    );
  }
  return (
    <StatusView
      data-testid="product-access-expired"
      state={{
        kind: 'empty',
        title: t.student.productAccessExpired({ date: formatDate(product.grantExpiresAt ?? product.grantStartsAt, language) }),
        ...(product.purchasable
          ? {
            action: (
              <Button
                variant="contained"
                size="small"
                component={Link}
                to={`/checkout/${encodeURIComponent(product.id)}`}
                data-testid={`renew-${product.id}`}
              >
                {t.student.renewAccess}
              </Button>
            ),
          }
          : { body: t.student.renewalUnavailable }),
      }}
    />
  );
};

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
        title={t.student.loadingProduct}
        eyebrow={t.student.productEyebrow}
        breadcrumbs={productCrumbs(t, t.student.productEyebrow)}
        state={{ kind: 'loading', label: t.student.loadingProduct }}
      />
    );
  }

  if (unauthorized) return null;

  if (products.isError) {
    return (
      <MemberSurface
        title={t.student.productLoadFailed}
        eyebrow={t.student.productEyebrow}
        breadcrumbs={productCrumbs(t, t.student.productEyebrow)}
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
        title={t.student.productNotFound}
        eyebrow={t.student.productEyebrow}
        breadcrumbs={productCrumbs(t, t.student.productNotFound)}
        state={{
          kind: 'not-found',
          title: t.student.productNotInLibrary,
          action: <MuiLink component={Link} to="/my/products">{t.student.backToMyProducts}</MuiLink>,
        }}
      />
    );
  }

  const crumbs = productCrumbs(t, product.title);

  if (product.grantStatus !== 'active') {
    return (
      <MemberSurface title={product.title} eyebrow={t.student.productEyebrow} breadcrumbs={crumbs}>
        <ProductPageStack>
          {product.description ? <RichTextContent html={product.description} /> : null}
          <InactiveAccess product={{ ...product, grantStatus: product.grantStatus }} />
        </ProductPageStack>
      </MemberSurface>
    );
  }

  const grantedCourseIds = new Set(product.accessItems.map((item) => item.courseId));
  const accessibleCourses = (courses.data?.courses ?? []).filter((course) => grantedCourseIds.has(course.id));

  if (grantedCourseIds.size === 0 && product.downloads.length > 0) {
    return (
      <MemberSurface title={product.title} eyebrow={t.student.productEyebrow} breadcrumbs={crumbs}>
        <ProductPageStack>
          {product.description ? <RichTextContent html={product.description} /> : null}
          <ProductDownloadsCard product={product} description={t.student.downloadProductBody} />
        </ProductPageStack>
      </MemberSurface>
    );
  }

  const startedCourseIds = new Set(
    (navigation.data?.navigation.courses ?? [])
      .filter((course) => course.completedLessonCount > 0)
      .map((course) => course.courseId),
  );

  return (
    <MemberSurface title={product.title} eyebrow={t.student.productEyebrow} breadcrumbs={crumbs}>
      <ProductPageStack>
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
            <Stack useFlexGap spacing="0.75rem">
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
        {product.downloads.length === 0 ? null : <ProductDownloadsCard product={product} />}
      </ProductPageStack>
    </MemberSurface>
  );
};
