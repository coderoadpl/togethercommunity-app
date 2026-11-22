import { MetaCapiConsent } from './MetaCapiConsent.js';
import { CheckoutAnalytics } from './CheckoutAnalytics.js';
import { checkoutSessionError, completeEmail, CouponInputs, couponNeedsEmail, CouponTestModeNote, InvoiceInputs, MarketingConsentFields, StripeTestModeControls, useInvoiceFields } from './CheckoutFormParts.js';
import { checkoutFormKeyDown } from './checkout-keys.js';
import { DeliveryStep } from './DeliveryStep.js';
import { PersonalizationField, usePersonalizations } from './PersonalizationField.js';
import { ProductVariantChips } from './ProductSafetyInfo.js';
import { ProductSafetySummary } from './ProductSafetySummary.js';
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Alert,
  AlertTitle,
  Button,
  FormControl,
  FormControlLabel,
  FormHelperText,
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

import { attributionFromSearchParams, attributionToSearchParams, CHECKOUT_TERMS_ON_PAGE, CHECKOUT_TERMS_PARAM, checkoutReturnLink, formatSalesLinkVariantParam, isStripeTermsUrlMissing, SALES_LINK_VARIANT_PARAM } from '#core/domain/index.js';
import { ApiError } from '#core/client/index.js';

import { actions } from '../../api.js';
import { BrandMark, TenantSocialLinks } from '../../branding.js';
import { FocusCard } from '../../components/layout/FocusCard.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { CheckoutDisclosureRow, CheckoutPayBar, CheckoutPriceBreakdown, CheckoutSteps, CheckoutSummaryRow } from '../../components/ui/CheckoutStepParts.js';
import { useSuppressGlobalChrome } from '../../components/ui/app-chrome.js';
import { Cover } from '../../components/ui/Cover.js';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher.js';
import { OfferLines } from '../../components/ui/OfferLines.js';
import { PostContent } from '../../components/ui/PostContent.js';
import { RichTextContent } from '../../components/ui/RichTextContent.js';
import { TermsConsentField } from '../../components/ui/TermsConsentField.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { formatOfferPrice, formatPrice } from '../../lib/format.js';
import {
  CardTitle,
  CheckoutNoWrap,
  CheckoutPriceOption,
  CheckoutRowGroup,
  CheckoutTitle,
  CheckoutVariantGroup,
  FinePrint,
} from '../../theme.js';
import { createCheckoutState, geowidgetAccess, lockerCheckDue, lockerRefusal, reduceCheckoutState, selectDelivery } from './index.web.js';
import { useLockerCheck } from './use-locker-check.js';

type OfferPrice = {
  id: string;
  kind: 'one_time' | 'recurring';
  interval: 'day' | 'week' | 'month' | 'year' | null;
  amountCents: number;
  currency: string;
};

const stripeTermsRefused = (error: unknown): boolean =>
  error instanceof ApiError && isStripeTermsUrlMissing(error.appError);

const priceLabel = (
  price: OfferPrice,
  formattedPrice: string,
  t: ReturnType<typeof useTranslations>,
): string => {
  if (price.kind === 'one_time') return t.checkout.buyPrice({ price: formattedPrice });
  if (price.interval === 'year') return t.checkout.subscribeYearlyPrice({ price: formattedPrice });
  return t.checkout.subscribeMonthlyPrice({ price: formattedPrice });
};

const CheckoutEmailField = ({ value, onChange, hint, required }: {
  value: string;
  onChange: (value: string) => void;
  hint: string;
  required: boolean;
}) => {
  const t = useTranslations();
  const hintId = useId();
  return (
    <FormControl fullWidth>
      <FormLabel htmlFor="checkout-email">{t.checkout.emailLabel}</FormLabel>
      <OutlinedInput
        id="checkout-email"
        type="email"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="email"
        required={required}
        inputProps={{ 'aria-describedby': hintId }}
      />
      <FormHelperText id={hintId} sx={{ mx: 0 }}>{hint}</FormHelperText>
    </FormControl>
  );
};

const TermsFallbackLead = ({ line, children }: { line: string | null; children: ReactNode }) => {
  const leadRef = useRef<HTMLDivElement>(null);
  const leading = line !== null;
  useEffect(() => {
    if (!leading) return;
    const control = leadRef.current?.querySelector('input');
    if (control == null) return;
    control.scrollIntoView({ block: 'center' });
    control.focus({ preventScroll: true });
  }, [leading]);
  if (line === null) return children;
  return (
    <Stack ref={leadRef} useFlexGap spacing="0.5rem">
      <Typography role="alert" variant="body2" data-testid="checkout-terms-fallback-line">{line}</Typography>
      {children}
    </Stack>
  );
};

export const CheckoutPage = ({ productRef, salesLinkSlug }: { productRef: string; salesLinkSlug?: string }) => {
  useSuppressGlobalChrome();
  const t = useTranslations();
  const { language } = useLanguage();
  const [checkoutStatus, setCheckoutStatus] = useState(() => new URLSearchParams(window.location.search).get('status'));
  const statusPage = checkoutStatus === 'success' || checkoutStatus === 'cancelled';
  const singleOffer = useQuery({ ...actions.checkoutOffer(productRef), enabled: !statusPage && salesLinkSlug === undefined });
  const bundleOffer = useQuery({ ...actions.salesLinks.publicOffer(salesLinkSlug ?? '', new URLSearchParams(window.location.search).getAll(SALES_LINK_VARIANT_PARAM)), enabled: !statusPage && salesLinkSlug !== undefined });
  const offer = salesLinkSlug === undefined ? singleOffer : bundleOffer;
  const paymentConfig = useQuery(actions.publicPaymentConfig);
  const me = useQuery({ ...actions.me, enabled: !statusPage });
  const signedInEmail = me.data !== undefined && me.data.impersonation === null ? me.data.email : null;
  const sessionId = new URLSearchParams(window.location.search).get('session_id');
  const hasSessionId = sessionId !== null && sessionId !== '';
  const [statusDeadline, setStatusDeadline] = useState(() => Date.now() + 180_000);
  const [statusTimedOut, setStatusTimedOut] = useState(false);
  const paymentStatus = useQuery({
    ...actions.publicCheckoutSessionStatus(sessionId ?? '', language),
    enabled: (query) => checkoutStatus === 'success' && hasSessionId &&
      !statusTimedOut && (query.state.data?.status ?? 'pending') === 'pending',
    refetchInterval: (query) => (query.state.data?.status ?? 'pending') !== 'pending' || query.state.status === 'error' ||
      statusTimedOut || Date.now() >= statusDeadline ? false : 3000,
    retry: 1,
    retryDelay: 1000,
  });
  const paymentPaid = !hasSessionId || paymentStatus.data?.status === 'paid';
  const soldOutRefund = hasSessionId && paymentStatus.data?.status === 'cancelled';
  const paymentSettled = paymentPaid || soldOutRefund;
  const statusRequestFailed = hasSessionId && paymentStatus.isError && !paymentSettled;
  const workspaceOffer = useQuery({ ...actions.publicOffer, enabled: checkoutStatus === 'success' });
  const supportUrl = workspaceOffer.data?.tenant.support.url ?? null;
  const returnTitle = useRef<HTMLHeadingElement | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const checkAgain = () => {
    const wasFailed = statusRequestFailed;
    setStatusTimedOut(false);
    setStatusDeadline(Date.now() + 180_000);
    setRechecking(true);
    if (!wasFailed) window.requestAnimationFrame(() => returnTitle.current?.focus());
    void paymentStatus.refetch().finally(() => {
      setRechecking(false);
      if (wasFailed) window.requestAnimationFrame(() => returnTitle.current?.focus());
    });
  };

  useEffect(() => {
    if (checkoutStatus !== 'success' || paymentSettled) return;
    const timeout = window.setTimeout(() => setStatusTimedOut(true), Math.max(0, statusDeadline - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [checkoutStatus, paymentSettled, statusDeadline]);
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
  const checkLocker = useLockerCheck(checkoutState, dispatchCheckout);
  const submittingAfterLockerCheck = useRef(false);
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
    ? offerProduct?.compliance == null ? [] : [{ productId: offerProduct.id, title: offerProduct.title, coverUrl: offerProduct.coverUrl, compliance: offerProduct.compliance }]
    : (bundle?.lines ?? []).flatMap((line) => line.compliance == null ? [] : [{ productId: line.productId, title: line.name, coverUrl: line.coverUrl, compliance: line.compliance }]);
  const multiProduct = (bundle?.lines.length ?? 0) > 1;
  const selectedPrice = product?.prices.find((price) => price.id === selectedPriceId) ?? product?.prices[0] ?? null;
  const personalization = usePersonalizations(salesLinkSlug === undefined ? offerProduct === undefined || selectedPrice?.kind === 'recurring' ? [] : [{ productId: offerProduct.id, name: offerProduct.title, personalization: offerProduct.personalization }] : bundle?.lines ?? []);
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

  const [termsOnPageFallback, setTermsOnPageFallback] = useState(() =>
    new URLSearchParams(window.location.search).get(CHECKOUT_TERMS_PARAM) === CHECKOUT_TERMS_ON_PAGE);
  const [termsFallbackLed, setTermsFallbackLed] = useState(false);
  const checkoutSession = useMutation({
    ...actions.createCheckoutSession,
    onSuccess: (data) => window.location.assign(data.url),
    onError: (error) => {
      if (!stripeTermsRefused(error) || termsOnPageFallback) return;
      setTermsOnPageFallback(true);
      setTermsFallbackLed(true);
    },
  });
  const [couponEmailRequested, setCouponEmailRequested] = useState(false);
  const couponValidation = useMutation({
    ...actions.validateCouponForCheckout,
    onError: (error) => {
      if (couponNeedsEmail(error)) setCouponEmailRequested(true);
    },
  });
  const appliedCoupon = testEnabled ? undefined : couponValidation.data;
  const selectedAmountCents = selectedPrice?.amountCents ?? product?.priceCents ?? 0;
  const selectedCurrency = selectedPrice?.currency ?? product?.currency ?? '';
  const payableCents = (appliedCoupon?.breakdown.finalCents ?? selectedAmountCents) + deliveryCents;

  const legal = offer.data?.tenant.legal ?? null;
  const consentRequired = legal !== null && (legal.termsUrl !== null || legal.privacyUrl !== null);
  const simulationOffered = selectedAmountCents > 0 && stripeConfigured && paymentConfig.data?.simulatedPaymentsEnabled === true;
  const pageCollectsBuyer = termsOnPageFallback || !stripeConfigured || !legal?.termsUrl || !legal.privacyUrl || simulationOffered;
  const viaStripe = stripeConfigured && payableCents > 0;
  const stripeCollectsBuyer = viaStripe && !pageCollectsBuyer;
  const emailPlacement = signedInEmail !== null ? null
    : pageCollectsBuyer ? 'details'
      : couponEmailRequested ? 'coupon'
        : payableCents === 0 ? 'details' : null;
  const typedEmail = emailPlacement === null || !completeEmail(email) ? undefined : email;
  const buyerEmail = signedInEmail ?? (emailPlacement === 'details' ? email : typedEmail);
  const termsOnPage = consentRequired && !stripeCollectsBuyer;
  const consent = termsOnPage ? { termsAccepted } : {};

  const emailMattersForCoupon = signedInEmail === null && (pageCollectsBuyer || couponEmailRequested);
  const couponEmail = signedInEmail ?? (emailMattersForCoupon ? typedEmail : undefined);
  const [autoCouponCode, setAutoCouponCode] = useState(initialCouponCode);
  const [autoValidatedFor, setAutoValidatedFor] = useState<string | null>(null);
  const autoValidationKey = `${couponEmail ?? ''}|${selectedPrice?.id ?? ''}`;
  const rememberedCode = autoCouponCode !== '' && couponCode === autoCouponCode;
  const autoValidationDue = rememberedCode &&
    (!emailMattersForCoupon || typedEmail !== undefined) && autoValidatedFor !== autoValidationKey;
  const discardCouponResult = () => {
    couponValidation.reset();
    setAutoValidatedFor(null);
  };
  const couponResolving = couponValidation.isPending || autoValidationDue;

  useEffect(() => {
    if (!autoValidationDue || product === undefined || me.isPending || paymentConfig.isPending) return;
    const timeout = window.setTimeout(() => {
      setAutoValidatedFor(autoValidationKey);
      couponValidation.mutate({
        productId,
        ...(salesLinkSlug === undefined ? {} : { salesLinkSlug }),
        ...(variantSelections.length === 0 ? {} : { variantSelections }),
        ...(selectedPrice === null ? {} : { priceId: selectedPrice.id }),
        ...(couponEmail === undefined ? {} : { email: couponEmail }),
        couponCode: autoCouponCode,
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [autoCouponCode, autoValidationDue, autoValidationKey, couponEmail, couponValidation, me.isPending, paymentConfig.isPending, product, productId, salesLinkSlug, selectedPrice, variantSelections]);

  const purchaseRequest = () => ({
    productId,
    ...(salesLinkSlug === undefined ? {} : { salesLinkSlug }),
    ...(variantSelections.length === 0 ? {} : { variantSelections }),
    language,
    ...(marketingConsentDefinitionIds.length === 0 ? {} : { marketingConsentDefinitionIds }),
    ...consent,
    ...(termsOnPageFallback && termsOnPage ? { termsOnPage: true as const } : {}),
    ...invoice.billing,
    ...shipping,
    ...personalization.request,
    ...(selectedPrice === null ? {} : { priceId: selectedPrice.id }),
    ...(appliedCoupon === undefined ? {} : { couponCode }),
  });
  const simulate = () => simulatePurchase.mutate({ email: buyerEmail ?? email, ...purchaseRequest() });

  const proceed = () => {
    if (stripeConfigured || payableCents === 0) {
      const codeAtSubmit = appliedCoupon === undefined ? null : couponCode;
      const keyAtSubmit = autoValidationKey;
      checkoutSession.mutate({
        attribution: attributionFromSearchParams(new URLSearchParams(window.location.search)),
        ...(buyerEmail === undefined ? {} : { email: buyerEmail }),
        ...purchaseRequest(),
      }, {
        onError: (error) => {
          const refusal = error instanceof ApiError ? lockerRefusal(checkoutState.pickupPointCode, error.appError.details) : null;
          if (refusal !== null) dispatchCheckout({ type: 'lockerCheckChanged', check: refusal });
          if (codeAtSubmit === null || !stripeTermsRefused(error)) return;
          setAutoCouponCode(codeAtSubmit);
          setAutoValidatedFor(keyAtSubmit);
        },
      });
      return;
    }
    simulate();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (couponResolving || delivery.status === 'incomplete' || personalization.blocked || submittingAfterLockerCheck.current) return;
    if (lockerCheckDue(checkoutState) === null) {
      proceed();
      return;
    }
    submittingAfterLockerCheck.current = true;
    void checkLocker().then((check) => {
      submittingAfterLockerCheck.current = false;
      if (check?.status !== 'rejected') proceed();
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
  const frame = {
    brand: <BrandMark size="compact" />,
    headerAction: <LanguageSwitcher inline />,
    align: 'start',
    gutters: 'tight',
    footer: socialFooter,
  } as const;

  if (checkoutStatus === 'success') {
    const subscriptionSuccess = new URLSearchParams(window.location.search).get('purchase_kind') === 'subscription';
    const waiting = !paymentSettled && !testPurchase;
    const failed = waiting && statusRequestFailed;
    const timedOut = waiting && !failed && statusTimedOut;
    const title = soldOutRefund
      ? t.checkout.soldOutRefundTitle
      : paymentPaid
        ? t.checkout.successTitle
        : failed ? t.checkout.statusErrorTitle : timedOut ? t.checkout.successTimedOutTitle : t.checkout.successPendingTitle;
    const paidStatus = paymentStatus.data?.status === 'paid' ? paymentStatus.data : undefined;
    const shopLink = paidStatus?.returnUrl === undefined || paidStatus.checkoutRef === undefined ? null : checkoutReturnLink(paidStatus.returnUrl, {
      checkoutRef: paidStatus.checkoutRef, status: 'paid', clientReference: paidStatus.clientReference,
    });
    const eyebrow = soldOutRefund
      ? t.checkout.soldOutRefundEyebrow
      : paymentPaid
        ? subscriptionSuccess ? t.checkout.subscriptionSuccessEyebrow : hasSessionId ? t.checkout.successPaidEyebrow : t.checkout.successConfirmedEyebrow
        : t.checkout.successPendingEyebrow;
    const body = testPurchase
      ? [t.checkout.testPurchaseBody]
      : soldOutRefund
        ? paymentStatus.data?.charged === false
          ? [t.checkout.soldOutNothingChargedBody]
          : [t.checkout.soldOutRefundBody, t.checkout.soldOutRefundStarted, t.checkout.soldOutRefundTiming]
        : paymentPaid
          ? [subscriptionSuccess ? t.checkout.subscriptionSuccessBody : t.checkout.successBody]
          : failed
            ? [t.checkout.statusErrorBody]
            : timedOut
              ? [t.checkout.successPendingTimeout, ...(supportUrl === null ? [] : [t.checkout.successPendingContact])]
              : [t.checkout.successPendingBody];
    const paidLines = paymentPaid && !testPurchase && !soldOutRefund && !subscriptionSuccess
      ? [t.checkout.successBody, `${t.checkout.successWhere} ${t.checkout.successShipping}`, t.checkout.successSpam]
      : null;
    const failedContact = failed && statusTimedOut && supportUrl !== null;
    const offersRecheck = failed || timedOut;
    const externalContact = supportUrl !== null && !supportUrl.toLowerCase().startsWith('mailto:');
    const contactLink = supportUrl !== null && (soldOutRefund || timedOut || failedContact)
      ? externalContact
        ? <Button href={supportUrl} target="_blank" rel="noopener noreferrer" variant="outlined" fullWidth>{t.checkout.contactSeller}</Button>
        : <Button href={supportUrl} variant="outlined" fullWidth>{t.checkout.contactSeller}</Button>
      : null;
    return (
      <FocusCard {...frame} eyebrow={eyebrow}>
        <Stack useFlexGap spacing="1rem">
          {paymentConfig.data?.analytics ? <CheckoutAnalytics
            config={paymentConfig.data.analytics}
            sessionId={sessionId}
            purchase={paymentStatus.data?.status === 'paid' ? paymentStatus.data.analytics : undefined}
            testMode={testEnabled || sessionId?.startsWith('cs_test_') === true || new URLSearchParams(window.location.search).get('test_purchase') === '1'}
          /> : null}
          {sessionId && paymentStatus.data?.status === 'paid' && paymentStatus.data.metaCapi && !testEnabled && !testPurchase ? <MetaCapiConsent key={sessionId} sessionId={sessionId} config={paymentStatus.data.metaCapi} /> : null}
          {testPurchase ? <Alert severity="info">{t.checkout.testPurchase}</Alert> : null}
          <Stack useFlexGap spacing="1rem" role="status" aria-live="polite" aria-atomic="true" data-testid="checkout-return-status">
            <CardTitle variant="h1" ref={returnTitle} tabIndex={-1}>{title}</CardTitle>
            {failed ? (
              <>
                <Alert severity="error" role="none" data-testid="checkout-return-error">{body[0]}</Alert>
                {failedContact ? <Typography variant="body1">{t.checkout.successPendingContact}</Typography> : null}
              </>
            ) : (paidLines ?? body).map((line) => <Typography key={line} variant="body1">{line}</Typography>)}
          </Stack>
          {paymentSettled || offersRecheck ? null : <LinearProgress aria-label={title} />}
          {offersRecheck ? (
            <Button variant="contained" fullWidth onClick={checkAgain} disabled={rechecking}>
              {t.checkout.checkAgain}
            </Button>
          ) : null}
          {shopLink === null ? null : <Button href={shopLink} variant="contained" fullWidth>{t.checkout.backToShop}</Button>}
          {soldOutRefund ? <Button href="/" variant="contained" fullWidth>{t.checkout.backToShop}</Button> : null}
          {contactLink}
          {soldOutRefund ? null : (
            <Button component={Link} to="/login" variant={shopLink !== null ? 'outlined' : paymentPaid ? 'contained' : 'text'} fullWidth>
              {t.checkout.goToLogin}
            </Button>
          )}
        </Stack>
      </FocusCard>
    );
  }

  if (checkoutStatus === 'cancelled') {
    return (
      <FocusCard {...frame} eyebrow={t.checkout.cancelledEyebrow}>
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

  if (offer.isPending || paymentConfig.isPending || me.isPending) {
    return (
      <FocusCard
        {...frame}
        eyebrow={t.checkout.orderEyebrow}
        width="wide"
      >
        <StatusView state={{ kind: 'loading', label: t.checkout.loading }} />
      </FocusCard>
    );
  }

  if ((offer.isError && !(offer.error instanceof ApiError && offer.error.appError.code === 'not_found')) || paymentConfig.isError) {
    return (
      <FocusCard
        {...frame}
        eyebrow={t.checkout.orderEyebrow}
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
        {...frame}
        eyebrow={t.checkout.orderEyebrow}
      >
        <StatusView
          state={salesLinkSlug === undefined ? {
            kind: 'not-found',
            title: t.checkout.unavailableTitle,
            body: t.checkout.unavailableBody,
            action: (
              <Button component={Link} to="/login" variant="contained">
                {t.checkout.goToLogin}
              </Button>
            ),
          } : {
            kind: 'not-found',
            title: t.salesLinks.offerUnavailableTitle,
            body: t.salesLinks.offerUnavailableBody,
            action: <Button href="/" variant="contained">{t.salesLinks.goHome}</Button>,
          }}
        />
      </FocusCard>
    );
  }

  if (salesLinkSlug !== undefined && (!legal?.termsUrl || !legal.privacyUrl)) {
    return (
      <FocusCard {...frame} eyebrow={t.checkout.orderEyebrow}>
        <StatusView
          state={{
            kind: 'not-found',
            title: t.salesLinks.offerUnavailableTitle,
            body: t.salesLinks.offerUnavailableBody,
            action: <Button href="/" variant="contained">{t.salesLinks.goHome}</Button>,
          }}
        />
      </FocusCard>
    );
  }

  const formattedPayable = formatPrice(payableCents, selectedCurrency, language);
  const money = (cents: number) => formatPrice(cents, selectedCurrency, language);
  const priceBreakdown = {
    lines: [
      { label: t.checkout.breakdownProducts, amount: money(appliedCoupon?.breakdown.originalCents ?? selectedAmountCents), testId: 'checkout-breakdown-products' },
      ...(appliedCoupon === undefined ? [] : [{ label: t.checkout.breakdownDiscount, amount: `−${money(appliedCoupon.breakdown.discountCents)}`, testId: 'checkout-breakdown-discount' }]),
      ...(delivery.status === 'ready' ? [{ label: t.checkout.breakdownDelivery, amount: money(deliveryCents), testId: 'checkout-breakdown-delivery' }] : []),
    ],
    total: { label: t.checkout.breakdownTotal, amount: formattedPayable, testId: 'checkout-breakdown-total' },
  };

  if (purchaseComplete) {
    return (
      <FocusCard
        {...frame}
        eyebrow={t.checkout.paymentSimulatedEyebrow}
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

  const pending = simulatePurchase.isPending || checkoutSession.isPending;
  const paymentUnavailable = payableCents > 0 && !stripeConfigured && !paymentConfig.data.simulatedPaymentsEnabled;
  const testModeFreeOrder = testEnabled && payableCents === 0;
  const payDisabled = soldOut || pending || testSession.isPending || delivery.status === 'incomplete' ||
    personalization.blocked || couponResolving || testModeFreeOrder || paymentUnavailable;
  const payBlockedReason = soldOut || pending ? null
    : delivery.status === 'incomplete' ? delivery.missing === 'rate' ? t.checkout.payBlockedDelivery
      : delivery.missing === 'pickup_point_rejected' ? t.checkout.payBlockedLockerRejected : t.checkout.payBlockedLocker
      : personalization.reason === 'text' ? t.checkout.payBlockedPersonalizationText
        : personalization.reason === 'condition' ? t.checkout.payBlockedPersonalizationCondition
          : couponResolving ? t.checkout.payBlockedCoupon
            : testModeFreeOrder ? t.checkout.testModeCouponBlocked
              : null;
  const payLabel = soldOut ? t.checkout.soldOut
    : payableCents === 0 ? pending ? t.checkout.freePending : t.checkout.freeOrderIdle
      : stripeConfigured ? checkoutSession.isPending ? t.checkout.payPending : t.checkout.goToPayment({ price: formattedPayable })
        : simulatePurchase.isPending ? t.checkout.submitPending : t.checkout.payIdle({ price: formattedPayable });
  const simulatedPrimary = payableCents > 0 && !stripeConfigured && paymentConfig.data.simulatedPaymentsEnabled;
  const payNote = payBlockedReason !== null ? null : viaStripe
    ? t.checkout.nextStep({ email: buyerEmail === undefined && !testEnabled, address: shippingRequired, terms: stripeCollectsBuyer })
    : simulatedPrimary ? t.checkout.simulatedPaymentNote : null;
  const singleProductDetails = product.coverUrl !== null || product.description.trim() !== '' || product.vatRate != null ||
    priceBreakdown.lines.length > 1;
  const couponOffered = selectedAmountCents > 0 || couponCode.trim() !== '';
  const removeCoupon = () => {
    dispatchCheckout({ type: 'couponCodeChanged', couponCode: '' });
    discardCouponResult();
  };
  const variantLines = (bundle?.lines ?? []).flatMap((line) => {
    const chips = renderBundleLineVariants(line);
    return chips === null ? [] : [{ line, chips }];
  });
  const emailField = (hint: string, required: boolean) => (
    <CheckoutEmailField
      value={email}
      hint={hint}
      required={required}
      onChange={(value) => {
        setEmail(value);
        const keptResult = rememberedCode && couponValidation.data !== undefined && (emailPlacement !== 'coupon' || completeEmail(value));
        if (emailMattersForCoupon && !keptResult) discardCouponResult();
      }}
    />
  );

  return (
    <FocusCard
      {...frame}
      eyebrow={t.checkout.orderEyebrow}
      width="wide"
      onSubmit={submit}
      onKeyDown={checkoutFormKeyDown(payDisabled)}
    >
        <Stack useFlexGap spacing="1.25rem">
          {viaStripe ? (
            <CheckoutSteps
              label={t.checkout.stepsLabel}
              steps={[shippingRequired ? t.checkout.stepDelivery : t.checkout.stepOrder, t.checkout.stepDetailsAndPayment]}
              current={0}
            />
          ) : null}
          <Stack useFlexGap spacing="0.75rem">
            <CheckoutTitle variant="h1">{bundle === undefined ? product.title : bundle.salesLink.heading}</CheckoutTitle>
            {bundle?.soldOut === true ? (() => {
              const soldOutLines = bundle.lines.filter((line) => line.maxQuantity === 0);
              const takenProducts = new Set(bundle.lines.map((line) => line.productId));
              const variantLeft = soldOutLines.length > 0 && soldOutLines.every((line) =>
                line.variants.some((variant) => !variant.soldOut && variant.productId !== line.productId && !takenProducts.has(variant.productId)));
              const names = soldOutLines.map((line) => {
                const current = line.variants.find((variant) => variant.productId === line.productId);
                return variantLeft && current !== undefined ? `${line.name} (${current.label})` : line.name;
              }).join(', ');
              return (
                <Alert severity="warning" data-testid="bundle-sold-out-notice">
                  <AlertTitle>{variantLeft ? t.salesLinks.variantSoldOutTitle : t.salesLinks.soldOutTitle}</AlertTitle>
                  {soldOutLines.length === 0 ? null : variantLeft ? t.salesLinks.variantSoldOutLines({ names }) : t.salesLinks.soldOutLines({ names })}
                </Alert>
              );
            })() : null}
            <CheckoutSummaryRow
              items={t.checkout.itemCount({ count: bundle?.lines.length ?? 1 })}
              total={formatOfferPrice(payableCents, selectedCurrency, language, t.common.free)}
              detailsLabel={t.checkout.summaryDetails}
              detailsShortLabel={t.checkout.summaryDetailsShort}
            >
              {bundle === undefined ? !singleProductDetails ? null : (
                <Stack useFlexGap spacing="0.75rem">
                  <Cover
                    src={product.coverUrl}
                    title={product.title}
                    alt={product.title}
                    frame="standalone"
                    whenMissing="omit"
                    testId="checkout-product-cover"
                    fallbackTestId="checkout-product-cover-fallback"
                  />
                  <RichTextContent html={product.description} />
                  {product.vatRate == null ? null : (
                    <Typography variant="body2" color="text.secondary">{t.salesLinks.vatRate}: {product.vatRate === 'exempt' ? t.salesLinks.exempt : `${product.vatRate}%`}{product.vatExemptionBasis ? ` · ${product.vatExemptionBasis}` : ''}</Typography>
                  )}
                  <CheckoutPriceBreakdown {...priceBreakdown} />
                </Stack>
              ) : (
                <Stack useFlexGap spacing="1rem">
                  <PostContent html={bundle.descriptionHtml} format="markdown" />
                  <OfferLines lines={bundle.lines} currency={bundle.currency} cells="grid" />
                  <CheckoutPriceBreakdown {...priceBreakdown} />
                </Stack>
              )}
            </CheckoutSummaryRow>
          </Stack>
          {offerProduct === undefined || offerProduct.variants.length < 2 ? null : (
            <CheckoutVariantGroup>
              <Stack useFlexGap spacing="0.4rem">
                <Typography variant="body2" color="text.secondary">{t.productVariants.offerLabel}</Typography>
                <ProductVariantChips productId={offerProduct.id} variants={offerProduct.variants} />
              </Stack>
            </CheckoutVariantGroup>
          )}
          {variantLines.length === 0 ? null : (
            <CheckoutVariantGroup>
              <Stack useFlexGap spacing="0.75rem">
                {variantLines.map(({ line, chips }) => (
                  <Stack key={line.productId} useFlexGap spacing="0.4rem">
                    <Typography variant="body2" color="text.secondary">{line.name}</Typography>
                    {chips}
                  </Stack>
                ))}
              </Stack>
            </CheckoutVariantGroup>
          )}
          {product.prices.length > 1 ? (
            <FormControl>
              <FormLabel id="checkout-price-choice">{t.checkout.priceChoiceLabel}</FormLabel>
              <RadioGroup
                aria-labelledby="checkout-price-choice"
                value={selectedPrice?.id ?? ''}
                onChange={(event) => {
                  dispatchCheckout({ type: 'priceSelected', priceId: event.target.value });
                  if (appliedCoupon !== undefined) setAutoCouponCode(couponCode);
                  discardCouponResult();
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
          {shippingRequired ? (
            <DeliveryStep
              rates={shippingRates}
              state={checkoutState}
              dispatch={dispatchCheckout}
              checkLocker={checkLocker}
              currency={selectedCurrency}
              language={language}
              geowidget={paymentConfig.data.inpostGeowidgetWithheld ? { status: 'withheld_for_staff' } : geowidgetAccess({
                token: paymentConfig.data.inpostGeowidgetToken,
                staffSession: paymentConfig.data.canTest,
                testMode: testEnabled,
              })}
              disabled={pending}
              layout="cards"
            />
          ) : null}
          <PersonalizationField state={personalization} disabled={pending} />
          {emailPlacement === 'details' ? (
            <TermsFallbackLead line={termsFallbackLed ? t.checkout.termsOnPageFallbackEmail : null}>
              {emailField(t.checkout.emailHint, true)}
            </TermsFallbackLead>
          ) : null}
          {termsOnPage ? (
            <TermsFallbackLead line={termsFallbackLed && emailPlacement !== 'details' ? t.checkout.termsOnPageFallbackTerms : null}>
              <TermsConsentField legal={legal} checked={termsAccepted} onChange={setTermsAccepted} />
            </TermsFallbackLead>
          ) : null}
          <CheckoutRowGroup>
            <CheckoutDisclosureRow
              label={t.checkout.invoiceReveal}
              open={invoice.visible}
              onToggle={invoice.toggle}
              collapseOnEscape={false}
              testId="checkout-invoice-reveal"
            >
              <InvoiceInputs invoice={invoice} />
            </CheckoutDisclosureRow>
            {couponOffered ? (
              <CheckoutDisclosureRow
                label={appliedCoupon === undefined ? t.checkout.couponReveal : (
                  <>
                    {t.checkout.couponAppliedRow({ code: appliedCoupon.breakdown.code })}{' '}
                    <CheckoutNoWrap>{`−${money(appliedCoupon.breakdown.discountCents)}`}</CheckoutNoWrap>
                  </>
                )}
                open={couponVisible && !testEnabled}
                onToggle={() => dispatchCheckout({ type: 'couponVisibilityChanged', visible: !couponVisible })}
                disabled={testEnabled}
                testId="checkout-coupon-reveal"
                after={testEnabled ? <CouponTestModeNote /> : null}
              >
                <CouponInputs
                  code={couponCode}
                  onCodeChange={(code) => {
                    dispatchCheckout({ type: 'couponCodeChanged', couponCode: code });
                    discardCouponResult();
                  }}
                  onApply={() => couponValidation.mutate({
                    productId,
                    ...(salesLinkSlug === undefined ? {} : { salesLinkSlug }),
                    ...(variantSelections.length === 0 ? {} : { variantSelections }),
                    ...(selectedPrice === null ? {} : { priceId: selectedPrice.id }),
                    ...(couponEmail === undefined ? {} : { email: couponEmail }),
                    couponCode,
                  })}
                  validation={couponValidation}
                  currency={selectedCurrency}
                  language={language}
                  recurring={selectedPrice?.kind === 'recurring'}
                  variant="row"
                  onRemove={removeCoupon}
                >
                  {emailPlacement === 'coupon' ? emailField(t.checkout.couponEmailHint, false) : null}
                </CouponInputs>
              </CheckoutDisclosureRow>
            ) : null}
          </CheckoutRowGroup>
          <MarketingConsentFields
            consents={product.marketingConsents}
            selected={marketingConsentDefinitionIds}
            onChange={(definitionId, checked) => setMarketingConsentDefinitionIds((current) =>
              checked ? [...current, definitionId] : current.filter((id) => id !== definitionId))}
          />
          {paymentConfig.data.canTest && (paymentConfig.data.testConfigured || testEnabled) ? <StripeTestModeControls
            testConfigured={paymentConfig.data.testConfigured}
            testEnabled={testEnabled}
            disabled={testSession.isPending || checkoutSession.isPending}
            onChange={(enabled) => testSession.mutate({ enabled })}
            error={testSession.error}
          /> : null}
          <ProductSafetySummary entries={safetyEntries} multiProduct={multiProduct} />
          <CheckoutPayBar
            label={payLabel}
            disabled={payDisabled}
            reason={payBlockedReason}
            note={payNote}
            testId="checkout-pay-cta"
            messages={(
              <>
                {paymentUnavailable ? <Alert severity="error">{t.checkout.paymentUnavailable}</Alert> : null}
                {checkoutSession.isError && !stripeTermsRefused(checkoutSession.error) ? <Alert severity="error">{checkoutSessionError(checkoutSession.error, t)}</Alert> : null}
                {simulatePurchase.isError ? <Alert severity="error">{localizeError(simulatePurchase.error, t)}</Alert> : null}
              </>
            )}
          />
          {simulationOffered ? (
            <Stack useFlexGap spacing="0.35rem">
              <Button
                type="button"
                variant="outlined"
                disabled={soldOut || delivery.status === 'incomplete' || personalization.blocked || pending}
                onClick={simulate}
              >
                {payableCents === 0
                  ? simulatePurchase.isPending
                    ? t.checkout.freePending
                    : t.checkout.freeOrderIdle
                  : simulatePurchase.isPending
                    ? t.checkout.submitPending
                    : t.checkout.submitIdle({ price: formattedPayable })}
              </Button>
              <FinePrint component="p" variant="caption">
                {t.checkout.simulatedPaymentNote}
              </FinePrint>
            </Stack>
          ) : null}
        </Stack>
    </FocusCard>
  );
};
