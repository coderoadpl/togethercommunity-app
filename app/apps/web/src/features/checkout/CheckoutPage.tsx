import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Container,
  FormControl,
  FormLabel,
  Link,
  OutlinedInput,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';

import { actions } from '../../api.js';
import { formatPrice } from '../../lib/format.js';
import { CardTitle, Eyebrow, FinePrint, Wordmark } from '../../theme.js';

export const CheckoutPage = ({ productId }: { productId: string }) => {
  const offer = useQuery(actions.publicOffer);
  const [email, setEmail] = useState('');
  const [purchaseComplete, setPurchaseComplete] = useState(false);
  const [magicLinkUrl, setMagicLinkUrl] = useState<string | null>(null);

  const simulatePurchase = useMutation({
    ...actions.simulatePurchase,
    onSuccess: (data) => {
      setPurchaseComplete(true);
      setMagicLinkUrl(data.magicLink?.url ?? null);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    simulatePurchase.mutate({ email, productId });
  };

  if (offer.isPending) {
    return (
      <Container sx={{ maxWidth: '44rem', py: 6 }}>
        <Typography variant="h2" component="p">
          loading checkout…
        </Typography>
      </Container>
    );
  }

  if (offer.isError) {
    return (
      <Container sx={{ maxWidth: '44rem', py: 6 }}>
        <Alert>{offer.error.message}</Alert>
      </Container>
    );
  }

  const product = offer.data.products.find((candidate) => candidate.id === productId);

  if (!product) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
        <Paper variant="outlined" sx={{ width: '100%', maxWidth: '31rem', px: '1.8rem', py: '2rem' }}>
          <Wordmark variant="h1" sx={{ mb: '0.2rem' }}>
            Together
          </Wordmark>
          <Eyebrow variant="overline" component="p" sx={{ mb: '1.4rem' }}>
            {offer.data.tenant.name}
          </Eyebrow>
          <CardTitle variant="h1">This product is not available</CardTitle>
          <Typography variant="body1" sx={{ mt: '1rem' }}>
            The checkout link may be old, or the product may still be a draft.
          </Typography>
        </Paper>
      </Box>
    );
  }

  if (purchaseComplete) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
        <Paper variant="outlined" sx={{ width: '100%', maxWidth: '31rem', px: '1.8rem', py: '2rem' }}>
          <Wordmark variant="h1" sx={{ mb: '0.2rem' }}>
            Together
          </Wordmark>
          <Eyebrow variant="overline" component="p" sx={{ mb: '1.4rem' }}>
            payment simulated
          </Eyebrow>
          <Stack useFlexGap spacing="1rem">
            <CardTitle variant="h1">You have access</CardTitle>
            <Typography variant="body1">{product.title}</Typography>
            {magicLinkUrl ? <Link href={magicLinkUrl}>Open your course</Link> : null}
            <FinePrint variant="caption" component="p">
              {magicLinkUrl
                ? 'In production, Together would send this link by email.'
                : 'The purchase was simulated, but no dev magic link is exposed.'}
            </FinePrint>
          </Stack>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
      <Paper
        variant="outlined"
        component="form"
        onSubmit={submit}
        sx={{ width: '100%', maxWidth: '31rem', px: '1.8rem', py: '2rem' }}
      >
        <Wordmark variant="h1" sx={{ mb: '0.2rem' }}>
          Together
        </Wordmark>
        <Eyebrow variant="overline" component="p" sx={{ mb: '1.4rem' }}>
          checkout · {offer.data.tenant.name}
        </Eyebrow>
        <Stack useFlexGap spacing="1rem">
          <CardTitle variant="h1">{product.title}</CardTitle>
          <Typography variant="body1">{product.description}</Typography>
          <Typography variant="h2" component="p">
            {formatPrice(product.priceCents, product.currency)}
          </Typography>
          <FormControl fullWidth>
            <FormLabel htmlFor="checkout-email">email</FormLabel>
            <OutlinedInput
              id="checkout-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </FormControl>
          <Button
            type="submit"
            variant="contained"
            color="secondary"
            disabled={simulatePurchase.isPending}
          >
            {simulatePurchase.isPending ? 'simulating payment…' : 'Simulate payment (dev)'}
          </Button>
          {simulatePurchase.isError ? (
            <Alert>
              {simulatePurchase.error instanceof ApiError
                ? simulatePurchase.error.appError.message
                : simulatePurchase.error.message}
            </Alert>
          ) : null}
        </Stack>
      </Paper>
    </Box>
  );
};
