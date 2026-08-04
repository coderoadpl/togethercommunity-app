import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormLabel,
  Link,
  OutlinedInput,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  SvgIcon,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { BrandMark, TenantSocialLinks } from '../../branding.js';
import { FocusCard } from '../../components/layout/FocusCard.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { RichTextContent } from '../../components/ui/RichTextContent.js';
import { TermsConsentField } from '../../components/ui/TermsConsentField.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';
import {
  CardTitle,
  CheckoutDisclosureButton,
  CheckoutPrice,
  CheckoutPriceOption,
  DataValue,
  FinePrint,
} from '../../theme.js';
import { createCheckoutState, reduceCheckoutState } from './index.web.js';

type OfferPrice = {
  id: string;
  kind: 'one_time' | 'recurring';
  interval: 'month' | 'year' | null;
  amountCents: number;
  currency: string;
};

const DisclosureIcon = ({ expanded }: { expanded: boolean }) => (
  <SvgIcon fontSize="small" aria-hidden>
    <path d={expanded ? 'M5 11h14v2H5z' : 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z'} />
  </SvgIcon>
);

const priceLabel = (
  price: OfferPrice,
  formattedPrice: string,
  t: ReturnType<typeof useTranslations>,
): string => {
  if (price.kind === 'one_time') return t.checkout.buyPrice({ price: formattedPrice });
  if (price.interval === 'year') return t.checkout.subscribeYearlyPrice({ price: formattedPrice });
  return t.checkout.subscribeMonthlyPrice({ price: formattedPrice });
};

const completeEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const couponError = (
  error: unknown,
  t: ReturnType<typeof useTranslations>,
): string => {
  if (!(error instanceof ApiError)) return localizeError(error, t);
  switch (error.appError.message) {
    case 'Coupon code is invalid':
      return t.checkout.couponInvalid;
    case 'This coupon is inactive':
      return t.checkout.couponInactive;
    case 'This coupon is not valid yet':
      return t.checkout.couponNotStarted;
    case 'This coupon has expired':
      return t.checkout.couponExpired;
    case 'This coupon does not apply to this product':
      return t.checkout.couponWrongScope;
    case 'This coupon does not apply to this price':
      return t.checkout.couponWrongPrice;
    case 'This coupon has reached its redemption limit':
      return t.checkout.couponLimit;
    case 'This coupon has reached its per-member redemption limit':
      return t.checkout.couponMemberLimit;
    case 'An email is required to validate this coupon':
      return t.checkout.couponEmailRequired;
    case 'This coupon does not reduce the selected price':
      return t.checkout.couponNoReduction;
    default:
      return localizeError(error, t);
  }
};

export const CheckoutPage = ({ productId }: { productId: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [checkoutStatus, setCheckoutStatus] = useState(() => new URLSearchParams(window.location.search).get('status'));
  const statusPage = checkoutStatus === 'success' || checkoutStatus === 'cancelled';
  const offer = useQuery({ ...actions.publicOffer, enabled: !statusPage });
  const paymentConfig = useQuery({ ...actions.publicPaymentConfig, enabled: !statusPage });
  const [email, setEmail] = useState('');
  const [invoiceVisible, setInvoiceVisible] = useState(false);
  const [nip, setNip] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('PL');
  const initialCouponCode = new URLSearchParams(window.location.search).get('code') ?? '';
  const [checkoutState, dispatchCheckout] = useReducer(
    reduceCheckoutState,
    initialCouponCode,
    createCheckoutState,
  );
  const { couponVisible, couponCode, selectedPriceId } = checkoutState;
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsentDefinitionIds, setMarketingConsentDefinitionIds] = useState<string[]>([]);
  const [purchaseComplete, setPurchaseComplete] = useState(false);
  const [magicLinkUrl, setMagicLinkUrl] = useState<string | null>(null);
  const product = offer.data?.products.find((candidate) => candidate.id === productId);
  const selectedPrice = product?.prices.find((price) => price.id === selectedPriceId) ?? product?.prices[0] ?? null;

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
  const couponValidation = useMutation({
    ...actions.validateCouponForCheckout,
  });
  const autoAppliedCoupon = useRef(false);

  useEffect(() => {
    if (
      autoAppliedCoupon.current ||
      initialCouponCode === '' ||
      product === undefined ||
      !completeEmail(email)
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      autoAppliedCoupon.current = true;
      couponValidation.mutate({
        productId,
        ...(selectedPrice === null ? {} : { priceId: selectedPrice.id }),
        email,
        couponCode: initialCouponCode,
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [couponValidation, email, initialCouponCode, product, productId, selectedPrice]);

  const legal = offer.data?.tenant.legal ?? null;
  const consentRequired = legal !== null && (legal.termsUrl !== null || legal.privacyUrl !== null);
  const consent = consentRequired ? { termsAccepted } : {};
  const billing = invoiceVisible
    ? {
        billing: {
          nip: nip === '' ? null : nip,
          companyName,
          address: billingAddress,
          postalCode,
          city,
          country,
        },
      }
    : {};

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const priceId = selectedPrice?.id;
    if (paymentConfig.data?.stripeConfigured || payableCents === 0) {
      checkoutSession.mutate({
        productId,
        email,
        language,
        ...(marketingConsentDefinitionIds.length === 0 ? {} : { marketingConsentDefinitionIds }),
        ...consent,
        ...billing,
        ...(priceId === undefined ? {} : { priceId }),
        ...(couponValidation.data === undefined ? {} : { couponCode }),
      });
      return;
    }
    simulatePurchase.mutate({
      email,
      productId,
      language,
      ...(marketingConsentDefinitionIds.length === 0 ? {} : { marketingConsentDefinitionIds }),
      ...consent,
      ...billing,
      ...(priceId === undefined ? {} : { priceId }),
      ...(couponValidation.data === undefined ? {} : { couponCode }),
    });
  };

  const retry = () => {
    window.history.replaceState(null, '', window.location.pathname);
    setCheckoutStatus(null);
  };

  const socialLinks = offer.data?.tenant.socialLinks ?? [];
  const socialFooter = socialLinks.length > 0
    ? <TenantSocialLinks links={socialLinks} />
    : undefined;

  if (checkoutStatus === 'success') {
    const subscriptionSuccess = new URLSearchParams(window.location.search).get('purchase_kind') === 'subscription';
    return (
      <FocusCard brand={<BrandMark size="compact" />} eyebrow={t.checkout.successEyebrow} footer={socialFooter}>
        <Stack useFlexGap spacing="1rem">
          <CardTitle variant="h1">
            {subscriptionSuccess ? t.checkout.subscriptionSuccessTitle : t.checkout.successTitle}
          </CardTitle>
          <Typography variant="body1">
            {subscriptionSuccess ? t.checkout.subscriptionSuccessBody : t.checkout.successBody}
          </Typography>
          <Button component="a" href="/login" variant="contained" fullWidth>
            {t.checkout.goToLogin}
          </Button>
        </Stack>
      </FocusCard>
    );
  }

  if (checkoutStatus === 'cancelled') {
    return (
      <FocusCard brand={<BrandMark size="compact" />} eyebrow={t.checkout.cancelledEyebrow} footer={socialFooter}>
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
      <FocusCard
        brand={<BrandMark size="compact" />}
        eyebrow={t.checkout.checkoutEyebrow}
        footer={socialFooter}
        width="wide"
      >
        <StatusView state={{ kind: 'loading', label: t.checkout.loading }} />
      </FocusCard>
    );
  }

  if (offer.isError || paymentConfig.isError) {
    return (
      <FocusCard
        brand={<BrandMark size="compact" />}
        eyebrow={t.checkout.checkoutEyebrow}
        footer={socialFooter}
        width="wide"
      >
        <StatusView
          state={{
            kind: 'error',
            message: localizeError(offer.error ?? paymentConfig.error, t),
            retry: {
              label: t.common.retry,
              onRetry: () => {
                void offer.refetch();
                void paymentConfig.refetch();
              },
            },
          }}
        />
      </FocusCard>
    );
  }

  if (!product) {
    return (
      <FocusCard
        brand={<BrandMark size="compact" />}
        eyebrow={t.checkout.checkoutEyebrow}
        footer={socialFooter}
      >
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

  const selectedAmountCents = selectedPrice?.amountCents ?? product.priceCents;
  const selectedCurrency = selectedPrice?.currency ?? product.currency;
  const payableCents = couponValidation.data?.breakdown.finalCents ?? selectedAmountCents;
  const formattedPayable = formatPrice(payableCents, selectedCurrency, language);

  if (purchaseComplete) {
    return (
      <FocusCard
        brand={<BrandMark size="compact" />}
        eyebrow={t.checkout.paymentSimulatedEyebrow}
        footer={socialFooter}
      >
        <Stack useFlexGap spacing="1rem">
          <CardTitle variant="h1">
            {simulatePurchase.data?.alreadyOwned
              ? t.checkout.alreadyOwnedTitle
              : simulatePurchase.data?.subscriptionId
                ? t.checkout.subscriptionSuccessTitle
                : t.checkout.accessGrantedTitle}
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
      brand={<BrandMark size="compact" />}
      eyebrow={t.checkout.checkoutEyebrow}
      footer={socialFooter}
      width="wide"
      onSubmit={submit}
    >
        <Stack useFlexGap spacing="1rem">
          <CardTitle variant="h1">{product.title}</CardTitle>
          {product.prices.length <= 1 ? (
            <CheckoutPrice component="p">
              <DataValue>{formatPrice(selectedAmountCents, selectedCurrency, language)}</DataValue>
            </CheckoutPrice>
          ) : null}
          {product.coverUrl === null ? null : (
            <Box
              component="img"
              src={product.coverUrl}
              alt={product.title}
              data-testid="checkout-product-cover"
              sx={{ width: '100%', maxHeight: 360, objectFit: 'cover' }}
            />
          )}
          <RichTextContent html={product.description} />
          {product.prices.length > 1 ? (
            <FormControl>
              <FormLabel id="checkout-price-choice">{t.checkout.priceChoiceLabel}</FormLabel>
              <RadioGroup
                aria-labelledby="checkout-price-choice"
                value={selectedPrice?.id ?? ''}
                onChange={(event) => {
                  dispatchCheckout({ type: 'priceSelected', priceId: event.target.value });
                  couponValidation.reset();
                }}
              >
                {product.prices.map((price) => (
                  <CheckoutPriceOption
                    key={price.id}
                    variant="outlined"
                    selected={price.id === selectedPrice?.id}
                    sx={{ px: '0.75rem', my: '0.3rem' }}
                  >
                    <FormControlLabel
                      value={price.id}
                      control={<Radio />}
                      label={priceLabel(price, formatPrice(price.amountCents, price.currency, language), t)}
                      data-testid={`checkout-price-${price.id}`}
                    />
                  </CheckoutPriceOption>
                ))}
              </RadioGroup>
            </FormControl>
          ) : null}
          <FormControl fullWidth>
            <FormLabel htmlFor="checkout-email">{t.checkout.emailLabel}</FormLabel>
            <OutlinedInput
              id="checkout-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                couponValidation.reset();
              }}
              autoComplete="email"
              required
            />
          </FormControl>
          <CheckoutDisclosureButton
            type="button"
            variant="text"
            size="small"
            color="primary"
            startIcon={<DisclosureIcon expanded={invoiceVisible} />}
            onClick={() => setInvoiceVisible((current) => !current)}
            aria-expanded={invoiceVisible}
            sx={{ alignSelf: 'flex-start' }}
          >
            {t.checkout.invoiceReveal}
          </CheckoutDisclosureButton>
          {invoiceVisible ? (
            <Stack useFlexGap spacing="0.75rem">
              {[
                ['checkout-nip', t.checkout.nipLabel, nip, setNip],
                ['checkout-company', t.checkout.companyNameLabel, companyName, setCompanyName],
                ['checkout-address', t.checkout.addressLabel, billingAddress, setBillingAddress],
                ['checkout-postal-code', t.checkout.postalCodeLabel, postalCode, setPostalCode],
                ['checkout-city', t.checkout.cityLabel, city, setCity],
                ['checkout-country', t.checkout.countryLabel, country, setCountry],
              ].map(([id, label, value, setValue]) => (
                <FormControl key={String(id)} fullWidth>
                  <FormLabel htmlFor={String(id)}>{String(label)}</FormLabel>
                  <OutlinedInput
                    id={String(id)}
                    value={String(value)}
                    onChange={(event) => {
                      if (typeof setValue === 'function') setValue(event.target.value);
                    }}
                    required={id !== 'checkout-nip'}
                    inputProps={id === 'checkout-nip' ? { inputMode: 'numeric', pattern: '[0-9]{10}' } : undefined}
                  />
                </FormControl>
              ))}
            </Stack>
          ) : null}
          <CheckoutDisclosureButton
            type="button"
            variant="text"
            size="small"
            color="primary"
            startIcon={<DisclosureIcon expanded={couponVisible} />}
            data-testid="checkout-coupon-reveal"
            onClick={() => dispatchCheckout({
              type: 'couponVisibilityChanged',
              visible: !couponVisible,
            })}
            aria-expanded={couponVisible}
            sx={{ alignSelf: 'flex-start' }}
          >
            {t.checkout.couponReveal}
          </CheckoutDisclosureButton>
          {couponVisible ? (
            <Stack useFlexGap spacing="0.5rem">
              <FormControl fullWidth>
                <FormLabel htmlFor="checkout-coupon">{t.checkout.couponLabel}</FormLabel>
                <OutlinedInput
                  id="checkout-coupon"
                  inputProps={{ 'data-testid': 'checkout-coupon-input' }}
                  value={couponCode}
                  onChange={(event) => {
                    dispatchCheckout({
                      type: 'couponCodeChanged',
                      couponCode: event.target.value,
                    });
                    couponValidation.reset();
                  }}
                />
              </FormControl>
              <Button
                type="button"
                variant="outlined"
                data-testid="checkout-coupon-apply"
                disabled={couponValidation.isPending || couponCode.trim() === ''}
                onClick={() => couponValidation.mutate({
                  productId,
                  ...(selectedPrice === null ? {} : { priceId: selectedPrice.id }),
                  ...(email === '' ? {} : { email }),
                  couponCode,
                })}
              >
                {couponValidation.isPending ? t.checkout.couponApplying : t.checkout.couponApply}
              </Button>
              {couponValidation.data === undefined ? null : (
                <Paper variant="outlined" sx={{ p: '0.75rem' }} data-testid="checkout-coupon-breakdown">
                  <Stack useFlexGap spacing="0.25rem">
                    <Typography>{t.checkout.couponOriginal({
                      price: formatPrice(couponValidation.data.breakdown.originalCents, selectedCurrency, language),
                    })}</Typography>
                    <Typography>{t.checkout.couponDiscount({
                      price: formatPrice(couponValidation.data.breakdown.discountCents, selectedCurrency, language),
                    })}</Typography>
                    <Typography data-testid="checkout-coupon-final">
                      {t.checkout.couponFinal({
                        price: formatPrice(couponValidation.data.breakdown.finalCents, selectedCurrency, language),
                      })}
                    </Typography>
                    {selectedPrice?.kind !== 'recurring' ? null : (
                      <Typography>
                        {couponValidation.data.recurringDuration === 'forever'
                          ? t.checkout.couponForever
                          : t.checkout.couponFirstInvoice}
                      </Typography>
                    )}
                    <FinePrint component="p" variant="caption">
                      {t.checkout.omnibusLowest({
                        price: formatPrice(
                          couponValidation.data.breakdown.lowestPriceLast30DaysCents,
                          selectedCurrency,
                          language,
                        ),
                      })}
                    </FinePrint>
                  </Stack>
                </Paper>
              )}
              {couponValidation.isError ? (
                <Alert severity="error" data-testid="checkout-coupon-error">
                  {couponError(couponValidation.error, t)}
                </Alert>
              ) : null}
            </Stack>
          ) : null}
          {consentRequired ? (
            <TermsConsentField legal={legal} checked={termsAccepted} onChange={setTermsAccepted} />
          ) : null}
          {product.marketingConsents.length > 0 ? (
            <FormControl component="fieldset">
              <FormLabel component="legend">{t.checkout.marketingConsentsLabel}</FormLabel>
              <Stack useFlexGap spacing="0.5rem">
                {product.marketingConsents.map((definition) => (
                  <FormControlLabel
                    key={definition.definitionId}
                    control={(
                      <Checkbox
                        checked={marketingConsentDefinitionIds.includes(definition.definitionId)}
                        onChange={(event) => setMarketingConsentDefinitionIds((current) =>
                          event.target.checked
                            ? [...current, definition.definitionId]
                            : current.filter((id) => id !== definition.definitionId))}
                      />
                    )}
                    label={(
                      <Stack useFlexGap spacing="0.2rem">
                        <Typography>{definition.label}</Typography>
                        {definition.documentUrl === null ? null : (
                          <Link href={definition.documentUrl} target="_blank" rel="noreferrer">
                            {t.checkout.marketingConsentDocument}
                          </Link>
                        )}
                        {definition.doubleOptIn ? (
                          <FinePrint component="span" variant="caption">{t.checkout.marketingConsentDoiHint}</FinePrint>
                        ) : null}
                      </Stack>
                    )}
                  />
                ))}
              </Stack>
            </FormControl>
          ) : null}
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={
              simulatePurchase.isPending ||
              checkoutSession.isPending ||
              (payableCents > 0 &&
                !paymentConfig.data.stripeConfigured &&
                !paymentConfig.data.simulatedPaymentsEnabled)
            }
          >
            {payableCents === 0
              ? simulatePurchase.isPending || checkoutSession.isPending
                ? t.checkout.freePending
                : t.checkout.freeIdle({ price: formattedPayable })
              : paymentConfig.data.stripeConfigured
              ? checkoutSession.isPending
                ? t.checkout.payPending
                : t.checkout.payIdle({ price: formattedPayable })
              : simulatePurchase.isPending
                ? t.checkout.submitPending
                : t.checkout.payIdle({ price: formattedPayable })}
          </Button>
          {payableCents > 0
          && !paymentConfig.data.stripeConfigured
          && paymentConfig.data.simulatedPaymentsEnabled ? (
            <FinePrint component="p" variant="caption">
              {t.checkout.simulatedPaymentDevNote}
            </FinePrint>
          ) : null}
          {selectedAmountCents > 0 &&
          paymentConfig.data.stripeConfigured &&
          paymentConfig.data.simulatedPaymentsEnabled ? (
            <Stack useFlexGap spacing="0.35rem">
              <Button
                type="button"
                variant="outlined"
                disabled={simulatePurchase.isPending || checkoutSession.isPending}
                onClick={() => simulatePurchase.mutate({
                  email,
                  productId,
                  language,
                  ...(marketingConsentDefinitionIds.length === 0 ? {} : { marketingConsentDefinitionIds }),
                  ...consent,
                  ...billing,
                  ...(selectedPrice === null ? {} : { priceId: selectedPrice.id }),
                  ...(couponValidation.data === undefined ? {} : { couponCode }),
                })}
              >
                {payableCents === 0
                  ? simulatePurchase.isPending
                    ? t.checkout.freePending
                    : t.checkout.freeIdle({ price: formattedPayable })
                  : simulatePurchase.isPending
                    ? t.checkout.submitPending
                    : t.checkout.submitIdle({ price: formattedPayable })}
              </Button>
              <FinePrint component="p" variant="caption">
                {t.checkout.simulatedPaymentDevNote}
              </FinePrint>
            </Stack>
          ) : null}
          {!paymentConfig.data.stripeConfigured && !paymentConfig.data.simulatedPaymentsEnabled ? (
            <Alert severity="error">{t.checkout.paymentUnavailable}</Alert>
          ) : null}
          {checkoutSession.isError ? (
            <Alert severity="error">
              {localizeError(checkoutSession.error, t)}
            </Alert>
          ) : null}
          {simulatePurchase.isError ? (
            <Alert severity="error">
              {localizeError(simulatePurchase.error, t)}
            </Alert>
          ) : null}
        </Stack>
    </FocusCard>
  );
};
