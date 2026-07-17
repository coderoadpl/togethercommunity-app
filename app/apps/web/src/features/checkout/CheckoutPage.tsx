import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  FormControl,
  FormLabel,
  Link,
  OutlinedInput,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';

import { actions } from '../../api.js';
import { FocusCard } from '../../components/layout/FocusCard.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';
import { CardTitle, DataValue, FinePrint } from '../../theme.js';

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
      <FocusCard eyebrow={t.checkout.successEyebrow}>
        <Stack useFlexGap spacing="1rem">
          <CardTitle variant="h1">{t.checkout.successTitle}</CardTitle>
          <Typography variant="body1">{t.checkout.successBody}</Typography>
          <Button component="a" href="/login" variant="contained" fullWidth>
            {t.checkout.goToLogin}
          </Button>
        </Stack>
      </FocusCard>
    );
  }

  if (checkoutStatus === 'cancelled') {
    return (
      <FocusCard eyebrow={t.checkout.cancelledEyebrow}>
        <Stack useFlexGap spacing="1rem">
          <CardTitle variant="h1">{t.checkout.cancelledTitle}</CardTitle>
          <Typography variant="body1">{t.checkout.cancelledBody}</Typography>
          <Button variant="contained" color="secondary" onClick={retry}>{t.checkout.retry}</Button>
        </Stack>
      </FocusCard>
    );
  }

  if (offer.isPending || paymentConfig.isPending) {
    return (
      <FocusCard eyebrow={t.checkout.checkoutEyebrow} width="wide">
        <StatusView state={{ kind: 'loading', label: t.checkout.loading }} />
      </FocusCard>
    );
  }

  if (offer.isError || paymentConfig.isError) {
    return (
      <FocusCard eyebrow={t.checkout.checkoutEyebrow} width="wide">
        <StatusView
          state={{ kind: 'error', message: localizeError(offer.error ?? paymentConfig.error, t) }}
        />
      </FocusCard>
    );
  }

  const product = offer.data.products.find((candidate) => candidate.id === productId);

  if (!product) {
    return (
      <FocusCard eyebrow={offer.data.tenant.name}>
        <StatusView
          state={{
            kind: 'not-found',
            title: t.checkout.unavailableTitle,
            body: t.checkout.unavailableBody,
            action: (
              <Button component="a" href="/login" variant="contained">
                {t.checkout.goToLogin}
              </Button>
            ),
          }}
        />
      </FocusCard>
    );
  }

  if (purchaseComplete) {
    return (
      <FocusCard eyebrow={t.checkout.paymentSimulatedEyebrow}>
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
      </FocusCard>
    );
  }

  return (
    <FocusCard
      eyebrow={t.checkout.eyebrow({ tenant: offer.data.tenant.name })}
      width="wide"
      onSubmit={submit}
    >
        <Stack useFlexGap spacing="1rem">
          <CardTitle variant="h1">{product.title}</CardTitle>
          <Typography variant="body1">{product.description}</Typography>
          <Typography variant="h2" component="p">
            <DataValue>{formatPrice(product.priceCents, product.currency, language)}</DataValue>
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
            {product.priceCents === 0
              ? simulatePurchase.isPending || checkoutSession.isPending
                ? t.checkout.freePending
                : t.checkout.freeIdle
              : paymentConfig.data.stripeConfigured
              ? checkoutSession.isPending
                ? t.checkout.payPending
                : t.checkout.payIdle
              : simulatePurchase.isPending
                ? t.checkout.submitPending
                : t.checkout.submitIdle}
          </Button>
          {product.priceCents > 0 &&
          paymentConfig.data.stripeConfigured &&
          paymentConfig.data.simulatedPaymentsEnabled ? (
            <Button
              type="button"
              variant="outlined"
              disabled={simulatePurchase.isPending || checkoutSession.isPending}
              onClick={() => simulatePurchase.mutate({ email, productId, language })}
            >
              {product.priceCents === 0
                ? simulatePurchase.isPending
                  ? t.checkout.freePending
                  : t.checkout.freeIdle
                : simulatePurchase.isPending
                  ? t.checkout.submitPending
                  : t.checkout.submitIdle}
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
    </FocusCard>
  );
};
