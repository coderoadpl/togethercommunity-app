import { useEffect, useId, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Link as MuiLink,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import {
  MEMBER_DOWNLOAD_FAILURE_PARAMS,
  MY_PRODUCTS_PATH,
  orderLineLabel,
  parseMemberDownloadFailure,
  SALES_LINK_TIME_ZONE,
} from '#core/domain/index.js';
import type {
  GrantWindowStatus,
  MemberFulfilment,
  MemberSubscriptionSummary,
  ProductDownloadAssetView,
  ProductType,
  SubscriptionStatus,
} from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { ExternalLinkIcon } from '../../components/ui/account-icons.js';
import { RichTextContent } from '../../components/ui/RichTextContent.js';
import { localizeError, useLanguage, useTranslations, type Messages } from '../../i18n/index.js';
import { useRedirectToLogin } from './use-login-redirect.js';
import { formatDate, formatOfferPrice } from '../../lib/format.js';
import { DataValue, MemberProductLink, VisuallyHidden } from '../../theme.js';
import { MemberSurface } from './MemberSurface.js';
import { DownloadFailureAlert, ProductDownloads, type DownloadFailureNotice } from './ProductDownloads.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

type GrantedProductRow = {
  id: string;
  accessItems: ReadonlyArray<{ courseId: string }>;
  type: ProductType;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  purchasable: boolean;
  shippedTo?: string | null | undefined;
  fulfilment?: MemberFulfilment | null | undefined;
  quantity?: number | undefined;
  grantStatus: GrantWindowStatus;
  grantStartsAt: string;
  grantExpiresAt: string | null;
  subscription: MemberSubscriptionSummary | null;
  downloads: ProductDownloadAssetView[];
};

const chipColor = (status: GrantWindowStatus): 'success' | 'warning' | 'default' =>
  status === 'active' ? 'success' : status === 'expired' ? 'warning' : 'default';

const subscriptionChipColors: Record<SubscriptionStatus, 'success' | 'warning' | 'default'> = {
  active: 'success',
  past_due: 'warning',
  canceled: 'default',
};

const FulfilmentStatusLine = ({ fulfilment, productId }: { fulfilment: MemberFulfilment; productId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  if (fulfilment.status === 'to_pack' || fulfilment.shippedAt === null || fulfilment.carrier === null) {
    return <Typography color="text.secondary" data-testid={`fulfilment-${productId}`}>{t.shipping.memberBeingPrepared}</Typography>;
  }
  return (
    <Typography color="text.secondary" data-testid={`fulfilment-${productId}`}>
      {t.shipping.memberShipped({ date: formatDate(fulfilment.shippedAt, language, SALES_LINK_TIME_ZONE), carrier: t.shipping.carriers[fulfilment.carrier] })}
      {fulfilment.trackingNumber === null ? null : ' '}
      {fulfilment.trackingNumber === null ? null : fulfilment.trackingUrl === null
        ? fulfilment.trackingNumber
        : <MuiLink href={fulfilment.trackingUrl} target="_blank" rel="noreferrer">{fulfilment.trackingNumber}</MuiLink>}
    </Typography>
  );
};

const statusLabel = (t: Messages, product: GrantedProductRow, language: string): string => {
  if (product.grantStatus === 'active') return t.student.grantActiveLabel;
  if (product.grantStatus === 'upcoming') {
    return t.student.grantUpcomingLabel({ date: formatDate(product.grantStartsAt, language) });
  }
  return t.student.grantExpiredLabel({
    date: formatDate(product.grantExpiresAt ?? product.grantStartsAt, language),
  });
};

type CourseTarget = { kind: 'open' | 'view'; to: string };

type AccessibleCourses = ReadonlySet<string> | 'loading' | 'failed';

const grantsActiveCourses = (product: GrantedProductRow): boolean =>
  product.type !== 'physical' && product.grantStatus === 'active' && product.accessItems.length > 0;

const courseTarget = (
  product: GrantedProductRow,
  accessibleCourses: AccessibleCourses,
): CourseTarget | null => {
  if (!grantsActiveCourses(product) || accessibleCourses === 'loading') return null;
  const granted = [...new Set(product.accessItems.map((item) => item.courseId))];
  const productPage: CourseTarget = { kind: 'view', to: `/my/course/${encodeURIComponent(product.id)}` };
  if (accessibleCourses === 'failed') return productPage;
  const courseIds = granted.filter((id) => accessibleCourses.has(id));
  const [onlyCourseId] = courseIds;
  if (onlyCourseId === undefined) return null;
  return courseIds.length === 1
    ? { kind: 'open', to: `/my/courses/${encodeURIComponent(onlyCourseId)}` }
    : productPage;
};

const ProductRow = ({
  product,
  billingPortalUrl,
  accessibleCourses,
  downloadFailure,
}: {
  product: GrantedProductRow;
  billingPortalUrl: string | null;
  accessibleCourses: AccessibleCourses;
  downloadFailure: DownloadFailureNotice | null;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const inactive = product.grantStatus !== 'active';
  const target = courseTarget(product, accessibleCourses);
  const targetPending = accessibleCourses === 'loading' && grantsActiveCourses(product);
  const portalUrl = product.subscription === null ? null : billingPortalUrl;
  const subscription = product.subscription;
  const subscriptionEnds = subscription?.status === 'canceled' || subscription?.cancelAtPeriodEnd;
  const subscriptionDate = subscription
    ? formatDate(subscription.currentPeriodEnd, language)
    : null;
  const subscriptionLabels: Record<SubscriptionStatus, string> = {
    active: t.student.subscriptionActiveLabel,
    past_due: t.student.subscriptionPastDueLabel,
    canceled: subscriptionDate
      ? t.student.subscriptionCanceledLabel({ date: subscriptionDate })
      : t.student.subscriptionCanceledLabel({ date: '' }),
  };

  return (
    <Paper
      elevation={1}
      data-testid={`my-product-${product.id}`}
      data-grant-status={product.grantStatus}
      sx={{ p: '1.1rem 1.25rem', display: 'grid', gap: '0.6rem' }}
    >
      <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '0.75rem', flexWrap: 'wrap' }}>
        <Typography variant="h3" component="h2">
          {product.type === 'physical' ? orderLineLabel({ name: product.title, quantity: product.quantity }) : (
            <MemberProductLink component={Link} to={`/my/course/${encodeURIComponent(product.id)}`} sx={{ opacity: inactive ? 0.72 : 1 }}>
              {product.title}
            </MemberProductLink>
          )}
        </Typography>
        {product.type === 'physical' || subscription !== null && product.grantStatus === 'active' ? null : (
          <Chip
            size="small"
            variant={product.grantStatus === 'active' ? 'filled' : 'outlined'}
            color={chipColor(product.grantStatus)}
            label={statusLabel(t, product, language)}
            data-testid={`grant-status-${product.id}`}
          />
        )}
        {subscription ? (
          <Chip
            size="small"
            variant={subscription.status === 'active' && !subscription.cancelAtPeriodEnd ? 'filled' : 'outlined'}
            color={subscription.cancelAtPeriodEnd ? 'default' : subscriptionChipColors[subscription.status]}
            label={subscription.cancelAtPeriodEnd && subscriptionDate
              ? t.student.subscriptionCanceledLabel({ date: subscriptionDate })
              : subscriptionLabels[subscription.status]}
            data-testid={`subscription-status-${product.id}`}
          />
        ) : null}
      </Stack>
      {product.type === 'physical' && product.fulfilment?.status !== 'shipped' ? (
        <Typography color="text.secondary">
          {product.shippedTo ? t.shipping.shippedTo({ destination: product.shippedTo }) : t.salesLinks.collectedInPerson}
        </Typography>
      ) : null}
      {product.type === 'physical' && product.fulfilment != null ? (
        <FulfilmentStatusLine fulfilment={product.fulfilment} productId={product.id} />
      ) : null}
      {product.description ? <RichTextContent html={product.description} /> : null}
      <ProductDownloads productId={product.id} productTitle={product.title} downloads={product.downloads} failure={downloadFailure} />
      {product.grantStatus === 'upcoming' ? (
        <Typography variant="caption" color="text.secondary">
          {t.student.grantUpcomingNote({ date: formatDate(product.grantStartsAt, language) })}
        </Typography>
      ) : null}
      {subscription && subscriptionDate ? (
        <Typography variant="caption" color="text.secondary" data-testid={`subscription-date-${product.id}`}>
          {subscriptionEnds
            ? t.student.subscriptionAccessUntil({ date: subscriptionDate })
            : t.student.subscriptionRenewalDate({ date: subscriptionDate })}
        </Typography>
      ) : null}
      {target !== null || targetPending || portalUrl !== null ? (
        <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          {targetPending ? (
            <Box component="span" data-testid={`open-course-pending-${product.id}`}>
              <Skeleton variant="rounded" aria-hidden>
                <Button variant="contained" size="small" component="span" tabIndex={-1}>{t.student.openCourse}</Button>
              </Skeleton>
              <VisuallyHidden>{t.student.loadingCourses}</VisuallyHidden>
            </Box>
          ) : null}
          {target === null ? null : (
            <Button
              variant="contained"
              size="small"
              component={Link}
              to={target.to}
              data-testid={`open-course-${product.id}`}
            >
              {target.kind === 'open' ? t.student.openCourse : t.student.viewCourses}
            </Button>
          )}
          {portalUrl === null ? null : (
            <Button
              variant="outlined"
              size="small"
              component="a"
              href={portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              endIcon={<ExternalLinkIcon />}
              data-testid={`subscription-portal-${product.id}`}
            >
              {t.student.manageSubscription}
              <VisuallyHidden> {t.student.opensInNewTab}</VisuallyHidden>
            </Button>
          )}
        </Stack>
      ) : null}
      {product.grantStatus === 'expired' ? (
        product.purchasable ? (
          <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: '0.75rem', rowGap: '0.5rem' }}>
            <Button
              variant="contained"
              size="small"
              component={Link}
              to={`/checkout/${encodeURIComponent(product.id)}`}
              data-testid={`renew-${product.id}`}
            >
              {t.student.renewAccess}
            </Button>
            <Typography variant="body2" component="span" data-testid={`renew-price-${product.id}`}>
              <DataValue>{formatOfferPrice(product.priceCents, product.currency, language, t.common.free)}</DataValue>
            </Typography>
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {t.student.renewalUnavailable}
          </Typography>
        )
      ) : null}
    </Paper>
  );
};

const offerPath = (slug: string) => `/offer/${encodeURIComponent(slug)}`;

const OfferLinks = ({ offers }: { offers: ReadonlyArray<{ id: string; slug: string; heading: string }> }) => {
  const t = useTranslations();
  const labelId = useId();
  const [onlyOffer] = offers;
  if (offers.length === 1 && onlyOffer !== undefined) {
    return <MuiLink href={offerPath(onlyOffer.slug)}>{t.student.browseOffers}</MuiLink>;
  }
  return (
    <Stack useFlexGap spacing="0.25rem">
      <Typography variant="body2" component="p" id={labelId}>{t.student.browseOffers}</Typography>
      <Stack component="ul" useFlexGap spacing="0.25rem" aria-labelledby={labelId} sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {offers.map((offer) => (
          <li key={offer.id}>
            <MuiLink href={offerPath(offer.slug)}>{offer.heading}</MuiLink>
          </li>
        ))}
      </Stack>
    </Stack>
  );
};

export const MyProductsPage = () => {
  const t = useTranslations();
  const products = useQuery(actions.myProducts);
  const tenantSettings = useQuery(actions.memberSettings);
  const grantsCourses = products.data?.products.some((product) => product.accessItems.length > 0) ?? false;
  const courses = useQuery({ ...actions.studentCourses, enabled: grantsCourses });
  const publicOffer = useQuery({ ...actions.publicOffer, enabled: products.data?.products.length === 0 });
  const redirectToLogin = useRedirectToLogin();
  const unauthorized = isUnauthorized(products.error);
  const navigate = useNavigate();
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const [downloadFailure, setDownloadFailure] = useState(() => parseMemberDownloadFailure(new URLSearchParams(searchStr)));
  const failureSearch = new URLSearchParams(searchStr);
  const failureInUrl = Object.values(MEMBER_DOWNLOAD_FAILURE_PARAMS).some((name) => failureSearch.has(name));

  useEffect(() => {
    if (unauthorized) void redirectToLogin();
  }, [redirectToLogin, unauthorized]);

  useEffect(() => {
    if (failureInUrl) void navigate({ href: MY_PRODUCTS_PATH, replace: true });
  }, [failureInUrl, navigate]);

  if (products.isPending) {
    return (
      <MemberSurface
        title={t.student.myProducts}
        state={{ kind: 'loading', label: t.student.loadingProducts }}
      />
    );
  }

  if (unauthorized) return null;

  if (products.isError) {
    return (
      <MemberSurface
        title={t.student.myProducts}
        state={{
          kind: 'error',
          message: isForbidden(products.error) ? t.student.staffNoMember : localizeError(products.error, t),
          retry: { label: t.common.retry, onRetry: () => void products.refetch() },
        }}
      />
    );
  }

  const offers = publicOffer.data?.salesLinks ?? [];
  const failedOrLoading = courses.isError ? 'failed' : 'loading';
  const accessibleCourses: AccessibleCourses = courses.data === undefined
    ? failedOrLoading
    : new Set(courses.data.courses.map((course) => course.id));
  const failureNotice: DownloadFailureNotice | null = downloadFailure === null ? null : {
    code: downloadFailure.code,
    assetId: downloadFailure.assetId,
    onRetry: () => {
      setDownloadFailure(null);
      void products.refetch();
    },
  };
  const failedProductListed = products.data.products.some((product) => product.id === downloadFailure?.productId);

  return (
    <MemberSurface title={t.student.myProducts}>
        {failureNotice !== null && !failedProductListed ? (
          <DownloadFailureAlert failure={failureNotice} retryPath={null} data-testid="download-failure" />
        ) : null}
        {tenantSettings.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(tenantSettings.error, t), retry: { label: t.common.retry, onRetry: () => void tenantSettings.refetch() } }} /> : null}
        {products.data.products.length === 0 ? (
          <StatusView
            state={{
              kind: 'empty',
              title: t.student.noProducts,
              body: (
                <Stack useFlexGap spacing="0.5rem">
                  <Typography variant="body1">{t.student.productsWillAppear}</Typography>
                  <Typography variant="body2" color="text.secondary">{t.student.productsOtherEmailHint}</Typography>
                </Stack>
              ),
              ...(offers.length === 0 ? {} : { action: <OfferLinks offers={offers} /> }),
            }}
            data-testid="my-products-empty-state"
          />
        ) : (
          <Stack useFlexGap spacing="0.85rem">
            {products.data.products.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                billingPortalUrl={tenantSettings.data?.settings.billingPortalUrl ?? null}
                accessibleCourses={accessibleCourses}
                downloadFailure={product.id === downloadFailure?.productId ? failureNotice : null}
              />
            ))}
          </Stack>
        )}
    </MemberSurface>
  );
};
