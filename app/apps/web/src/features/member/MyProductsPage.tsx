import { useEffect } from 'react';
import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import type {
  GrantWindowStatus,
  MemberSubscriptionSummary,
  ProductDownloadAssetView,
  ProductType,
  SubscriptionStatus,
} from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { RichTextContent } from '../../components/ui/RichTextContent.js';
import { localizeError, useLanguage, useTranslations, type Messages } from '../../i18n/index.js';
import { formatDate, formatPrice } from '../../lib/format.js';
import { DataValue, MemberProductLink } from '../../theme.js';
import { MemberSurface } from './MemberSurface.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

type GrantedProductRow = {
  id: string;
  type: ProductType;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
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

const statusLabel = (t: Messages, product: GrantedProductRow, language: string): string => {
  if (product.grantStatus === 'active') return t.student.grantActiveLabel;
  if (product.grantStatus === 'upcoming') {
    return t.student.grantUpcomingLabel({ date: formatDate(product.grantStartsAt, language) });
  }
  return t.student.grantExpiredLabel({
    date: formatDate(product.grantExpiresAt ?? product.grantStartsAt, language),
  });
};

const ProductRow = ({
  product,
  billingPortalUrl,
}: {
  product: GrantedProductRow;
  billingPortalUrl: string | null;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const inactive = product.grantStatus !== 'active';
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
        <MemberProductLink component={Link} to={`/my/course/${encodeURIComponent(product.id)}`} sx={{ opacity: inactive ? 0.72 : 1 }}>
          {product.title}
        </MemberProductLink>
        <Chip
          size="small"
          variant={product.grantStatus === 'active' ? 'filled' : 'outlined'}
          color={chipColor(product.grantStatus)}
          label={statusLabel(t, product, language)}
          data-testid={`grant-status-${product.id}`}
        />
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
      <Typography variant="body2" component="p" sx={{ opacity: inactive ? 0.72 : 1 }}>
        <DataValue>{formatPrice(product.priceCents, product.currency, language)}</DataValue>
      </Typography>
      {product.description ? <RichTextContent html={product.description} /> : null}
      {product.downloads.length > 0 ? (
        <Stack useFlexGap spacing="0.5rem" data-testid={`product-downloads-${product.id}`}>
          <Typography variant="overline" component="h3">
            {t.student.downloadsHeading}
          </Typography>
          <Box>
            <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ flexWrap: 'wrap' }}>
              {product.downloads.map((download) => (
                <Button
                  key={download.id}
                  variant="outlined"
                  size="small"
                  component="a"
                  href={download.downloadPath}
                  data-testid={`download-${download.id}`}
                >
                  {t.student.downloadFile({ name: download.fileName })}
                </Button>
              ))}
            </Stack>
          </Box>
        </Stack>
      ) : null}
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
      {subscription && billingPortalUrl ? (
        <Box>
          <Button
            variant="outlined"
            size="small"
            component="a"
            href={billingPortalUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`subscription-portal-${product.id}`}
          >
            {t.student.manageSubscription}
          </Button>
        </Box>
      ) : null}
      {product.grantStatus === 'expired' ? (
        <Box>
          <Button
            variant="contained"
            size="small"
            component={Link}
            to={`/checkout/${encodeURIComponent(product.id)}`}
            data-testid={`renew-${product.id}`}
          >
            {t.student.renewAccess}
          </Button>
        </Box>
      ) : null}
    </Paper>
  );
};

export const MyProductsPage = () => {
  const t = useTranslations();
  const products = useQuery(actions.myProducts);
  const tenantSettings = useQuery(actions.tenantSettings);
  const navigate = useNavigate();
  const unauthorized = isUnauthorized(products.error);

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  if (products.isPending) {
    return (
      <MemberSurface
        title={t.student.myProducts}
        eyebrow={t.student.productsLibrary}
        state={{ kind: 'loading', label: t.student.loadingProducts }}
      />
    );
  }

  if (unauthorized) return null;

  if (products.isError) {
    return (
      <MemberSurface
        title={t.student.myProducts}
        eyebrow={t.student.productsLibrary}
        state={{
          kind: 'error',
          message: isForbidden(products.error) ? t.student.staffNoMember : localizeError(products.error, t),
          retry: { label: t.common.retry, onRetry: () => void products.refetch() },
        }}
      />
    );
  }

  return (
    <MemberSurface title={t.student.myProducts} eyebrow={t.student.productsLibrary}>
        {tenantSettings.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(tenantSettings.error, t), retry: { label: t.common.retry, onRetry: () => void tenantSettings.refetch() } }} /> : null}
        {products.data.products.length === 0 ? (
          <StatusView
            state={{
              kind: 'empty',
              title: t.student.noProducts,
              body: t.student.productsWillAppear,
            }}
          />
        ) : (
          <Stack useFlexGap spacing="0.85rem">
            {products.data.products.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                billingPortalUrl={tenantSettings.data?.settings.billingPortalUrl ?? null}
              />
            ))}
          </Stack>
        )}
    </MemberSurface>
  );
};
