import { useEffect, useId, useMemo, useReducer, useState, type FormEvent, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormLabel,
  IconButton,
  OutlinedInput,
  Paper,
  Stack,
  SvgIcon,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { z } from 'zod';

import {
  attributionFromSearchParams,
  attributionToSearchParams,
  CART_CURRENCY_MISMATCH_MESSAGE,
  CART_LINES_PARAM,
  cartCurrencies,
  cartLineMaxQuantity,
  formatCartLinesParam,
  parseCartLinesParam,
  singleSellableOneTimePrice,
  type CartLine,
} from '#core/domain/index.js';
import { ApiError } from '#core/client/index.js';
import type { PublicOfferOutput } from '#core/contract/index.js';

import { actions } from '../../api.js';
import { BrandMark, TenantSocialLinks } from '../../branding.js';
import { FocusCard } from '../../components/layout/FocusCard.js';
import { StatusView } from '../../components/layout/StatusView.js';
import { CheckoutPriceBreakdown } from '../../components/ui/CheckoutStepParts.js';
import { Cover } from '../../components/ui/Cover.js';
import { TermsConsentField } from '../../components/ui/TermsConsentField.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { formatPrice } from '../../lib/format.js';
import { CardTitle, DataValue, EmberCtaButton, FinePrint } from '../../theme.js';
import { CheckoutPage } from './CheckoutPage.js';
import { checkoutRefusal, checkoutSessionError, completeEmail, CouponField, InvoiceFields, MarketingConsentFields, StripeTestModeControls, useInvoiceFields } from './CheckoutFormParts.js';
import { DeliveryStep } from './DeliveryStep.js';
import { ProductSafetyInfo } from './ProductSafetyInfo.js';
import { createCheckoutState, geowidgetAccess, reduceCheckoutState, selectDelivery } from './index.web.js';

type Translations = ReturnType<typeof useTranslations>;
type OfferProduct = PublicOfferOutput['products'][number];
type ProductOffer = { productId: string; offer: UseQueryResult<PublicOfferOutput> };
type CartItem =
  | { kind: 'missing'; productId: string }
  | { kind: 'unavailable'; productId: string; product: OfferProduct }
  | { kind: 'soldOut'; productId: string; product: OfferProduct }
  | { kind: 'ready'; productId: string; product: OfferProduct; unitCents: number; currency: string; quantity: number; max: number; stockCapped: boolean };

const StepIcon = ({ path }: { path: string }) => (
  <SvgIcon fontSize="small" aria-hidden><path d={path} /></SvgIcon>
);
const minusPath = 'M5 11h14v2H5z';
const plusPath = 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z';

const cartItem = (line: CartLine, product: OfferProduct | undefined): CartItem => {
  if (product === undefined) return { kind: 'missing', productId: line.productId };
  const price = singleSellableOneTimePrice(product.prices);
  if (product.type === 'membership' || price === null) {
    return { kind: 'unavailable', productId: line.productId, product };
  }
  const ruleMax = cartLineMaxQuantity(product.type);
  const max = Math.min(ruleMax, product.maxQuantity);
  if (product.stock.soldOut || max < 1) return { kind: 'soldOut', productId: line.productId, product };
  return {
    kind: 'ready', productId: line.productId, product, unitCents: price.amountCents, currency: price.currency,
    quantity: Math.min(line.quantity, max), max, stockCapped: max < ruleMax && product.stock.available === max,
  };
};

const soldOutDetailsSchema = z.object({ productId: z.string() });

const cartLineAlert = (item: Exclude<CartItem, { kind: 'ready' }>, t: Translations): string => {
  switch (item.kind) {
    case 'missing':
      return t.checkout.cartProductMissing;
    case 'unavailable':
      return `${item.product.title}: ${t.checkout.cartLineUnavailable}`;
    case 'soldOut':
      return `${item.product.title}: ${t.checkout.cartLineSoldOut}`;
  }
};

const CartOffers = ({ productIds, loaded, render }: {
  productIds: readonly string[];
  loaded: readonly ProductOffer[];
  render: (offers: readonly ProductOffer[]) => ReactNode;
}) => {
  const [productId, ...rest] = productIds;
  return productId === undefined
    ? render(loaded)
    : <CartOfferQuery productId={productId} rest={rest} loaded={loaded} render={render} />;
};

const CartOfferQuery = ({ productId, rest, loaded, render }: {
  productId: string;
  rest: readonly string[];
  loaded: readonly ProductOffer[];
  render: (offers: readonly ProductOffer[]) => ReactNode;
}) => {
  const offer = useQuery(actions.checkoutOffer(productId));
  return <CartOffers productIds={rest} loaded={[...loaded, { productId, offer }]} render={render} />;
};

const CartNotice = ({ title, body }: { title: string; body: string }) => {
  const t = useTranslations();
  return (
    <FocusCard brand={<BrandMark size="compact" />} eyebrow={t.checkout.checkoutEyebrow}>
      <StatusView state={{
        kind: 'not-found',
        title,
        body,
        action: <Button component={Link} to="/login" variant="contained">{t.checkout.goToLogin}</Button>,
      }} />
    </FocusCard>
  );
};

const CartCancelled = ({ onRetry }: { onRetry: () => void }) => {
  const t = useTranslations();
  return (
    <FocusCard brand={<BrandMark size="compact" />} eyebrow={t.checkout.cancelledEyebrow}>
      <Stack useFlexGap spacing="1rem">
        <CardTitle variant="h1">{t.checkout.cancelledTitle}</CardTitle>
        <Typography variant="body1">{t.checkout.cancelledBody}</Typography>
        <Button variant="contained" onClick={onRetry}>{t.checkout.retry}</Button>
      </Stack>
    </FocusCard>
  );
};

const CartLineRow = ({ item, disabled, onQuantityChange, onRemove }: {
  item: Extract<CartItem, { kind: 'ready' }>;
  disabled: boolean;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const { product, quantity, max, stockCapped } = item;
  return (
    <Paper variant="outlined" sx={{ p: '0.75rem' }} data-testid={`cart-line-${item.productId}`}>
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: '4.5rem minmax(0, 1fr) auto',
        gridTemplateAreas: {
          xs: '"cover info info" "controls controls amount" "note note note"',
          sm: '"cover info amount" "cover controls amount" "cover note amount"',
        },
        gridTemplateRows: { sm: 'auto auto 1fr' },
        columnGap: '0.75rem',
        rowGap: '0.35rem',
      }}>
        <Box sx={{ gridArea: 'cover' }}>
          <Cover src={product.coverUrl} title={product.title} alt={product.title} />
        </Box>
        <Stack useFlexGap spacing="0.35rem" sx={{ gridArea: 'info', minWidth: 0 }}>
          <Typography variant="h3" component="h2">{product.title}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t.checkout.cartUnitPrice({ price: formatPrice(item.unitCents, item.currency, language) })}
          </Typography>
        </Stack>
        <Stack direction="row" useFlexGap spacing="0.5rem" sx={{ gridArea: 'controls', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
          {max > 1 ? (
            <>
              <IconButton size="small" aria-label={t.checkout.cartDecrease({ title: product.title })}
                disabled={disabled || quantity <= 1} onClick={() => onQuantityChange(quantity - 1)}>
                <StepIcon path={minusPath} />
              </IconButton>
              <Typography component="output" aria-label={t.checkout.cartQuantity({ title: product.title })} data-testid={`cart-quantity-${item.productId}`}>
                {quantity}
              </Typography>
              <IconButton size="small" aria-label={t.checkout.cartIncrease({ title: product.title })}
                disabled={disabled || quantity >= max} onClick={() => onQuantityChange(quantity + 1)}>
                <StepIcon path={plusPath} />
              </IconButton>
            </>
          ) : null}
          <Button type="button" variant="text" size="small" disabled={disabled}
            aria-label={t.checkout.cartRemove({ title: product.title })} onClick={onRemove}>
            {t.checkout.cartRemoveLine}
          </Button>
        </Stack>
        {max > 1 ? (
          <FinePrint component="p" variant="caption" sx={{ gridArea: 'note' }}>
            {stockCapped ? t.checkout.cartStockLimit({ count: max }) : t.checkout.cartQuantityLimit({ max })}
          </FinePrint>
        ) : null}
        <Box sx={{ gridArea: 'amount', alignSelf: { xs: 'center', sm: 'start' }, justifySelf: 'end' }}>
          <DataValue data-testid={`cart-line-total-${item.productId}`}>
            {formatPrice(item.unitCents * quantity, item.currency, language)}
          </DataValue>
        </Box>
      </Box>
    </Paper>
  );
};

const CartCheckoutForm = ({ initialLines, offers }: { initialLines: readonly CartLine[]; offers: readonly ProductOffer[] }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [lines, setLines] = useState(initialLines);
  const paymentConfig = useQuery(actions.publicPaymentConfig);
  const testSession = useMutation({
    ...actions.stripeTestSession,
    onSuccess: () => { void paymentConfig.refetch(); },
  });
  const testEnabled = paymentConfig.data?.testEnabled === true;
  const stripeConfigured = testEnabled ? paymentConfig.data?.testConfigured === true : paymentConfig.data?.stripeConfigured === true;
  const [email, setEmail] = useState('');
  const invoice = useInvoiceFields();
  const initialCouponCode = new URLSearchParams(window.location.search).get('code') ?? '';
  const [checkoutState, dispatchCheckout] = useReducer(reduceCheckoutState, initialCouponCode, createCheckoutState);
  const { couponVisible, couponCode } = checkoutState;
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [marketingConsentDefinitionIds, setMarketingConsentDefinitionIds] = useState<string[]>([]);
  const payReasonId = useId();

  const productsById = new Map(offers.flatMap(({ productId, offer }) => {
    const product = offer.data?.products.find((candidate) => candidate.id === productId);
    return product === undefined ? [] : [[productId, product] as const];
  }));
  const items = lines.map((line) => cartItem(line, productsById.get(line.productId)));
  const readyItems = items.flatMap((item) => item.kind === 'ready' ? [item] : []);
  const cartLines = readyItems.map((item) => ({ productId: item.productId, quantity: item.quantity }));
  const cartKey = formatCartLinesParam(cartLines);
  const allReady = readyItems.length === items.length && items.length > 0;
  const blockedByLines = items.some((item) => item.kind !== 'ready');
  const currencies = cartCurrencies(readyItems);
  const currency = currencies.length === 1 ? currencies[0] ?? null : null;
  const currencyRefusal = currencies.length > 1 ? checkoutRefusal(CART_CURRENCY_MISMATCH_MESSAGE, t) : null;
  const subtotalCents = readyItems.reduce((total, item) => total + item.unitCents * item.quantity, 0);
  const shippingRequired = readyItems.some((item) => item.product.deliveryMethod === 'shipping');
  const shippingRates = paymentConfig.data?.shippingRates ?? [];
  const delivery = selectDelivery(checkoutState, { required: shippingRequired, rates: shippingRates });
  const deliveryCents = delivery.status === 'ready'
    ? shippingRates.find((rate) => rate.id === delivery.shipping.rateId)?.amountCents ?? 0
    : 0;
  const shipping = delivery.status === 'ready' ? { shipping: delivery.shipping } : {};
  const marketingConsents = [...new Map(readyItems.flatMap((item) => item.product.marketingConsents)
    .map((definition) => [definition.definitionId, definition] as const)).values()];
  const tenant = offers.find(({ offer }) => offer.data !== undefined)?.offer.data?.tenant;
  const legal = tenant?.legal ?? null;
  const consentRequired = legal !== null && (legal.termsUrl !== null || legal.privacyUrl !== null);
  const consent = consentRequired ? { termsAccepted } : {};

  const checkoutSession = useMutation({
    ...actions.createCartCheckoutSession,
    onSuccess: (data) => window.location.assign(data.url),
    onError: (error) => {
      if (error instanceof ApiError && error.appError.code === 'sold_out') for (const { offer } of offers) void offer.refetch();
    },
  });
  const couponValidation = useMutation({ ...actions.validateCartCouponForCheckout });
  const appliedCoupon = testEnabled ? undefined : couponValidation.data;
  const [autoValidatedFor, setAutoValidatedFor] = useState<string | null>(null);
  const autoValidationKey = `${email}|${cartKey}`;
  const autoValidationDue = initialCouponCode !== '' && couponCode === initialCouponCode && allReady && currency !== null &&
    completeEmail(email) && autoValidatedFor !== autoValidationKey;
  const couponResolving = couponValidation.isPending || autoValidationDue;

  useEffect(() => {
    if (!autoValidationDue) return;
    const timeout = window.setTimeout(() => {
      setAutoValidatedFor(autoValidationKey);
      couponValidation.mutate({ lines: cartLines, email, couponCode: initialCouponCode });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [autoValidationDue, autoValidationKey, cartLines, couponValidation, email, initialCouponCode]);

  const changeLines = (next: readonly CartLine[]) => {
    setLines(next);
    couponValidation.reset();
    checkoutSession.reset();
  };

  const loading = offers.some(({ offer }) => offer.isPending) || paymentConfig.isPending;
  const failedOffer = offers.find(({ offer }) => offer.isError && !(offer.error instanceof ApiError && offer.error.appError.code === 'not_found'));
  const socialLinks = tenant?.socialLinks ?? [];
  const socialFooter = socialLinks.length > 0 ? <TenantSocialLinks links={socialLinks} /> : undefined;

  if (loading) {
    return (
      <FocusCard brand={<BrandMark size="compact" />} eyebrow={t.checkout.checkoutEyebrow} footer={socialFooter} width="wide">
        <StatusView state={{ kind: 'loading', label: t.checkout.loading }} />
      </FocusCard>
    );
  }

  if (failedOffer !== undefined || paymentConfig.isError) {
    return (
      <FocusCard brand={<BrandMark size="compact" />} eyebrow={t.checkout.checkoutEyebrow} footer={socialFooter} width="wide">
        <StatusView state={{
          kind: 'error',
          message: localizeError(failedOffer?.offer.error ?? paymentConfig.error, t),
          retry: {
            label: t.common.retry,
            onRetry: () => {
              for (const { offer } of offers) void offer.refetch();
              void paymentConfig.refetch();
            },
          },
        }} />
      </FocusCard>
    );
  }

  if (items.length === 0) return <CartNotice title={t.checkout.cartEmptyTitle} body={t.checkout.cartEmptyBody} />;

  const payableCents = (appliedCoupon?.breakdown.finalCents ?? subtotalCents) + deliveryCents;
  const cartSummary = (summaryCurrency: string) => {
    const money = (cents: number) => formatPrice(cents, summaryCurrency, language);
    return {
      lines: [
        { label: t.checkout.breakdownProducts, amount: money(appliedCoupon?.breakdown.originalCents ?? subtotalCents), testId: 'cart-summary-products' },
        ...(appliedCoupon === undefined ? [] : [{ label: t.checkout.breakdownDiscount, amount: `−${money(appliedCoupon.breakdown.discountCents)}`, testId: 'cart-summary-discount' }]),
        ...(delivery.status === 'ready' ? [{ label: t.checkout.breakdownDelivery, amount: money(deliveryCents), testId: 'cart-summary-delivery' }] : []),
      ],
      total: { label: t.checkout.breakdownTotal, amount: money(payableCents), testId: 'cart-summary-total' },
    };
  };
  const sessionError = (error: unknown): string => {
    if (!(error instanceof ApiError) || error.appError.code !== 'sold_out') return checkoutSessionError(error, t);
    const details = soldOutDetailsSchema.safeParse(error.appError.details);
    const product = details.success ? productsById.get(details.data.productId) : undefined;
    return product === undefined ? checkoutSessionError(error, t) : t.checkout.cartStockRefusal({ title: product.title });
  };
  const formDisabled = checkoutSession.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (couponResolving || delivery.status === 'incomplete' || !allReady || currency === null) return;
    if (!stripeConfigured && payableCents > 0) return;
    checkoutSession.mutate({
      lines: cartLines,
      attribution: attributionFromSearchParams(new URLSearchParams(window.location.search)),
      email,
      language,
      ...(marketingConsentDefinitionIds.length === 0 ? {} : { marketingConsentDefinitionIds }),
      ...consent,
      ...invoice.billing,
      ...shipping,
      ...(appliedCoupon === undefined ? {} : { couponCode }),
    });
  };

  return (
    <FocusCard
      brand={<BrandMark size="compact" />}
      eyebrow={t.checkout.checkoutEyebrow}
      footer={socialFooter}
      width="wide"
      onSubmit={submit}
    >
      <Stack useFlexGap spacing="1rem">
        <CardTitle variant="h1">{t.checkout.cartTitle}</CardTitle>
        <Stack useFlexGap spacing="0.75rem" data-testid="cart-lines">
          {items.map((item) => {
            const remove = () => changeLines(lines.filter((line) => line.productId !== item.productId));
            if (item.kind === 'ready') {
              return (
                <CartLineRow key={item.productId} item={item} disabled={formDisabled} onRemove={remove}
                  onQuantityChange={(quantity) => changeLines(lines.map((line) => line.productId === item.productId ? { ...line, quantity } : line))} />
              );
            }
            return (
              <Alert key={item.productId} severity="error" data-testid={`cart-line-${item.productId}`}
                action={<Button type="button" color="inherit" size="small" onClick={remove}>{t.checkout.cartRemoveLine}</Button>}>
                {cartLineAlert(item, t)}
              </Alert>
            );
          })}
        </Stack>
        {currencyRefusal === null ? null : <Alert severity="error" data-testid="cart-currency-refusal">{currencyRefusal}</Alert>}
        {readyItems.flatMap(({ product }) => product.compliance == null ? [] : [
          <ProductSafetyInfo key={product.id} compliance={product.compliance} expanded={product.type === 'physical'}
            productTitle={readyItems.length > 1 ? product.title : undefined} />,
        ])}
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
        {currency === null ? null : <CouponField
          visible={couponVisible}
          testEnabled={testEnabled}
          code={couponCode}
          onVisibilityChange={(visible) => dispatchCheckout({ type: 'couponVisibilityChanged', visible })}
          onCodeChange={(code) => {
            dispatchCheckout({ type: 'couponCodeChanged', couponCode: code });
            couponValidation.reset();
          }}
          onApply={() => couponValidation.mutate({ lines: cartLines, ...(email === '' ? {} : { email }), couponCode })}
          validation={couponValidation}
          currency={currency}
          language={language}
          recurring={false}
        />}
        {consentRequired ? <TermsConsentField legal={legal} checked={termsAccepted} onChange={setTermsAccepted} /> : null}
        <MarketingConsentFields
          consents={marketingConsents}
          selected={marketingConsentDefinitionIds}
          onChange={(definitionId, checked) => setMarketingConsentDefinitionIds((current) =>
            checked ? [...current, definitionId] : current.filter((id) => id !== definitionId))}
        />
        {shippingRequired && currency !== null ? (
          <DeliveryStep
            rates={shippingRates}
            state={checkoutState}
            dispatch={dispatchCheckout}
            currency={currency}
            language={language}
            geowidget={paymentConfig.data.inpostGeowidgetWithheld ? { status: 'withheld_for_staff' } : geowidgetAccess({
              token: paymentConfig.data.inpostGeowidgetToken,
              staffSession: paymentConfig.data.canTest,
              testMode: testEnabled,
            })}
            disabled={checkoutSession.isPending}
          />
        ) : null}
        {currency === null ? null : (
          <Box data-testid="cart-summary">
            <CheckoutPriceBreakdown {...cartSummary(currency)} />
          </Box>
        )}
        <EmberCtaButton
          type="submit"
          variant="contained"
          fullWidth
          data-testid="checkout-pay-cta"
          aria-describedby={blockedByLines ? payReasonId : undefined}
          disabled={
            !allReady ||
            currency === null ||
            delivery.status === 'incomplete' ||
            testSession.isPending || checkoutSession.isPending ||
            couponResolving ||
            (testEnabled && payableCents === 0) ||
            (payableCents > 0 && !stripeConfigured)
          }
        >
          {currency === null ? t.checkout.cartPay : payableCents === 0
            ? checkoutSession.isPending ? t.checkout.freePending : t.checkout.freeIdle({ price: formatPrice(payableCents, currency, language) })
            : checkoutSession.isPending ? t.checkout.payPending : t.checkout.payIdle({ price: formatPrice(payableCents, currency, language) })}
        </EmberCtaButton>
        {blockedByLines ? (
          <Typography id={payReasonId} variant="body2" color="text.secondary" data-testid="cart-pay-reason">{t.checkout.cartPayBlockedLines}</Typography>
        ) : null}
        {currency !== null && payableCents > 0 && !stripeConfigured ? <Alert severity="error">{t.checkout.paymentUnavailable}</Alert> : null}
        {checkoutSession.isError ? <Alert severity="error">{sessionError(checkoutSession.error)}</Alert> : null}
      </Stack>
    </FocusCard>
  );
};

const CartCheckout = () => {
  const t = useTranslations();
  const [status, setStatus] = useState(() => new URLSearchParams(window.location.search).get('status'));
  const [initialLines] = useState(() => parseCartLinesParam(new URLSearchParams(window.location.search).get(CART_LINES_PARAM)));
  const productIds = useMemo(() => initialLines?.map((line) => line.productId) ?? [], [initialLines]);

  if (status === 'cancelled') {
    return <CartCancelled onRetry={() => {
      const search = new URLSearchParams(window.location.search);
      const retryParams = attributionToSearchParams(attributionFromSearchParams(search));
      const code = search.get('code');
      if (code !== null && code !== '') retryParams.set('code', code);
      const query = [`${CART_LINES_PARAM}=${encodeURIComponent(search.get(CART_LINES_PARAM) ?? '')}`, retryParams.toString()].filter((part) => part !== '').join('&');
      window.history.replaceState(null, '', `${window.location.pathname}?${query}`);
      setStatus(null);
    }} />;
  }

  if (initialLines === null) return <CartNotice title={t.checkout.cartInvalidTitle} body={t.checkout.cartInvalidBody} />;

  return <CartOffers productIds={productIds} loaded={[]} render={(offers) => <CartCheckoutForm initialLines={initialLines} offers={offers} />} />;
};

export const CartCheckoutPage = () =>
  new URLSearchParams(window.location.search).get('status') === 'success'
    ? <CheckoutPage productRef="" />
    : <CartCheckout />;
