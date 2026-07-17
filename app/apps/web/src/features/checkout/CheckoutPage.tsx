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

import { actions } from '../../api.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';
import { CardTitle, DataValue, Eyebrow, FinePrint, Wordmark } from '../../theme.js';

export const CheckoutPage = ({ productId }: { productId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [checkoutStatus, setCheckoutStatus] = useState(() => new URLSearchParams(window.location.search).get('status'));
  const statusPage = checkoutStatus === 'success' || checkoutStatus === 'cancelled';
  const offer = useQuery({ ...actions.publicOffer, enabled: !statusPage });
  const paymentConfig = useQuery({ ...actions.publicPaymentConfig, enabled: !statusPage });
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

  const checkoutSession = useMutation({
    ...actions.createCheckoutSession,
    onSuccess: (data) => window.location.assign(data.url),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (paymentConfig.data?.stripeConfigured) {
      checkoutSession.mutate({ productId, email, language });
      return;
    }
    simulatePurchase.mutate({ email, productId, language });
  };

  const retry = () => {
    window.history.replaceState(null, '', window.location.pathname);
    setCheckoutStatus(null);
  };

  if (checkoutStatus === 'success') {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
        <Paper variant="outlined" sx={{ width: '100%', maxWidth: '31rem', px: '1.8rem', py: '2rem' }}>
          <Wordmark variant="h1" sx={{ mb: '0.2rem' }}>Together</Wordmark>
          <Eyebrow variant="overline" component="p" sx={{ mb: '1.4rem' }}>{t.checkout.successEyebrow}</Eyebrow>
          <Stack useFlexGap spacing="1rem">
            <CardTitle variant="h1">{t.checkout.successTitle}</CardTitle>
            <Typography variant="body1">{t.checkout.successBody}</Typography>
          </Stack>
        </Paper>
      </Box>
    );
  }

  if (checkoutStatus === 'cancelled') {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: '1.5rem' }}>
        <Paper variant="outlined" sx={{ width: '100%', maxWidth: '31rem', px: '1.8rem', py: '2rem' }}>
          <Wordmark variant="h1" sx={{ mb: '0.2rem' }}>Together</Wordmark>
          <Eyebrow variant="overline" component="p" sx={{ mb: '1.4rem' }}>{t.checkout.cancelledEyebrow}</Eyebrow>
          <Stack useFlexGap spacing="1rem">
            <CardTitle variant="h1">{t.checkout.cancelledTitle}</CardTitle>
            <Typography variant="body1">{t.checkout.cancelledBody}</Typography>
            <Button variant="contained" color="secondary" onClick={retry}>{t.checkout.retry}</Button>
          </Stack>
        </Paper>
      </Box>
    );
  }

  if (offer.isPending || paymentConfig.isPending) {
    return (
      <Container sx={{ maxWidth: '44rem', py: 6 }}>
        <Typography variant="h2" component="p">
          {t.checkout.loading}
        </Typography>
      </Container>
    );
  }

  if (offer.isError || paymentConfig.isError) {
    return (
      <Container sx={{ maxWidth: '44rem', py: 6 }}>
        <Alert>{localizeError(offer.error ?? paymentConfig.error, t)}</Alert>
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
            <CardTitle variant="h1">
              {simulatePurchase.data?.alreadyOwned ? t.checkout.alreadyOwnedTitle : t.checkout.accessGrantedTitle}
            </CardTitle>
            {simulatePurchase.data?.alreadyOwned ? (
              <Typography variant="body1">{t.checkout.alreadyOwnedNote}</Typography>
            ) : null}
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
            disabled={
              simulatePurchase.isPending ||
              checkoutSession.isPending ||
              (!paymentConfig.data.stripeConfigured && !paymentConfig.data.simulatedPaymentsEnabled)
            }
          >
            {paymentConfig.data.stripeConfigured
              ? checkoutSession.isPending
                ? t.checkout.payPending
                : t.checkout.payIdle
              : simulatePurchase.isPending
                ? t.checkout.submitPending
                : t.checkout.submitIdle}
          </Button>
          {paymentConfig.data.stripeConfigured && paymentConfig.data.simulatedPaymentsEnabled ? (
            <Button
              type="button"
              variant="outlined"
              disabled={simulatePurchase.isPending || checkoutSession.isPending}
              onClick={() => simulatePurchase.mutate({ email, productId, language })}
            >
              {simulatePurchase.isPending ? t.checkout.submitPending : t.checkout.submitIdle}
            </Button>
          ) : null}
          {!paymentConfig.data.stripeConfigured && !paymentConfig.data.simulatedPaymentsEnabled ? (
            <Alert>{t.checkout.paymentUnavailable}</Alert>
          ) : null}
          {checkoutSession.isError ? (
            <Alert>
              {localizeError(checkoutSession.error, t)}
            </Alert>
          ) : null}
          {simulatePurchase.isError ? (
            <Alert>
              {localizeError(simulatePurchase.error, t)}
            </Alert>
          ) : null}
        </Stack>
      </Paper>
    </Box>
  );
};
