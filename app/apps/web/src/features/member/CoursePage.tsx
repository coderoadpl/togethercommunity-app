import { useEffect } from 'react';
import { Alert, Box, Container, Link, Paper, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import { CardTitle, Eyebrow, LedgerHeader } from '../../theme.js';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const isForbidden = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'forbidden';

export const CoursePage = ({ productId }: { productId: string }) => {
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
          loading course…
        </Typography>
      </Container>
    );
  }

  if (unauthorized) return null;

  if (products.isError) {
    return (
      <Container sx={{ maxWidth: '44rem', py: 6 }}>
        <Alert>
          {isForbidden(products.error)
            ? 'This account has staff access here, but no member profile yet.'
            : products.error.message}
        </Alert>
      </Container>
    );
  }

  const product = products.data.products.find((candidate) => candidate.id === productId);

  if (!product) {
    return (
      <Container sx={{ maxWidth: '44rem', py: 6 }}>
        <Paper elevation={1} sx={{ p: '1.5rem' }}>
          <CardTitle variant="h1">Course not found</CardTitle>
          <Typography variant="body1" sx={{ mt: '1rem' }}>
            This product is not in your library.
          </Typography>
          <Link href="/my">Back to my products</Link>
        </Paper>
      </Container>
    );
  }

  return (
    <Container disableGutters sx={{ maxWidth: '44rem !important', px: '1.25rem', pb: '6rem' }}>
      <LedgerHeader component="header" sx={{ pt: '48px', pb: '21px' }}>
        <Stack direction="row" useFlexGap sx={{ alignItems: 'baseline', columnGap: '1rem' }}>
          <Typography variant="h1">{product.title}</Typography>
          <Box sx={{ flex: 1 }} />
          <Link href="/my">My products</Link>
        </Stack>
        <Eyebrow variant="overline" component="p">
          course
        </Eyebrow>
      </LedgerHeader>

      <Box component="section" sx={{ mt: '48px' }}>
        <Paper elevation={1} sx={{ p: '1.5rem' }}>
          <CardTitle variant="h1">Course content coming soon</CardTitle>
          <Typography variant="body1" sx={{ mt: '1rem' }}>
            Course content arrives later.
          </Typography>
        </Paper>
      </Box>
    </Container>
  );
};
