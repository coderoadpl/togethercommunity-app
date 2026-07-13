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
import { useLanguage, useTranslations } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';
import { CardTitle, DataValue, Eyebrow, FinePrint, Wordmark } from '../../theme.js';

export const CheckoutPage = ({ productId }: { productId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
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
    simulatePurchase.mutate({ email, productId, language });
  };

  if (offer.isPending) {
    return (
      <Container sx={{ maxWidth: '44rem', py: 6 }}>
        <Typography variant="h2" component="p">
          {t.checkout.loading}
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
          <CardTitle variant="h1">{t.checkout.unavailableTitle}</CardTitle>
          <Typography variant="body1" sx={{ mt: '1rem' }}>
            {t.checkout.unavailableBody}
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
            {t.checkout.paymentSimulatedEyebrow}
          </Eyebrow>
          <Stack useFlexGap spacing="1rem">
            <CardTitle variant="h1">{t.checkout.accessGrantedTitle}</CardTitle>
            <Typography variant="body1">{product.title}</Typography>
            {magicLinkUrl ? <Link href={magicLinkUrl}>{t.checkout.openCourse}</Link> : null}
            <FinePrint variant="caption" component="p">
              {magicLinkUrl ? t.checkout.productionNote : t.checkout.noMagicLinkNote}
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
          {t.checkout.eyebrow({ tenant: offer.data.tenant.name })}
        </Eyebrow>
        <Stack useFlexGap spacing="1rem">
          <CardTitle variant="h1">{product.title}</CardTitle>
          <Typography variant="body1">{product.description}</Typography>
          <Typography variant="h2" component="p">
            <DataValue>{formatPrice(product.priceCents, product.currency)}</DataValue>
          </Typography>
          <FormControl fullWidth>
            <FormLabel htmlFor="checkout-email">{t.checkout.emailLabel}</FormLabel>
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
            {simulatePurchase.isPending ? t.checkout.submitPending : t.checkout.submitIdle}
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
