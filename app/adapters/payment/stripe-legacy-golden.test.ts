import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { checkoutSessionInputSchema, ok, type CheckoutSessionInput, type Order, type OrderLine } from '#core/domain/index.js';
import { createDirectSalesLinkCheckout, fulfillStripeWebhook, startCheckoutSession, validateCheckoutSelection, type AutoInvoiceJob, type PaymentProvider, type PaymentWebhookEvent } from '#core/server/index.js';
import { createLegacyCheckoutHarness, legacyBaseUrl, legacyNow, legacyTenant } from '#core/server/testing/legacy-checkout-harness.js';

import { createStripePaymentProvider, stripeCheckoutSessionParams } from './stripe.js';

type PortInput = Parameters<PaymentProvider['createCheckoutSession']>[0];
type Harness = ReturnType<typeof createLegacyCheckoutHarness>;

const webhookSecret = 'whsec_legacy_golden';
const signer = new Stripe('sk_test_unused');

const withStripeAdapter = (h: Harness) => {
  const bodies: string[] = [];
  const inputs: PortInput[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    bodies.push(await new Request(input, init).text());
    return new Response(JSON.stringify({ id: 'cs_live_golden1', object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/cs_live_golden1' }), {
      status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_golden' },
    });
  };
  const provider = createStripePaymentProvider({
    resolver: { resolve: async () => ok('rk_live_golden') },
    clientFactory: (key) => new Stripe(key, { maxNetworkRetries: 0, httpClient: Stripe.createFetchHttpClient(fetchImpl) }),
  });
  h.checkoutDeps.payment = {
    ...provider,
    createCheckoutSession: async (input) => {
      inputs.push(structuredClone(input));
      return provider.createCheckoutSession(input);
    },
  };
  return { bodies, inputs, provider };
};

const publicCheckout = async (h: Harness, input: CheckoutSessionInput) => {
  const parsed = checkoutSessionInputSchema.parse(input);
  const selection = await validateCheckoutSelection(legacyTenant.id, parsed, h.checkoutDeps);
  if (!selection.ok) return selection;
  return startCheckoutSession(legacyTenant, legacyBaseUrl, parsed, selection.value, h.checkoutDeps, 'capture-1');
};

const directCheckout = (h: Harness) => createDirectSalesLinkCheckout(legacyTenant, legacyBaseUrl, {
  slug: 'collection',
  termsAcceptanceMessage: ({ termsUrl, privacyUrl }, language) => `${language}: I accept the [Terms](${termsUrl}) and the [Privacy policy](${privacyUrl}).`,
  couponDisclosureMessage: () => 'unused',
}, h.checkoutDeps);

const captureConsent = (h: Harness) => {
  h.captures.set('capture-1', {
    termsAccepted: true, termsUrl: 'https://acme.togethercommunity.app/terms', privacyUrl: 'https://acme.togethercommunity.app/privacy',
    selectedDefinitionIds: [], attachedDefinitionIds: [], collectedAt: legacyNow, confirmationBaseUrl: `${legacyBaseUrl}/marketing/confirm`,
  });
};

const verifySigned = (provider: PaymentProvider, session: Record<string, unknown>) => {
  const payloadRaw = JSON.stringify({
    id: 'evt_legacy_golden', object: 'event', api_version: '2025-03-31.basil', created: Math.floor(Date.parse(legacyNow) / 1000),
    livemode: true, type: 'checkout.session.completed', data: { object: session },
  });
  return provider.verifyWebhookEvent({
    tenantId: legacyTenant.id, mode: 'live', webhookSecret, payloadRaw,
    signatureHeader: signer.webhooks.generateTestHeaderString({ payload: payloadRaw, secret: webhookSecret }),
  });
};

const paidSession = (metadata: Record<string, string>, overrides: Record<string, unknown>) => ({
  id: 'cs_live_golden1', object: 'checkout.session', livemode: true, mode: 'payment', status: 'complete', payment_status: 'paid',
  currency: 'pln', customer: null, customer_email: 'buyer@example.com', payment_intent: 'pi_golden1', subscription: null, invoice: null,
  total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
  customer_details: { email: 'buyer@example.com', name: 'Buyer Example', phone: null, address: null, tax_ids: [] },
  metadata,
  ...overrides,
});

const courseInput: PortInput = {
  tenantId: 'tenant-a',
  checkoutBranding: { displayName: 'Acme', buttonColor: '#112233' },
  mode: 'live',
  productId: 'course-1',
  productName: 'Course One',
  checkoutSnapshotId: 'checkout-id-1',
  priceCents: 4900,
  currency: 'PLN',
  successUrl: 'https://acme.togethercommunity.app/checkout/course-1?status=success&purchase_kind=one_time&session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://acme.togethercommunity.app/checkout/course-1?status=cancelled',
  customerEmail: 'buyer@example.com',
  language: 'pl',
  checkoutConsentCaptureId: 'capture-1',
};

const courseParams = {
  branding_settings: { display_name: 'Acme', button_color: '#112233' },
  mode: 'payment',
  payment_intent_data: { metadata: { tenantId: 'tenant-a' } },
  success_url: 'https://acme.togethercommunity.app/checkout/course-1?status=success&purchase_kind=one_time&session_id={CHECKOUT_SESSION_ID}',
  cancel_url: 'https://acme.togethercommunity.app/checkout/course-1?status=cancelled',
  customer_email: 'buyer@example.com',
  locale: 'pl',
  line_items: [{ quantity: 1, price_data: { currency: 'pln', unit_amount: 4900, product_data: { name: 'Course One' } } }],
  metadata: {
    checkoutSnapshotId: 'checkout-id-1',
    tenantId: 'tenant-a',
    productId: 'course-1',
    priceId: '',
    memberEmail: 'buyer@example.com',
    language: 'pl',
    checkoutConsentCaptureId: 'capture-1',
  },
};

const courseBody = [
  'branding_settings[display_name]=Acme&branding_settings[button_color]=%23112233&mode=payment&payment_intent_data[metadata][tenantId]=tenant-a&success_url=https%3A%2F%2Facme.togethercommunity.app%2Fcheckout%2Fcourse-1%3Fstatus%3Dsuccess%26purchase_kind%3Done_time%26session_id%3D%7BCHECKOUT_SESSION_ID%7D&cancel_url=https%3A%2F%2Facme.togethercommunity.app%2Fcheckout%2Fcourse-1%3Fstatus%3Dcancelled&customer_email=buyer%40example.com&locale=pl&line_items[0][quantity]=1&line_items[0][price_data][currency]=pln&line_items[0][price_data][unit_amount]=4900&line_items[0][price_data][product_data][name]=Course%20One&metadata[checkoutSnapshotId]=checkout-id-1&metadata[tenantId]=tenant-a&metadata[productId]=course-1&metadata[priceId]=&metadata[memberEmail]=buyer%40example.com&metadata[language]=pl&metadata[checkoutConsentCaptureId]=capture-1',
];

const courseEvent: PaymentWebhookEvent = {
  apiVersion: '2025-03-31.basil',
  id: 'evt_legacy_golden',
  type: 'checkout.session.completed',
  objectId: 'cs_live_golden1',
  checkoutSession: {
    email: 'buyer@example.com',
    customerName: 'Buyer Example',
    customerCountry: null,
    billing: null,
    termsAccepted: false,
    paymentStatus: 'paid',
    subscriptionId: null,
    paymentIntentId: 'pi_golden1',
    invoiceId: null,
    amountTotalCents: 4900,
    discountTotalCents: 0,
    shipping: null,
    shippingCostCents: null,
    metadata: {
      attribution: null,
      tenantId: 'tenant-a',
      productId: 'course-1',
      priceId: null,
      memberEmail: 'buyer@example.com',
      language: 'pl',
      checkoutConsentCaptureId: 'capture-1',
      couponCheckoutSessionId: null,
      checkoutSnapshotId: 'checkout-id-1',
    },
  },
  tenantIds: ['tenant-a'],
  livemode: true,
};

const courseOrders: Order[] = [
  {
    mode: 'live',
    memberId: 'webhook-id-2',
    productId: 'course-1',
    priceId: null,
    kind: 'one_time',
    status: 'paid',
    amountCents: 4900,
    currency: 'PLN',
    provider: 'stripe',
    providerObjectIds: { checkoutSession: 'cs_live_golden1', paymentIntent: 'pi_golden1' },
    discountCents: 0,
    billing: null,
    attribution: null,
    lines: [
      {
        productId: 'course-1',
        name: 'Course One',
        productType: 'course',
        grossCents: 4900,
        netCents: 3984,
        vatCents: 916,
        vatRate: 23,
        vatExemptionBasis: null,
        vatExemptionBasisKind: null,
        issuedCount: null,
      },
    ],
    salesLinkId: null,
    paidAt: '2026-11-15T10:00:00.000Z',
    couponId: null,
    id: 'webhook-id-4',
    tenantId: 'tenant-a',
    createdAt: '2026-11-15T10:00:00.000Z',
  },
];

const courseJobs: AutoInvoiceJob[] = [
  {
    id: 'webhook-id-6',
    tenantId: 'tenant-a',
    webhookEventId: 'evt_legacy_golden',
    orderId: 'webhook-id-4',
    status: 'queued',
    attempts: 0,
    nextAttemptAt: '2026-11-15T10:00:00.000Z',
    lockedAt: null,
    lastError: null,
    createdAt: '2026-11-15T10:00:00.000Z',
  },
];

const printedInput: PortInput = {
  tenantId: 'tenant-a',
  checkoutBranding: { displayName: 'Acme', buttonColor: '#112233' },
  mode: 'live',
  productId: 'printed-1',
  productName: 'Printed book',
  checkoutSnapshotId: 'checkout-id-1',
  shipping: {
    allowedCountries: ['PL'],
    phone: true,
    option: { label: 'Courier', amountCents: 1999, currency: 'PLN', deliveryEstimateDays: { min: 1, max: 3 } },
  },
  priceCents: 2100,
  currency: 'PLN',
  successUrl: 'https://acme.togethercommunity.app/checkout/printed-1?status=success&purchase_kind=one_time&session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://acme.togethercommunity.app/checkout/printed-1?status=cancelled',
  customerEmail: 'buyer@example.com',
  language: 'en',
  priceId: 'price-printed-1',
  checkoutConsentCaptureId: 'capture-1',
  expiresAt: '2026-11-15T10:31:00.000Z',
};

const printedParams = {
  branding_settings: { display_name: 'Acme', button_color: '#112233' },
  shipping_address_collection: { allowed_countries: ['PL'] },
  phone_number_collection: { enabled: true },
  shipping_options: [
    {
      shipping_rate_data: {
        type: 'fixed_amount',
        fixed_amount: { amount: 1999, currency: 'pln' },
        display_name: 'Courier',
        tax_behavior: 'inclusive',
        delivery_estimate: { minimum: { unit: 'business_day', value: 1 }, maximum: { unit: 'business_day', value: 3 } },
      },
    },
  ],
  mode: 'payment',
  payment_intent_data: { metadata: { tenantId: 'tenant-a' } },
  success_url: 'https://acme.togethercommunity.app/checkout/printed-1?status=success&purchase_kind=one_time&session_id={CHECKOUT_SESSION_ID}',
  cancel_url: 'https://acme.togethercommunity.app/checkout/printed-1?status=cancelled',
  expires_at: 1794738660,
  customer_email: 'buyer@example.com',
  locale: 'en',
  line_items: [{ quantity: 1, price_data: { currency: 'pln', unit_amount: 2100, product_data: { name: 'Printed book' } } }],
  metadata: {
    checkoutSnapshotId: 'checkout-id-1',
    tenantId: 'tenant-a',
    productId: 'printed-1',
    priceId: 'price-printed-1',
    memberEmail: 'buyer@example.com',
    language: 'en',
    checkoutConsentCaptureId: 'capture-1',
  },
};

const printedBody = [
  'branding_settings[display_name]=Acme&branding_settings[button_color]=%23112233&shipping_address_collection[allowed_countries][0]=PL&phone_number_collection[enabled]=true&shipping_options[0][shipping_rate_data][type]=fixed_amount&shipping_options[0][shipping_rate_data][fixed_amount][amount]=1999&shipping_options[0][shipping_rate_data][fixed_amount][currency]=pln&shipping_options[0][shipping_rate_data][display_name]=Courier&shipping_options[0][shipping_rate_data][tax_behavior]=inclusive&shipping_options[0][shipping_rate_data][delivery_estimate][minimum][unit]=business_day&shipping_options[0][shipping_rate_data][delivery_estimate][minimum][value]=1&shipping_options[0][shipping_rate_data][delivery_estimate][maximum][unit]=business_day&shipping_options[0][shipping_rate_data][delivery_estimate][maximum][value]=3&mode=payment&payment_intent_data[metadata][tenantId]=tenant-a&success_url=https%3A%2F%2Facme.togethercommunity.app%2Fcheckout%2Fprinted-1%3Fstatus%3Dsuccess%26purchase_kind%3Done_time%26session_id%3D%7BCHECKOUT_SESSION_ID%7D&cancel_url=https%3A%2F%2Facme.togethercommunity.app%2Fcheckout%2Fprinted-1%3Fstatus%3Dcancelled&expires_at=1794738660&customer_email=buyer%40example.com&locale=en&line_items[0][quantity]=1&line_items[0][price_data][currency]=pln&line_items[0][price_data][unit_amount]=2100&line_items[0][price_data][product_data][name]=Printed%20book&metadata[checkoutSnapshotId]=checkout-id-1&metadata[tenantId]=tenant-a&metadata[productId]=printed-1&metadata[priceId]=price-printed-1&metadata[memberEmail]=buyer%40example.com&metadata[language]=en&metadata[checkoutConsentCaptureId]=capture-1',
];

const printedEvent: PaymentWebhookEvent = {
  apiVersion: '2025-03-31.basil',
  id: 'evt_legacy_golden',
  type: 'checkout.session.completed',
  objectId: 'cs_live_golden1',
  checkoutSession: {
    email: 'buyer@example.com',
    customerName: 'Jane Buyer',
    customerCountry: null,
    billing: null,
    termsAccepted: false,
    paymentStatus: 'paid',
    subscriptionId: null,
    paymentIntentId: 'pi_golden1',
    invoiceId: null,
    amountTotalCents: 4099,
    discountTotalCents: 0,
    shipping: {
      name: 'Jane Buyer',
      phone: '+48600100200',
      address: { line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL', state: null },
    },
    shippingCostCents: 1999,
    metadata: {
      attribution: null,
      tenantId: 'tenant-a',
      productId: 'printed-1',
      priceId: 'price-printed-1',
      memberEmail: 'buyer@example.com',
      language: 'en',
      checkoutConsentCaptureId: 'capture-1',
      couponCheckoutSessionId: null,
      checkoutSnapshotId: 'checkout-id-1',
    },
  },
  tenantIds: ['tenant-a'],
  livemode: true,
};

const printedOrders: Order[] = [
  {
    mode: 'live',
    memberId: 'webhook-id-2',
    productId: 'printed-1',
    priceId: 'price-printed-1',
    kind: 'one_time',
    status: 'paid',
    amountCents: 4099,
    currency: 'PLN',
    provider: 'stripe',
    providerObjectIds: { checkoutSession: 'cs_live_golden1', paymentIntent: 'pi_golden1' },
    discountCents: 0,
    billing: null,
    attribution: null,
    lines: [
      {
        productId: 'printed-1',
        name: 'Printed book',
        productType: 'physical',
        grossCents: 2100,
        netCents: 2000,
        vatCents: 100,
        vatRate: 5,
        vatExemptionBasis: null,
        vatExemptionBasisKind: null,
        issuedCount: 0,
      },
      {
        productId: 'shipping:courier',
        name: 'Courier',
        productType: 'shipping',
        grossCents: 1999,
        netCents: 1851,
        vatCents: 148,
        vatRate: 8,
        vatExemptionBasis: null,
        vatExemptionBasisKind: null,
        issuedCount: null,
      },
    ],
    salesLinkId: null,
    shipping: {
      rateId: 'courier',
      label: 'Courier',
      amountCents: 1999,
      vatRatePercent: 8,
      carrier: 'other',
      pickupPoint: null,
      address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
      phone: '+48600100200',
    },
    fulfilmentStatus: 'to_pack',
    paidAt: '2026-11-15T10:00:00.000Z',
    couponId: null,
    id: 'webhook-id-3',
    tenantId: 'tenant-a',
    createdAt: '2026-11-15T10:00:00.000Z',
  },
];

const bundleLines: OrderLine[] = [
  {
    productId: 'course-1',
    name: 'Course One',
    productType: 'course',
    priceId: 'price-course-1',
    grossCents: 4900,
    netCents: 3984,
    vatCents: 916,
    vatRate: 23,
    vatExemptionBasis: null,
    vatExemptionBasisKind: null,
    issuedCount: null,
  },
  {
    productId: 'poster-1',
    name: 'Poster',
    productType: 'physical',
    priceId: 'price-poster-1',
    grossCents: 3500,
    netCents: 3241,
    vatCents: 259,
    vatRate: 8,
    vatExemptionBasis: null,
    vatExemptionBasisKind: null,
    issuedCount: 0,
  },
];

const bundleInput: PortInput = {
  tenantId: 'tenant-a',
  checkoutBranding: { displayName: 'Acme', buttonColor: '#112233' },
  mode: 'live',
  productId: 'course-1',
  productName: 'Course One',
  salesLinkId: 'link-1',
  checkoutSnapshotId: 'checkout-id-1',
  priceCents: 8400,
  currency: 'PLN',
  successUrl: 'https://acme.togethercommunity.app/offer/collection?status=success&purchase_kind=one_time&salesLinkId=link-1&session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://acme.togethercommunity.app/offer/collection?status=cancelled&checkout=together&salesLinkId=link-1',
  customerEmail: 'buyer@example.com',
  checkoutConsentCaptureId: 'capture-1',
  expiresAt: '2026-11-15T10:31:00.000Z',
  lines: bundleLines,
};

const bundleParams = {
  branding_settings: { display_name: 'Acme', button_color: '#112233' },
  mode: 'payment',
  payment_intent_data: { metadata: { tenantId: 'tenant-a' } },
  success_url: 'https://acme.togethercommunity.app/offer/collection?status=success&purchase_kind=one_time&salesLinkId=link-1&session_id={CHECKOUT_SESSION_ID}',
  cancel_url: 'https://acme.togethercommunity.app/offer/collection?status=cancelled&checkout=together&salesLinkId=link-1',
  expires_at: 1794738660,
  customer_email: 'buyer@example.com',
  line_items: [
    { quantity: 1, price_data: { currency: 'pln', unit_amount: 4900, product_data: { name: 'Course One' } } },
    { quantity: 1, price_data: { currency: 'pln', unit_amount: 3500, product_data: { name: 'Poster' } } },
  ],
  metadata: {
    salesLinkId: 'link-1',
    checkoutSnapshotId: 'checkout-id-1',
    productIds: '["course-1","poster-1"]',
    tenantId: 'tenant-a',
    productId: 'course-1',
    priceId: '',
    memberEmail: 'buyer@example.com',
    language: '',
    checkoutConsentCaptureId: 'capture-1',
  },
};

const bundleBody = [
  'branding_settings[display_name]=Acme&branding_settings[button_color]=%23112233&mode=payment&payment_intent_data[metadata][tenantId]=tenant-a&success_url=https%3A%2F%2Facme.togethercommunity.app%2Foffer%2Fcollection%3Fstatus%3Dsuccess%26purchase_kind%3Done_time%26salesLinkId%3Dlink-1%26session_id%3D%7BCHECKOUT_SESSION_ID%7D&cancel_url=https%3A%2F%2Facme.togethercommunity.app%2Foffer%2Fcollection%3Fstatus%3Dcancelled%26checkout%3Dtogether%26salesLinkId%3Dlink-1&expires_at=1794738660&customer_email=buyer%40example.com&line_items[0][quantity]=1&line_items[0][price_data][currency]=pln&line_items[0][price_data][unit_amount]=4900&line_items[0][price_data][product_data][name]=Course%20One&line_items[1][quantity]=1&line_items[1][price_data][currency]=pln&line_items[1][price_data][unit_amount]=3500&line_items[1][price_data][product_data][name]=Poster&metadata[salesLinkId]=link-1&metadata[checkoutSnapshotId]=checkout-id-1&metadata[productIds]=[%22course-1%22%2C%22poster-1%22]&metadata[tenantId]=tenant-a&metadata[productId]=course-1&metadata[priceId]=&metadata[memberEmail]=buyer%40example.com&metadata[language]=&metadata[checkoutConsentCaptureId]=capture-1',
];

const bundleEvent: PaymentWebhookEvent = {
  apiVersion: '2025-03-31.basil',
  id: 'evt_legacy_golden',
  type: 'checkout.session.completed',
  objectId: 'cs_live_golden1',
  checkoutSession: {
    email: 'buyer@example.com',
    customerName: 'Buyer Example',
    customerCountry: null,
    billing: null,
    termsAccepted: false,
    paymentStatus: 'paid',
    subscriptionId: null,
    paymentIntentId: 'pi_golden1',
    invoiceId: null,
    amountTotalCents: 8400,
    discountTotalCents: 0,
    shipping: null,
    shippingCostCents: null,
    metadata: {
      attribution: null,
      tenantId: 'tenant-a',
      productId: 'course-1',
      priceId: null,
      memberEmail: 'buyer@example.com',
      language: null,
      checkoutConsentCaptureId: 'capture-1',
      couponCheckoutSessionId: null,
      checkoutSnapshotId: 'checkout-id-1',
      salesLinkId: 'link-1',
      productIds: '["course-1","poster-1"]',
    },
  },
  tenantIds: ['tenant-a'],
  livemode: true,
};

const bundleOrders: Order[] = [
  {
    mode: 'live',
    memberId: 'webhook-id-2',
    productId: 'course-1',
    priceId: null,
    kind: 'one_time',
    status: 'paid',
    amountCents: 8400,
    currency: 'PLN',
    provider: 'stripe',
    providerObjectIds: { checkoutSession: 'cs_live_golden1', paymentIntent: 'pi_golden1' },
    discountCents: 0,
    billing: null,
    attribution: null,
    lines: [
      {
        productId: 'course-1',
        name: 'Course One',
        productType: 'course',
        priceId: 'price-course-1',
        grossCents: 4900,
        netCents: 3984,
        vatCents: 916,
        vatRate: 23,
        vatExemptionBasis: null,
        vatExemptionBasisKind: null,
        issuedCount: null,
      },
      {
        productId: 'poster-1',
        name: 'Poster',
        productType: 'physical',
        priceId: 'price-poster-1',
        grossCents: 3500,
        netCents: 3241,
        vatCents: 259,
        vatRate: 8,
        vatExemptionBasis: null,
        vatExemptionBasisKind: null,
        issuedCount: 0,
      },
    ],
    salesLinkId: 'link-1',
    paidAt: '2026-11-15T10:00:00.000Z',
    couponId: null,
    id: 'webhook-id-4',
    tenantId: 'tenant-a',
    createdAt: '2026-11-15T10:00:00.000Z',
  },
];

const directInput: PortInput = {
  tenantId: 'tenant-a',
  mode: 'live',
  productId: 'course-1',
  productName: 'Course One',
  salesLinkId: 'link-1',
  checkoutSnapshotId: 'checkout-id-1',
  priceCents: 8400,
  currency: 'PLN',
  language: 'pl',
  successUrl: 'https://acme.togethercommunity.app/offer/collection?status=success&purchase_kind=one_time&salesLinkId=link-1&session_id={CHECKOUT_SESSION_ID}',
  cancelUrl: 'https://acme.togethercommunity.app/offer/collection?status=cancelled&salesLinkId=link-1',
  directCheckout: {
    termsUrl: 'https://acme.togethercommunity.app/terms',
    privacyUrl: 'https://acme.togethercommunity.app/privacy',
    termsAcceptanceMessage: 'pl: I accept the [Terms](https://acme.togethercommunity.app/terms) and the [Privacy policy](https://acme.togethercommunity.app/privacy).',
  },
  checkoutBranding: { displayName: 'Acme', buttonColor: '#112233' },
  expiresAt: '2026-11-15T10:31:00.000Z',
  lines: bundleLines,
};

const directParams = {
  branding_settings: { display_name: 'Acme', button_color: '#112233' },
  mode: 'payment',
  payment_intent_data: { metadata: { tenantId: 'tenant-a' } },
  consent_collection: { terms_of_service: 'required' },
  custom_text: {
    terms_of_service_acceptance: {
      message: 'pl: I accept the [Terms](https://acme.togethercommunity.app/terms) and the [Privacy policy](https://acme.togethercommunity.app/privacy).',
    },
  },
  tax_id_collection: { enabled: true },
  allow_promotion_codes: false,
  success_url: 'https://acme.togethercommunity.app/offer/collection?status=success&purchase_kind=one_time&salesLinkId=link-1&session_id={CHECKOUT_SESSION_ID}',
  cancel_url: 'https://acme.togethercommunity.app/offer/collection?status=cancelled&salesLinkId=link-1',
  expires_at: 1794738660,
  locale: 'pl',
  line_items: [
    { quantity: 1, price_data: { currency: 'pln', unit_amount: 4900, product_data: { name: 'Course One' } } },
    { quantity: 1, price_data: { currency: 'pln', unit_amount: 3500, product_data: { name: 'Poster' } } },
  ],
  metadata: {
    directCheckout: 'true',
    termsUrl: 'https://acme.togethercommunity.app/terms',
    privacyUrl: 'https://acme.togethercommunity.app/privacy',
    salesLinkId: 'link-1',
    checkoutSnapshotId: 'checkout-id-1',
    productIds: '["course-1","poster-1"]',
    tenantId: 'tenant-a',
    productId: 'course-1',
    priceId: '',
    memberEmail: '',
    language: 'pl',
  },
};

const directBody = [
  'branding_settings[display_name]=Acme&branding_settings[button_color]=%23112233&mode=payment&payment_intent_data[metadata][tenantId]=tenant-a&consent_collection[terms_of_service]=required&custom_text[terms_of_service_acceptance][message]=pl%3A%20I%20accept%20the%20[Terms]%28https%3A%2F%2Facme.togethercommunity.app%2Fterms%29%20and%20the%20[Privacy%20policy]%28https%3A%2F%2Facme.togethercommunity.app%2Fprivacy%29.&tax_id_collection[enabled]=true&allow_promotion_codes=false&success_url=https%3A%2F%2Facme.togethercommunity.app%2Foffer%2Fcollection%3Fstatus%3Dsuccess%26purchase_kind%3Done_time%26salesLinkId%3Dlink-1%26session_id%3D%7BCHECKOUT_SESSION_ID%7D&cancel_url=https%3A%2F%2Facme.togethercommunity.app%2Foffer%2Fcollection%3Fstatus%3Dcancelled%26salesLinkId%3Dlink-1&expires_at=1794738660&locale=pl&line_items[0][quantity]=1&line_items[0][price_data][currency]=pln&line_items[0][price_data][unit_amount]=4900&line_items[0][price_data][product_data][name]=Course%20One&line_items[1][quantity]=1&line_items[1][price_data][currency]=pln&line_items[1][price_data][unit_amount]=3500&line_items[1][price_data][product_data][name]=Poster&metadata[directCheckout]=true&metadata[termsUrl]=https%3A%2F%2Facme.togethercommunity.app%2Fterms&metadata[privacyUrl]=https%3A%2F%2Facme.togethercommunity.app%2Fprivacy&metadata[salesLinkId]=link-1&metadata[checkoutSnapshotId]=checkout-id-1&metadata[productIds]=[%22course-1%22%2C%22poster-1%22]&metadata[tenantId]=tenant-a&metadata[productId]=course-1&metadata[priceId]=&metadata[memberEmail]=&metadata[language]=pl',
];

const directEvent: PaymentWebhookEvent = {
  apiVersion: '2025-03-31.basil',
  id: 'evt_legacy_golden',
  type: 'checkout.session.completed',
  objectId: 'cs_live_golden1',
  checkoutSession: {
    email: 'buyer@example.com',
    customerName: 'Buyer Company',
    customerCountry: 'PL',
    billing: { nip: '5260250274', companyName: 'Buyer Company', address: 'Main 1', postalCode: '00-001', city: 'Warsaw', country: 'PL' },
    termsAccepted: true,
    paymentStatus: 'paid',
    subscriptionId: null,
    paymentIntentId: 'pi_golden1',
    invoiceId: null,
    amountTotalCents: 8400,
    discountTotalCents: 0,
    shipping: null,
    shippingCostCents: null,
    metadata: {
      attribution: null,
      tenantId: 'tenant-a',
      directCheckout: true,
      termsUrl: 'https://acme.togethercommunity.app/terms',
      privacyUrl: 'https://acme.togethercommunity.app/privacy',
      productId: 'course-1',
      priceId: null,
      memberEmail: null,
      language: 'pl',
      checkoutConsentCaptureId: null,
      couponCheckoutSessionId: null,
      checkoutSnapshotId: 'checkout-id-1',
      salesLinkId: 'link-1',
      productIds: '["course-1","poster-1"]',
    },
  },
  tenantIds: ['tenant-a'],
  livemode: true,
};

const directOrders: Order[] = [
  {
    mode: 'live',
    memberId: 'webhook-id-2',
    productId: 'course-1',
    priceId: null,
    kind: 'one_time',
    status: 'paid',
    amountCents: 8400,
    currency: 'PLN',
    provider: 'stripe',
    providerObjectIds: { checkoutSession: 'cs_live_golden1', customerCountry: 'PL', paymentIntent: 'pi_golden1' },
    discountCents: 0,
    billing: { nip: '5260250274', companyName: 'Buyer Company', address: 'Main 1', postalCode: '00-001', city: 'Warsaw', country: 'PL' },
    attribution: null,
    lines: [
      {
        productId: 'course-1',
        name: 'Course One',
        productType: 'course',
        priceId: 'price-course-1',
        grossCents: 4900,
        netCents: 3984,
        vatCents: 916,
        vatRate: 23,
        vatExemptionBasis: null,
        vatExemptionBasisKind: null,
        issuedCount: null,
      },
      {
        productId: 'poster-1',
        name: 'Poster',
        productType: 'physical',
        priceId: 'price-poster-1',
        grossCents: 3500,
        netCents: 3241,
        vatCents: 259,
        vatRate: 8,
        vatExemptionBasis: null,
        vatExemptionBasisKind: null,
        issuedCount: 0,
      },
    ],
    salesLinkId: 'link-1',
    paidAt: '2026-11-15T10:00:00.000Z',
    couponId: null,
    id: 'webhook-id-4',
    tenantId: 'tenant-a',
    createdAt: '2026-11-15T10:00:00.000Z',
  },
];

describe('Stripe parameters of legacy checkout requests', () => {
  it.each([
    ['a single product', courseInput, courseParams],
    ['a single product with a price and delivery', printedInput, printedParams],
    ['a bundle sales link', bundleInput, bundleParams],
    ['a direct sales link', directInput, directParams],
  ])('maps %s to the same Stripe session parameters', (_case, input, params) => {
    expect(stripeCheckoutSessionParams(input)).toStrictEqual(params);
  });
});

describe('legacy checkout through the Stripe adapter and a signed completion', () => {
  it('pins a single-product checkout without a price', async () => {
    const h = createLegacyCheckoutHarness();
    const stripe = withStripeAdapter(h);
    captureConsent(h);
    expect(await publicCheckout(h, { productId: 'course-1', email: 'buyer@example.com', language: 'pl', termsAccepted: true }))
      .toStrictEqual(ok({ url: 'https://checkout.stripe.com/c/pay/cs_live_golden1', free: false }));
    expect(stripe.inputs).toStrictEqual([courseInput]);
    expect(stripe.bodies).toStrictEqual(courseBody);
    const event = await verifySigned(stripe.provider, paidSession(courseParams.metadata, { amount_total: 4900 }));
    expect(event).toStrictEqual(ok(courseEvent));
    expect(await fulfillStripeWebhook(legacyTenant, courseEvent, h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    expect(h.orders).toStrictEqual(courseOrders);
    expect(h.autoInvoiceJobs).toStrictEqual(courseJobs);
    expect(h.stockFake.reservations).toStrictEqual([]);
    expect(h.errors).toStrictEqual([]);
  });

  it('pins a single-product checkout with a price, delivery and a tracked stock level', async () => {
    const h = createLegacyCheckoutHarness();
    const stripe = withStripeAdapter(h);
    captureConsent(h);
    h.stockFake.track(legacyTenant.id, 'printed-1', 3);
    expect(await publicCheckout(h, { productId: 'printed-1', priceId: 'price-printed-1', email: 'buyer@example.com', language: 'en', termsAccepted: true, shipping: { rateId: 'courier' } }))
      .toStrictEqual(ok({ url: 'https://checkout.stripe.com/c/pay/cs_live_golden1', free: false }));
    expect(stripe.inputs).toStrictEqual([printedInput]);
    expect(stripe.bodies).toStrictEqual(printedBody);
    const event = await verifySigned(stripe.provider, paidSession(printedParams.metadata, {
      amount_total: 4099,
      total_details: { amount_discount: 0, amount_shipping: 1999, amount_tax: 0 },
      customer_details: { email: 'buyer@example.com', name: 'Jane Buyer', phone: '+48600100200', address: null, tax_ids: [] },
      shipping_cost: { amount_subtotal: 1999, amount_tax: 0, amount_total: 1999, shipping_rate: 'shr_golden' },
      collected_information: { shipping_details: { name: 'Jane Buyer', address: { line1: 'Garden Street 5', line2: null, postal_code: '00-950', city: 'Warsaw', country: 'PL', state: null } } },
    }));
    expect(event).toStrictEqual(ok(printedEvent));
    expect(await fulfillStripeWebhook(legacyTenant, printedEvent, h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    expect(h.orders).toStrictEqual(printedOrders);
    expect(h.autoInvoiceJobs).toStrictEqual([
      {
        id: 'webhook-id-5',
        tenantId: 'tenant-a',
        webhookEventId: 'evt_legacy_golden',
        orderId: 'webhook-id-3',
        status: 'queued',
        attempts: 0,
        nextAttemptAt: '2026-11-15T10:00:00.000Z',
        lockedAt: null,
        lastError: null,
        createdAt: '2026-11-15T10:00:00.000Z',
      },
    ]);
    expect(h.stockFake.reservations).toStrictEqual([
      {
        id: 'reservation-1',
        tenantId: 'tenant-a',
        productId: 'printed-1',
        checkoutSnapshotId: 'checkout-id-1',
        quantity: 1,
        status: 'committed',
        expiresAt: '2026-11-15T10:36:00.000Z',
      },
    ]);
    expect(h.stockFake.events).toStrictEqual([
      {
        tenantId: 'tenant-a',
        productId: 'printed-1',
        type: 'reserved',
        quantity: 1,
        reference: { checkoutSnapshotId: 'checkout-id-1', reservationId: 'reservation-1' },
      },
      {
        tenantId: 'tenant-a',
        productId: 'printed-1',
        type: 'committed',
        quantity: -1,
        reference: { checkoutSnapshotId: 'checkout-id-1', orderId: 'webhook-id-3', reservationId: 'reservation-1' },
      },
    ]);
    expect(h.stockFake.levels.get(legacyTenant.id, 'printed-1')).toStrictEqual({
      tenantId: 'tenant-a',
      productId: 'printed-1',
      onHand: 2,
      reserved: 0,
      lowStockThreshold: null,
      lowStockNotifiedAt: null,
      soldOutNotifiedAt: null,
      updatedAt: '2026-11-15T10:00:00.000Z',
    });
    expect(h.errors).toStrictEqual([]);
  });

  it('pins a bundle sales-link checkout through the public checkout session', async () => {
    const h = createLegacyCheckoutHarness();
    const stripe = withStripeAdapter(h);
    captureConsent(h);
    h.stockFake.track(legacyTenant.id, 'poster-1', 2);
    expect(await publicCheckout(h, { productId: 'course-1', salesLinkId: 'link-1', email: 'buyer@example.com', termsAccepted: true }))
      .toStrictEqual(ok({ url: 'https://checkout.stripe.com/c/pay/cs_live_golden1', free: false }));
    expect(stripe.inputs).toStrictEqual([bundleInput]);
    expect(stripe.bodies).toStrictEqual(bundleBody);
    const event = await verifySigned(stripe.provider, paidSession(bundleParams.metadata, { amount_total: 8400 }));
    expect(event).toStrictEqual(ok(bundleEvent));
    expect(await fulfillStripeWebhook(legacyTenant, bundleEvent, h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    expect(h.orders).toStrictEqual(bundleOrders);
    expect(h.autoInvoiceJobs).toStrictEqual([
      {
        id: 'webhook-id-6',
        tenantId: 'tenant-a',
        webhookEventId: 'evt_legacy_golden',
        orderId: 'webhook-id-4',
        status: 'queued',
        attempts: 0,
        nextAttemptAt: '2026-11-15T10:00:00.000Z',
        lockedAt: null,
        lastError: null,
        createdAt: '2026-11-15T10:00:00.000Z',
      },
    ]);
    expect(h.stockFake.reservations).toStrictEqual([
      {
        id: 'reservation-1',
        tenantId: 'tenant-a',
        productId: 'poster-1',
        checkoutSnapshotId: 'checkout-id-1',
        quantity: 1,
        status: 'committed',
        expiresAt: '2026-11-15T10:36:00.000Z',
      },
    ]);
    expect(h.stockFake.events).toStrictEqual([
      {
        tenantId: 'tenant-a',
        productId: 'poster-1',
        type: 'reserved',
        quantity: 1,
        reference: { checkoutSnapshotId: 'checkout-id-1', reservationId: 'reservation-1' },
      },
      {
        tenantId: 'tenant-a',
        productId: 'poster-1',
        type: 'committed',
        quantity: -1,
        reference: { checkoutSnapshotId: 'checkout-id-1', orderId: 'webhook-id-4', reservationId: 'reservation-1' },
      },
    ]);
    expect(h.stockFake.levels.get(legacyTenant.id, 'poster-1')).toStrictEqual({
      tenantId: 'tenant-a',
      productId: 'poster-1',
      onHand: 1,
      reserved: 0,
      lowStockThreshold: null,
      lowStockNotifiedAt: null,
      soldOutNotifiedAt: null,
      updatedAt: '2026-11-15T10:00:00.000Z',
    });
    expect(h.errors).toStrictEqual([]);
  });

  it('pins the direct sales-link checkout', async () => {
    const h = createLegacyCheckoutHarness();
    const stripe = withStripeAdapter(h);
    h.stockFake.track(legacyTenant.id, 'poster-1', 2);
    expect(await directCheckout(h)).toStrictEqual(ok({ url: 'https://checkout.stripe.com/c/pay/cs_live_golden1' }));
    expect(stripe.inputs).toStrictEqual([directInput]);
    expect(stripe.bodies).toStrictEqual(directBody);
    const event = await verifySigned(stripe.provider, paidSession(directParams.metadata, {
      amount_total: 8400, customer_email: null, consent: { promotions: null, terms_of_service: 'accepted' },
      customer_details: {
        email: 'buyer@example.com', name: 'Buyer Company', phone: null, tax_exempt: 'none',
        address: { line1: 'Main 1', line2: null, postal_code: '00-001', city: 'Warsaw', country: 'PL', state: null },
        tax_ids: [{ type: 'eu_vat', value: 'PL5260250274' }],
      },
    }));
    expect(event).toStrictEqual(ok(directEvent));
    expect(await fulfillStripeWebhook(legacyTenant, directEvent, h.webhookDeps)).toStrictEqual(ok({ processed: true }));
    expect(h.orders).toStrictEqual(directOrders);
    expect(h.autoInvoiceJobs).toStrictEqual([
      {
        id: 'webhook-id-6',
        tenantId: 'tenant-a',
        webhookEventId: 'evt_legacy_golden',
        orderId: 'webhook-id-4',
        status: 'queued',
        attempts: 0,
        nextAttemptAt: '2026-11-15T10:00:00.000Z',
        lockedAt: null,
        lastError: null,
        createdAt: '2026-11-15T10:00:00.000Z',
      },
    ]);
    expect(h.stockFake.reservations).toStrictEqual([
      {
        id: 'reservation-1',
        tenantId: 'tenant-a',
        productId: 'poster-1',
        checkoutSnapshotId: 'checkout-id-1',
        quantity: 1,
        status: 'committed',
        expiresAt: '2026-11-15T10:36:00.000Z',
      },
    ]);
    expect(h.stockFake.events).toStrictEqual([
      {
        tenantId: 'tenant-a',
        productId: 'poster-1',
        type: 'reserved',
        quantity: 1,
        reference: { checkoutSnapshotId: 'checkout-id-1', reservationId: 'reservation-1' },
      },
      {
        tenantId: 'tenant-a',
        productId: 'poster-1',
        type: 'committed',
        quantity: -1,
        reference: { checkoutSnapshotId: 'checkout-id-1', orderId: 'webhook-id-4', reservationId: 'reservation-1' },
      },
    ]);
    expect(h.stockFake.levels.get(legacyTenant.id, 'poster-1')).toStrictEqual({
      tenantId: 'tenant-a',
      productId: 'poster-1',
      onHand: 1,
      reserved: 0,
      lowStockThreshold: null,
      lowStockNotifiedAt: null,
      soldOutNotifiedAt: null,
      updatedAt: '2026-11-15T10:00:00.000Z',
    });
    expect(h.errors).toStrictEqual([]);
  });
});
