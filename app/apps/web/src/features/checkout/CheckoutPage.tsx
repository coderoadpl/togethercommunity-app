import { MetaCapiConsent } from './MetaCapiConsent.js';
import { BundleOfferSummary } from './BundleOfferSummary.js';
import { CheckoutAnalytics } from './CheckoutAnalytics.js';
import { checkoutSessionError, completeEmail, CouponField, InvoiceFields, MarketingConsentFields, StripeTestModeControls, useInvoiceFields } from './CheckoutFormParts.js';
import { DeliveryStep } from './DeliveryStep.js';
import { ProductSafetyInfo, ProductVariantChips } from './ProductSafetyInfo.js';
import { useCallback, useEffect, useMemo, useReducer, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  FormControl,
  FormControlLabel,
  FormLabel,
  Link as MuiLink,
  LinearProgress,
  OutlinedInput,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { attributionFromSearchParams, attributionToSearchParams, formatSalesLinkVariantParam, SALES_LINK_VARIANT_PARAM } from '#core/domain/index.js';
import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { BrandMark, TenantSocialLinks } from '../../branding.js';
import { FocusCard } from '../../components/layout/FocusCard.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { Cover } from '../../components/ui/Cover.js';
import { RichTextContent } from '../../components/ui/RichTextContent.js';
import { TermsConsentField } from '../../components/ui/TermsConsentField.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { formatOfferPrice, formatPrice } from '../../lib/format.js';
import {
  CardTitle,
  CheckoutPrice,
  CheckoutPriceOption,
  DataValue,
  EmberCtaButton,
  FinePrint,
} from '../../theme.js';
import { createCheckoutState, geowidgetAccess, reduceCheckoutState, selectDelivery } from './index.web.js';

type OfferPrice = {
  id: string;
  kind: 'one_time' | 'recurring';
  interval: 'day' | 'week' | 'month' | 'year' | null;
  amountCents: number;
  currency: string;
};

const priceLabel = (
  price: OfferPrice,
  formattedPrice: string,
  t: ReturnType<typeof useTranslations>,
): string => {
  if (price.kind === 'one_time') return t.checkout.buyPrice({ price: formattedPrice });
  if (price.interval === 'year') return t.checkout.subscribeYearlyPrice({ price: formattedPrice });
  return t.checkout.subscribeMonthlyPrice({ price: formattedPrice });
};

export const CheckoutPage = ({ productRef, salesLinkSlug }: { productRef: string; salesLinkSlug?: string }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [checkoutStatus, setCheckoutStatus] = useState(() => new URLSearchParams(window.location.search).get('status'));
  const statusPage = checkoutStatus === 'success' || checkoutStatus === 'cancelled';
  const singleOffer = useQuery({ ...actions.checkoutOffer(productRef), enabled: !statusPage && salesLinkSlug === undefined });
  const bundleOffer = useQuery({ ...actions.salesLinks.publicOffer(salesLinkSlug ?? '', new URLSearchParams(window.location.search).getAll(SALES_LINK_VARIANT_PARAM)), enabled: !statusPage && salesLinkSlug !== undefined });
  const offer = salesLinkSlug === undefined ? singleOffer : bundleOffer;
  const paymentConfig = useQuery(actions.publicPaymentConfig);
  const sessionId = new URLSearchParams(window.location.search).get('session_id');
  const hasSessionId = sessionId !== null && sessionId !== '';
  const [statusDeadline] = useState(() => Date.now() + 180_000);
  const [statusTimedOut, setStatusTimedOut] = useState(false);
  const paymentStatus = useQuery({
    ...actions.publicCheckoutSessionStatus(sessionId ?? '', language),
    enabled: (query) => checkoutStatus === 'success' && hasSessionId &&
      !statusTimedOut && query.state.data?.status !== 'paid',
    refetchInterval: (query) => query.state.data?.status === 'paid' ||
      statusTimedOut || Date.now() >= statusDeadline ? false : 3000,
    retry: false,
  });
  const paymentPaid = !hasSessionId || paymentStatus.data?.status === 'paid';

  useEffect(() => {
    if (checkoutStatus !== 'success' || paymentPaid) return;
    const timeout = window.setTimeout(() => setStatusTimedOut(true), Math.max(0, statusDeadline - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [checkoutStatus, paymentPaid, statusDeadline]);
  const testSession = useMutation({
    ...actions.stripeTestSession,
    onSuccess: () => { void paymentConfig.refetch(); },
  });
  const testEnabled = paymentConfig.data?.testEnabled === true;
  const testPurchase = paymentConfig.data?.canTest === true &&
    new URLSearchParams(window.location.search).get('test_purchase') === '1';
  const stripeConfigured = testEnabled ? paymentConfig.data?.testConfigured === true : paymentConfig.data?.stripeConfigured === true;
  const [email, setEmail] = useState('');
  const invoice = useInvoiceFields();
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
  const bundle = bundleOffer.data;
  const variantSelections = useMemo(() => salesLinkSlug === undefined ? [] : (bundle?.lines ?? []).flatMap((line) =>
    line.baseProductId === undefined || line.baseProductId === line.productId ? [] : [{ productId: line.baseProductId, variantProductId: line.productId }]), [bundle, salesLinkSlug]);
  const bundleVariantHref = useCallback((baseId: string, chosenId: string): string => {
    const search = new URLSearchParams(window.location.search);
    const params = attributionToSearchParams(attributionFromSearchParams(search));
    if (search.get('checkout') === 'together') params.set('checkout', 'together');
    const code = search.get('code');
    if (code) params.set('code', code);
    if (search.get('test_purchase') === '1') params.set('test_purchase', '1');
    for (const line of bundle?.lines ?? []) {
      const productId = line.baseProductId ?? line.productId;
      const variantProductId = productId === baseId ? chosenId : line.productId;
      if (variantProductId !== productId) params.append(SALES_LINK_VARIANT_PARAM, formatSalesLinkVariantParam({ productId, variantProductId }));
    }
    return `${window.location.pathname}?${params}`;
  }, [bundle]);
  const renderBundleLineVariants = useCallback((line: NonNullable<typeof bundle>['lines'][number]) =>
    bundle === undefined || (line.variants?.length ?? 0) < 2 ? null : <ProductVariantChips
      productId={line.productId} variants={line.variants ?? []}
      label={t.productVariants.offerLabelFor({ title: line.name })} ariaCurrent="true"
      takenProductIds={new Set(bundle.lines.filter((other) => other.productId !== line.productId).map((other) => other.productId))}
      hrefFor={(variant) => bundleVariantHref(line.baseProductId ?? line.productId, variant.productId)}
    />, [bundle, bundleVariantHref, t]);
  const product = useMemo(() => {
    const emptyPrices: OfferPrice[] = [];
    return salesLinkSlug === undefined ? singleOffer.data?.products.find(
    (candidate) => candidate.id === productRef || candidate.slug === productRef,
  ) : bundle === undefined ? undefined : { id: bundle.lines[0]?.baseProductId ?? bundle.lines[0]?.productId ?? '', title: bundle.salesLink.heading, description: '', coverUrl: null, vatRate: null, vatExemptionBasis: null, priceCents: bundle.totalCents, currency: bundle.currency, prices: emptyPrices, marketingConsents: bundle.marketingConsents };
  }, [bundle, productRef, salesLinkSlug, singleOffer.data]);
  const productId = product?.id ?? productRef;
  const offerProduct = salesLinkSlug === undefined ? singleOffer.data?.products.find((candidate) => candidate.id === productId) : undefined;
  const soldOut = salesLinkSlug === undefined
    ? singleOffer.data?.products.find((candidate) => candidate.id === productRef || candidate.slug === productRef)?.stock.soldOut === true
    : bundle?.soldOut === true;
  const safetyEntries = salesLinkSlug === undefined
    ? offerProduct?.compliance == null ? [] : [{ productId: offerProduct.id, title: offerProduct.title, type: offerProduct.type, compliance: offerProduct.compliance }]
    : (bundle?.lines ?? []).flatMap((line) => line.compliance == null ? [] : [{ productId: line.productId, title: line.name, type: line.type, compliance: line.compliance }]);
  const titledSafety = (bundle?.lines.length ?? 0) > 1;
  const selectedPrice = product?.prices.find((price) => price.id === selectedPriceId) ?? product?.prices[0] ?? null;
  const shippingRequired = salesLinkSlug === undefined
    ? singleOffer.data?.products.find((candidate) => candidate.id === productId)?.deliveryMethod === 'shipping'
    : bundle?.lines.some((line) => line.deliveryMethod === 'shipping') === true;
  const shippingRates = paymentConfig.data?.shippingRates ?? [];
  const delivery = selectDelivery(checkoutState, { required: shippingRequired, rates: shippingRates });
  const deliveryCents = delivery.status === 'ready'
    ? shippingRates.find((rate) => rate.id === delivery.shipping.rateId)?.amountCents ?? 0
    : 0;
  const shipping = delivery.status === 'ready' ? { shipping: delivery.shipping } : {};

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
  const appliedCoupon = testEnabled ? undefined : couponValidation.data;
  const [autoValidatedFor, setAutoValidatedFor] = useState<string | null>(null);
  const autoValidationKey = `${email}|${selectedPrice?.id ?? ''}`;
  const autoValidationDue = initialCouponCode !== '' && couponCode === initialCouponCode &&
    completeEmail(email) && autoValidatedFor !== autoValidationKey;
  const couponResolving = couponValidation.isPending || autoValidationDue;

  useEffect(() => {
    if (!autoValidationDue || product === undefined) return;
    const timeout = window.setTimeout(() => {
      setAutoValidatedFor(autoValidationKey);
      couponValidation.mutate({
        productId,
        ...(salesLinkSlug === undefined ? {} : { salesLinkSlug }),
        ...(variantSelections.length === 0 ? {} : { variantSelections }),
        ...(selectedPrice === null ? {} : { priceId: selectedPrice.id }),
        email,
        couponCode: initialCouponCode,
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [autoValidationDue, autoValidationKey, couponValidation, email, initialCouponCode, product, productId, salesLinkSlug, selectedPrice, variantSelections]);

  const legal = offer.data?.tenant.legal ?? null;
  const consentRequired = legal !== null && (legal.termsUrl !== null || legal.privacyUrl !== null);
  const consent = consentRequired ? { termsAccepted } : {};

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (couponResolving || delivery.status === 'incomplete') return;
    const priceId = selectedPrice?.id;
    if (stripeConfigured || payableCents === 0) {
      checkoutSession.mutate({
        attribution: attributionFromSearchParams(new URLSearchParams(window.location.search)),
        productId,
        ...(salesLinkSlug === undefined ? {} : { salesLinkSlug }),
        ...(variantSelections.length === 0 ? {} : { variantSelections }),
        email,
        language,
        ...(marketingConsentDefinitionIds.length === 0 ? {} : { marketingConsentDefinitionIds }),
        ...consent,
        ...invoice.billing,
        ...shipping,
        ...(priceId === undefined ? {} : { priceId }),
        ...(appliedCoupon === undefined ? {} : { couponCode }),
      });
      return;
    }
    simulatePurchase.mutate({
      email,
      productId,
      ...(salesLinkSlug === undefined ? {} : { salesLinkSlug }),
      ...(variantSelections.length === 0 ? {} : { variantSelections }),
      language,
      ...(marketingConsentDefinitionIds.length === 0 ? {} : { marketingConsentDefinitionIds }),
      ...consent,
      ...invoice.billing,
      ...shipping,
      ...(priceId === undefined ? {} : { priceId }),
      ...(appliedCoupon === undefined ? {} : { couponCode }),
    });
  };

  const togetherCheckout = new URLSearchParams(window.location.search).get('checkout') === 'together';
  const retryParams = attributionToSearchParams(attributionFromSearchParams(new URLSearchParams(window.location.search)));
  if (togetherCheckout) retryParams.set('checkout', 'together');
  const retryCouponCode = new URLSearchParams(window.location.search).get('code');
  if (retryCouponCode !== null && retryCouponCode !== '') retryParams.set('code', retryCouponCode);
  for (const value of new URLSearchParams(window.location.search).getAll(SALES_LINK_VARIANT_PARAM)) retryParams.append(SALES_LINK_VARIANT_PARAM, value);
  const retryUrl = `${window.location.pathname}${retryParams.size === 0 ? '' : `?${retryParams.toString()}`}`;
  const retry = () => {
    window.history.replaceState(null, '', retryUrl);
    setCheckoutStatus(null);
  };

  const socialLinks = offer.data?.tenant.socialLinks ?? [];
  const socialFooter = socialLinks.length > 0
    ? <TenantSocialLinks links={socialLinks} />
    : undefined;

  if (checkoutStatus === 'success') {
    const subscriptionSuccess = new URLSearchParams(window.location.search).get('purchase_kind') === 'subscription';
    const title = paymentPaid ? t.checkout.successTitle : t.checkout.successPendingTitle;
    const eyebrow = paymentPaid
      ? subscriptionSuccess ? t.checkout.subscriptionSuccessEyebrow : t.checkout.successPaidEyebrow
      : t.checkout.successEyebrow;
    return (
      <FocusCard brand={<BrandMark size="compact" />} eyebrow={eyebrow} footer={socialFooter}>
        <Stack useFlexGap spacing="1rem">
          {paymentConfig.data?.analytics ? <CheckoutAnalytics
            config={paymentConfig.data.analytics}
            sessionId={sessionId}
            purchase={paymentStatus.data?.status === 'paid' ? paymentStatus.data.analytics : undefined}
            testMode={testEnabled || sessionId?.startsWith('cs_test_') === true || new URLSearchParams(window.location.search).get('test_purchase') === '1'}
          /> : null}
          {sessionId && paymentStatus.data?.status === 'paid' && paymentStatus.data.metaCapi && !testEnabled && !testPurchase ? <MetaCapiConsent key={sessionId} sessionId={sessionId} config={paymentStatus.data.metaCapi} /> : null}
          {testPurchase ? <Alert severity="info">{t.checkout.testPurchase}</Alert> : null}
          <CardTitle variant="h1">{title}</CardTitle>
          <Typography variant="body1">
            {testPurchase ? t.checkout.testPurchaseBody : paymentPaid
              ? subscriptionSuccess ? t.checkout.subscriptionSuccessBody : t.checkout.successBody
              : statusTimedOut ? t.checkout.successPendingTimeout : t.checkout.successPendingBody}
          </Typography>
          {paymentPaid ? null : <LinearProgress aria-label={title} />}
          <Button component={Link} to="/login" variant={paymentPaid ? 'contained' : 'text'} fullWidth>
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
          <Button variant="contained" {...(salesLinkSlug === undefined || togetherCheckout ? { onClick: retry } : { href: retryUrl })}>
            {t.checkout.retry}
          </Button>
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

  if ((offer.isError && !(offer.error instanceof ApiError && offer.error.appError.code === 'not_found')) || paymentConfig.isError) {
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
              <Button component={Link} to="/login" variant="contained">
                {t.checkout.goToLogin}
              </Button>
            ),
          }}
        />
      </FocusCard>
    );
  }

  if (salesLinkSlug !== undefined && (!legal?.termsUrl || !legal.privacyUrl)) {
    return (
      <FocusCard brand={<BrandMark size="compact" />} eyebrow={t.checkout.checkoutEyebrow} footer={socialFooter}>
        <Alert severity="error">{t.checkout.unavailableTitle}</Alert>
      </FocusCard>
    );
  }

  const selectedAmountCents = selectedPrice?.amountCents ?? product.priceCents;
  const selectedCurrency = selectedPrice?.currency ?? product.currency;
  const payableCents = (appliedCoupon?.breakdown.finalCents ?? selectedAmountCents) + deliveryCents;
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
          {magicLinkUrl ? <MuiLink href={magicLinkUrl}>{t.checkout.openCourse}</MuiLink> : null}
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
          {bundle === undefined ? <CardTitle variant="h1">{product.title}</CardTitle> : null}
          {offerProduct === undefined ? null : <ProductVariantChips productId={offerProduct.id} variants={offerProduct.variants} />}
          {bundle === undefined && product.prices.length <= 1 ? (
            <CheckoutPrice component="p">
              <DataValue>
                {formatOfferPrice(selectedAmountCents, selectedCurrency, language, t.common.free)}
              </DataValue>
            </CheckoutPrice>
          ) : null}
          {bundle === undefined && product.vatRate != null ? <Typography variant="body2" color="text.secondary">{t.salesLinks.vatRate}: {product.vatRate === 'exempt' ? t.salesLinks.exempt : `${product.vatRate}%`}{product.vatExemptionBasis ? ` · ${product.vatExemptionBasis}` : ''}</Typography> : null}
          <Cover
            src={product.coverUrl}
            title={product.title}
            alt={product.title}
            frame="standalone"
            whenMissing="omit"
            testId="checkout-product-cover"
            fallbackTestId="checkout-product-cover-fallback"
          />
          {bundle === undefined ? <RichTextContent html={product.description} /> : <BundleOfferSummary afterName={renderBundleLineVariants} heading={bundle.salesLink.heading} descriptionHtml={bundle.descriptionHtml} lines={bundle.lines} currency={bundle.currency} totalCents={bundle.totalCents} />}
          {safetyEntries.map((entry) => (
            <ProductSafetyInfo key={entry.productId} compliance={entry.compliance} expanded={entry.type === 'physical'} productTitle={titledSafety ? entry.title : undefined} />
          ))}
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
                      label={priceLabel(
                        price,
                        formatOfferPrice(price.amountCents, price.currency, language, t.common.free),
                        t,
                      )}
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
          {paymentConfig.data.canTest && (paymentConfig.data.testConfigured || testEnabled) ? <StripeTestModeControls
            testConfigured={paymentConfig.data.testConfigured}
            testEnabled={testEnabled}
            disabled={testSession.isPending || checkoutSession.isPending}
            onChange={(enabled) => testSession.mutate({ enabled })}
            error={testSession.error}
          /> : null}
          <InvoiceFields invoice={invoice} />
          <CouponField
            visible={couponVisible}
            testEnabled={testEnabled}
            code={couponCode}
            onVisibilityChange={(visible) => dispatchCheckout({ type: 'couponVisibilityChanged', visible })}
            onCodeChange={(code) => {
              dispatchCheckout({ type: 'couponCodeChanged', couponCode: code });
              couponValidation.reset();
            }}
            onApply={() => couponValidation.mutate({
              productId,
              ...(salesLinkSlug === undefined ? {} : { salesLinkSlug }),
              ...(variantSelections.length === 0 ? {} : { variantSelections }),
              ...(selectedPrice === null ? {} : { priceId: selectedPrice.id }),
              ...(email === '' ? {} : { email }),
              couponCode,
            })}
            validation={couponValidation}
            currency={selectedCurrency}
            language={language}
            recurring={selectedPrice?.kind === 'recurring'}
          />
          {consentRequired ? (
            <TermsConsentField legal={legal} checked={termsAccepted} onChange={setTermsAccepted} />
          ) : null}
          <MarketingConsentFields
            consents={product.marketingConsents}
            selected={marketingConsentDefinitionIds}
            onChange={(definitionId, checked) => setMarketingConsentDefinitionIds((current) =>
              checked ? [...current, definitionId] : current.filter((id) => id !== definitionId))}
          />
          {shippingRequired ? (
            <DeliveryStep
              rates={shippingRates}
              state={checkoutState}
              dispatch={dispatchCheckout}
              currency={selectedCurrency}
              language={language}
              geowidget={paymentConfig.data.inpostGeowidgetWithheld ? { status: 'withheld_for_staff' } : geowidgetAccess({
                token: paymentConfig.data.inpostGeowidgetToken,
                staffSession: paymentConfig.data.canTest,
                testMode: testEnabled,
              })}
              disabled={simulatePurchase.isPending || checkoutSession.isPending}
            />
          ) : null}
          <EmberCtaButton
            type="submit"
            variant="contained"
            fullWidth
            data-testid="checkout-pay-cta"
            disabled={
              soldOut ||
              delivery.status === 'incomplete' ||
              simulatePurchase.isPending ||
              testSession.isPending || checkoutSession.isPending ||
              couponResolving ||
              (testEnabled && payableCents === 0) ||
              (payableCents > 0 &&
                !stripeConfigured &&
                !paymentConfig.data.simulatedPaymentsEnabled)
            }
          >
            {soldOut ? t.checkout.soldOut : bundle !== undefined && !checkoutSession.isPending && !simulatePurchase.isPending ? t.salesLinks.buyBundle : payableCents === 0
              ? simulatePurchase.isPending || checkoutSession.isPending
                ? t.checkout.freePending
                : t.checkout.freeIdle({ price: formattedPayable })
              : stripeConfigured
              ? checkoutSession.isPending
                ? t.checkout.payPending
                : t.checkout.payIdle({ price: formattedPayable })
              : simulatePurchase.isPending
                ? t.checkout.submitPending
                : t.checkout.payIdle({ price: formattedPayable })}
          </EmberCtaButton>
          {payableCents > 0
          && !stripeConfigured
          && paymentConfig.data.simulatedPaymentsEnabled ? (
            <FinePrint component="p" variant="caption">
              {t.checkout.simulatedPaymentNote}
            </FinePrint>
          ) : null}
          {selectedAmountCents > 0 &&
          stripeConfigured &&
          paymentConfig.data.simulatedPaymentsEnabled ? (
            <Stack useFlexGap spacing="0.35rem">
              <Button
                type="button"
                variant="outlined"
                disabled={soldOut || delivery.status === 'incomplete' || simulatePurchase.isPending || checkoutSession.isPending}
                onClick={() => simulatePurchase.mutate({
                  email,
                  productId,
                  ...(salesLinkSlug === undefined ? {} : { salesLinkSlug }),
                  ...(variantSelections.length === 0 ? {} : { variantSelections }),
                  language,
                  ...(marketingConsentDefinitionIds.length === 0 ? {} : { marketingConsentDefinitionIds }),
                  ...consent,
                  ...invoice.billing,
                  ...shipping,
                  ...(selectedPrice === null ? {} : { priceId: selectedPrice.id }),
                  ...(appliedCoupon === undefined ? {} : { couponCode }),
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
                {t.checkout.simulatedPaymentNote}
              </FinePrint>
            </Stack>
          ) : null}
          {payableCents > 0 && !stripeConfigured && !paymentConfig.data.simulatedPaymentsEnabled ? (
            <Alert severity="error">{t.checkout.paymentUnavailable}</Alert>
          ) : null}
          {checkoutSession.isError ? (
            <Alert severity="error">
              {checkoutSessionError(checkoutSession.error, t)}
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
