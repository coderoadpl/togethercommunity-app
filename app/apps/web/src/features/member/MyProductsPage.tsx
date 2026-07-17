import { useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '@core/client/index.js';
import type { GrantWindowStatus } from '@core/domain/index.js';

import { actions } from '../../api.js';
import { localizeError, useLanguage, useTranslations, type Messages } from '../../i18n/index.js';
import { formatDate, formatPrice } from '../../lib/format.js';
import { NotificationBell } from '../../NotificationBell.js';
import { CardTitle, DataValue, Eyebrow, LedgerHeader, MemberProductLink } from '../../theme.js';
import { MemberAccountMenu } from './MemberAccountMenu.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

type GrantedProductRow = {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  grantStatus: GrantWindowStatus;
  grantStartsAt: string;
  grantExpiresAt: string | null;
};

const chipColor = (status: GrantWindowStatus): 'success' | 'warning' | 'default' =>
  status === 'active' ? 'success' : status === 'expired' ? 'warning' : 'default';

const statusLabel = (t: Messages, product: GrantedProductRow, language: string): string => {
  if (product.grantStatus === 'active') return t.student.grantActiveLabel;
  if (product.grantStatus === 'upcoming') {
    return t.student.grantUpcomingLabel({ date: formatDate(product.grantStartsAt, language) });
  }
  return t.student.grantExpiredLabel({
    date: formatDate(product.grantExpiresAt ?? product.grantStartsAt, language),
  });
};

const ProductRow = ({ product }: { product: GrantedProductRow }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const inactive = product.grantStatus !== 'active';

  return (
    <Paper
      elevation={1}
      data-testid={`my-product-${product.id}`}
      data-grant-status={product.grantStatus}
      sx={{ p: '1.1rem 1.25rem', display: 'grid', gap: '0.6rem' }}
    >
      <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '0.75rem', flexWrap: 'wrap' }}>
        <MemberProductLink href={`/my/course/${product.id}`} sx={{ opacity: inactive ? 0.72 : 1 }}>
          {product.title}
        </MemberProductLink>
        <Chip
          size="small"
          variant={product.grantStatus === 'active' ? 'filled' : 'outlined'}
          color={chipColor(product.grantStatus)}
          label={statusLabel(t, product, language)}
          data-testid={`grant-status-${product.id}`}
        />
      </Stack>
      <Typography variant="body2" component="p" sx={{ opacity: inactive ? 0.72 : 1 }}>
        <DataValue>{formatPrice(product.priceCents, product.currency, language)}</DataValue>
        {product.description ? <> · {product.description}</> : null}
      </Typography>
      {product.grantStatus === 'upcoming' ? (
        <Typography variant="caption" color="text.secondary">
          {t.student.grantUpcomingNote({ date: formatDate(product.grantStartsAt, language) })}
        </Typography>
      ) : null}
      {product.grantStatus === 'expired' ? (
        <Box>
          <Button
            variant="contained"
            size="small"
            component="a"
            href={`/checkout/${product.id}`}
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
  const navigate = useNavigate();
  const unauthorized = isUnauthorized(products.error);

  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  if (products.isPending) {
    return (
      <Container sx={{ maxWidth: '44rem', py: 6 }}>
        <Typography variant="h2" component="p">
          {t.student.loadingProducts}
        </Typography>
      </Container>
    );
  }

  if (unauthorized) return null;

  if (products.isError) {
    return (
      <Container sx={{ maxWidth: '44rem', py: 6 }}>
        <Alert>
          {isForbidden(products.error) ? t.student.staffNoMember : localizeError(products.error, t)}
        </Alert>
      </Container>
    );
  }

  return (
    <Container disableGutters sx={{ maxWidth: '44rem !important', px: '1.25rem', pb: '6rem' }}>
      <LedgerHeader component="header" sx={{ pt: '48px', pb: '21px' }}>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '1rem' }}>
          <Typography variant="h1">{t.student.myProducts}</Typography>
          <Box sx={{ flex: 1 }} />
          <Link href="/my">{t.student.myCourses}</Link>
          <Link href="/">{t.common.home}</Link>
          <NotificationBell />
          <MemberAccountMenu />
        </Stack>
        <Eyebrow variant="overline" component="p">
          {t.student.productsLibrary}
        </Eyebrow>
      </LedgerHeader>

      <Box component="section" sx={{ mt: '48px' }}>
        {products.data.products.length === 0 ? (
          <Paper elevation={1} sx={{ p: '1.5rem' }}>
            <CardTitle variant="h1">{t.student.noProducts}</CardTitle>
            <Typography variant="body1" sx={{ mt: '1rem' }}>
              {t.student.productsWillAppear}
            </Typography>
          </Paper>
        ) : (
          <Stack useFlexGap spacing="0.85rem">
            {products.data.products.map((product) => (
              <ProductRow key={product.id} product={product} />
            ))}
          </Stack>
        )}
      </Box>
    </Container>
  );
};
