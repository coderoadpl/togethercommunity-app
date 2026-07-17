import { useEffect } from 'react';
import { Link } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { MemberSurface } from './MemberSurface.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

export const CoursePage = ({ productId }: { productId: string }) => {
  const t = useTranslations();
  const products = useQuery(actions.myProducts);
  const navigate = useNavigate();
  const unauthorized = isUnauthorized(products.error);

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

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
          action: <Link href="/my/products">{t.student.backToMyProducts}</Link>,
        }}
      />
    );
  }

  return (
    <MemberSurface title={product.title} eyebrow={t.student.courseEyebrow}>
      <StatusView
        state={{
          kind: 'empty',
          title: t.student.courseContentComingSoon,
          body: t.student.courseContentArrivesLater,
        }}
      />
    </MemberSurface>
  );
};
