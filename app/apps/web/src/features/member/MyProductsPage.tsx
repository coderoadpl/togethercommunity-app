import { useEffect } from 'react';
import {
  Alert,
  Box,
  Container,
  Link,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import { useTranslations } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';
import { CardTitle, DataValue, Eyebrow, LedgerHeader } from '../../theme.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

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
          {isForbidden(products.error) ? t.student.staffNoMember : products.error.message}
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
        </Stack>
        <Eyebrow variant="overline" component="p">
          {t.student.courseLibrary}
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
          <List disablePadding>
            {products.data.products.map((product) => (
              <ListItem key={product.id} disablePadding>
                <ListItemButton component="a" href={`/my/course/${product.id}`} sx={{ px: '0.3rem' }}>
                  <ListItemText
                    primary={product.title}
                    secondary={
                      <>
                        <DataValue>{formatPrice(product.priceCents, product.currency)}</DataValue> ·{' '}
                        {product.description}
                      </>
                    }
                    slotProps={{ primary: { sx: { fontWeight: 700 } }, secondary: { component: 'p' } }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </Box>
    </Container>
  );
};
