# Physical shop integration

This guide uses the existing workspace, staff-session management API and anonymous
checkout. A backend program can create a physical product, publish it, read paid
orders and record fulfilment without driving the admin UI. A separately hosted
storefront needs only the public offer and checkout interfaces, never a staff
credential. These are source-level interfaces, not evidence that a particular
deployment, payment provider or mail delivery is configured correctly.

## 1. Authenticate the backend program

Use an existing verified account with an owner or admin grant in the workspace.
Catalog and order operations are available to both; changing workspace settings
and integration secrets requires the owner. A session has account authority, not
just authority over one product or one shop. Keep it only in a trusted backend.

The CLI supports password sign-in and a current authenticator code or an unused
backup code when two-factor authentication challenges the sign-in. Run from
`app/`. This is a template with placeholders, not real credentials:

```sh
pnpm run cli --api-url https://acme.togethercommunity.app --tenant acme login \
  --email '<account-email>' --password '<password>' --totp-code '<one-time-code>'
```

Omit `--totp-code` if no challenge is required. Use `--backup-code` instead of
`--totp-code` for a backup code, never both. Password sign-in is not a promise that
an OAuth-only or passkey-only account has a password. Use that account's existing
authentication/bootstrap path rather than inventing a password.

Never paste real credentials into shell history. CLI secret flags are also
visible in process arguments: use a protected, isolated automation environment
with command tracing and command capture disabled, or use the auth client from
protected application code. Do not log the successful authentication JSON, which
can contain the token. Do not put passwords, one-time codes or tokens in URLs,
source files, browser bundles or application logs.

The CLI stores the final bearer session token per canonical API origin in
`~/.config/together/config.json`, atomically written with file mode `0600`. Protect
the containing directory and the automation account too; the file is a credential,
not an encrypted vault. The configured session lifetime is **seven days**, with a
one-day session update age. It is not a permanent automation key: handle expiry,
revocation and reauthentication. `logout` revokes and drops the stored session.

The CLI supplies `Authorization: Bearer <session-token>` and `x-tenant: acme` on
management calls. An independent backend HTTP client must supply its own bearer
header from a protected secret store. Use the actual workspace origin, such as
`https://acme.togethercommunity.app`, throughout this guide. The tenantless
platform host intentionally ignores the tenant selector; a tenant header is not
a substitute for selecting the correct workspace host.

## 2. Read configuration before changing it

CLI reads using the saved origin profile are:

```sh
pnpm --silent run cli --api-url https://acme.togethercommunity.app --tenant acme --json tenant settings
pnpm --silent run cli --api-url https://acme.togethercommunity.app --tenant acme --json tenant-secret list
pnpm --silent run cli --api-url https://acme.togethercommunity.app --tenant acme --json public payment-config
```

Equivalent configuration reads include:

| Request | Successful `data` |
| --- | --- |
| `GET /api/tenant/settings` with a staff bearer session | `settings` and `personalisationMaxBytes` |
| Anonymous `GET /api/public/payment-config` | `stripeConfigured`, test/simulation capability flags, public `shippingRates`, optional analytics configuration and Geowidget fields |
| Anonymous `GET /api/public/offer` | `tenant`, `contentVersion`, `products`, `salesLinks`, `previewLessons`, `shippingRates`, `inpostGeowidgetToken` |

For a live paid checkout, `stripeConfigured` checks for the workspace's live
restricted key **and** webhook signing secret, including a key-mode conflict
check. A creator checklist flag or a stored key alone is not a live-payment
certification. Leave an already configured provider alone. Creating or replacing
provider configuration is a real external operation: obtain separate operational
approval and verify the provider-side result before opening sales. A platform
session cannot invent provider credentials. Hosted image upload requires storage
configuration; an already hosted cover URL does not.

## 3. Set seller, legal, VAT and delivery data

Owner-session `POST /api/tenant/settings` updates only supplied fields and returns
`{ "ok": true, "data": { "settings": ... } }`. Read the existing settings first.
The following JSON body is a schema example, not tax or legal advice:

```http
POST /api/tenant/settings
Authorization: Bearer <owner-session-token>
Content-Type: application/json

{
  "invoiceSellerName": "Acme",
  "invoiceSellerAddress": "Example Street 1, 00-001 Warsaw, Poland",
  "invoiceVatMode": "rate",
  "invoiceVatRatePercent": 23,
  "supportEmail": "support@togethercommunity.app",
  "supportUrl": "https://acme.togethercommunity.app/support",
  "termsUrl": "https://acme.togethercommunity.app/legal/terms",
  "privacyUrl": "https://acme.togethercommunity.app/legal/privacy",
  "shippingRates": [
    {
      "id": "courier",
      "label": "Courier",
      "amountCents": 1500,
      "vatRatePercent": 23,
      "carrier": "other",
      "pickupPoint": "none",
      "active": true
    }
  ]
}
```

Publish the real legal documents before using their URLs. Display the terms and
privacy links and obtain the buyer's actual acceptance before sending
`termsAccepted: true`. Never use the example's support address as a real seller
contact. Settings also support branding fields such as `name`, `defaultLanguage`,
`logoUrl`, `logoDarkUrl`, `faviconUrl`, `accentColor` and `checkoutAppearance`.

Choose the legally appropriate VAT separately for the seller and each product;
not every printed product has the same treatment. Product `vatRate` supports
`5`, `8`, `23` or `"exempt"`; exemption needs a legal basis. The seller exemption
settings are `invoiceVatMode`, `invoiceExemptionBasisKind` and
`invoiceExemptionBasis`. Do not switch an existing seller to the numeric example
merely to make an integration run.

Shipping supports Poland and at most five uniquely identified rates. A rate uses
`amountCents`, `vatRatePercent`, `carrier` (`other` or `inpost`), `pickupPoint`
(`none` or `inpost_locker`) and `active`. Only active rates are public; the public
projection omits `vatRatePercent`. `deliveryEstimateDays: { "min": 2, "max": 4 }`
is optional. `carrier: other` with `pickupPoint: none` supports manual shipping
without ShipX credentials. An InPost locker rate requires a selected locker code;
a typed code works without the optional map. A pickup product needs no shipping
selection: publish practical pickup instructions in the product or storefront.

The CLI `tenant settings-set --shipping-rates '<json-array>'` can update rates;
use HTTP for the complete seller/legal/branding settings. Supplying
`shippingRates` replaces that array, so preserve rates you want to keep. Clearable
URL/contact fields accept `null` or an empty string; do not assume every field
has the same clearing behavior.

`checkoutReturnOrigins` lists the origins of the shop's own site to which a
checkout may send the buyer back (section 6, "Return and cancel addresses").
It holds at most five entries; each is an exact `https://host` or
`https://host:port` origin with no path, query, fragment, user name, password
or wildcard (a single trailing `/` is accepted and removed). The host is stored
in lower case and the default port `443` is dropped; the same origin twice, an
`http:` entry or any other form is a `validation` error (400). IP literals are
accepted, as for the sales-link cancel return address. Supplying the field
replaces the whole list; `[]` removes every origin. The CLI form is
`tenant settings-set --checkout-return-origins 'https://shop.example.test,https://www.shop.example.test'`,
and an empty string clears the list. Studio shows it under Settings → Shipping,
"Return to your shop".

## 4. Create a draft physical product and its cover

Use a staff bearer session. All JSON examples below are relative to the workspace
origin, use `Content-Type: application/json`, and return the application envelope.
Identifiers in angle brackets must be replaced by values returned by the API.

```http
POST /api/products
Authorization: Bearer <staff-session-token>
Content-Type: application/json

{
  "type": "physical",
  "slug": "paperback",
  "title": "Paperback",
  "description": "Printed book. Dispatch details are shown before checkout.",
  "priceCents": 4900,
  "currency": "PLN",
  "vatRate": 5,
  "deliveryMethod": "shipping",
  "parcelTemplate": "small",
  "coverUrl": "https://acme.togethercommunity.app/cover.png",
  "compliance": {
    "manufacturerName": "Acme",
    "manufacturerAddress": "Example Street 1, 00-001 Warsaw, Poland",
    "manufacturerEmail": "support@togethercommunity.app",
    "modelIdentifier": "paperback",
    "safetyWarnings": ""
  }
}
```

Use an actual accessible image URL and applicable manufacturer/safety data, not
the placeholders. `5` is only an example VAT value. Choose `deliveryMethod:
"pickup"` instead for local collection. Physical products cannot grant digital
`accessItems`. Separate variants can be separate products with `variantGroup`
and `variantLabel`. Creation returns `data.product`; save `data.product.id`.
New products have `published: false`.

The CLI equivalent starts with `product create --type physical --title Paperback
--slug paperback --price-cents 4900 --currency PLN --vat-rate 5
--delivery-method shipping --parcel-template small --cover-url '<https-url>'`;
`--compliance '<json-object>'` accepts the safety fields above.

### Optional platform-hosted cover upload

There is one cover, not a gallery. The protected backend can upload it without
the UI:

1. `POST /api/image-assets/product-cover/upload` with this body:

   ```json
   { "kind": "product-cover", "fileName": "cover.png", "contentType": "image/png", "sizeBytes": 1234 }
   ```

   `sizeBytes` must describe the actual file. Supported product-cover types are
   PNG, JPEG, WebP and SVG, up to 5 MiB. Success is an envelope whose `data` has
   `key`, `servePath` and `upload: { url, headers, expiresAt }`.
2. `PUT` the actual image bytes, not JSON or multipart form data, to
   `data.upload.url` using `data.upload.headers`. Do **not** send the platform's
   bearer token to storage. The signed URL is short-lived and grants upload
   authority: keep it out of logs and use it before `expiresAt`.
3. `POST /api/image-assets/product-cover/complete` with
   `{ "key": "<returned-key>" }`, using the staff bearer session again.
   Completion checks the tenant-bound candidate, stored size and file format;
   a filename alone does not make bytes a valid image. Success returns
   `data.url`, a root-relative platform asset path.
4. Attach the completed asset with `POST /api/products/update` and
   `{ "id": "<product-id>", "coverUrl": "<returned-url>" }`. The response has
   `data.product`. Completion by itself does not attach the cover.

Resolve a root-relative cover against the **workspace origin**, for example
`new URL(product.coverUrl, workspaceOrigin).href`, before rendering it on a
separate website. Public asset GETs redirect to storage; the JSON API's CORS
policy does not promise cross-origin JavaScript byte access to those images.

## 5. Add an active one-time price, stock and publication

The base product `priceCents` does not create the active price needed to publish.
Create that price explicitly:

```http
POST /api/products/prices
Authorization: Bearer <staff-session-token>
Content-Type: application/json

{ "productId": "<product-id>", "kind": "one_time", "amountCents": 4900, "currency": "PLN" }
```

Success returns `data.price`, including `id` and `active: true`. Save that price
ID for JSON checkout. Physical recurring prices are rejected. CLI:
`price add --product '<product-id>' --kind one_time --price-cents 4900 --currency PLN`.

| Request | JSON body | Successful `data` |
| --- | --- | --- |
| `POST /api/products/stock/enable` | `{ "productId": "<product-id>", "onHand": 20 }` | `{ stock }` |
| `GET /api/products/<product-id>/stock` | No body | `{ stock }`; untracked stock can be `null` |
| `POST /api/products/publish` | `{ "id": "<product-id>" }` | `{ product }` with `published: true` |

Stock tracking is optional; enable it deliberately for finite inventory before
publishing. Stock writes use `productId`, whereas product publication/update uses
`id`. Do not substitute one for the other.

Checkout atomically reserves available tracked stock. On-hand stock is deducted
when paid checkout is fulfilled, **not** when staff marks a shipment. A cancelled
or abandoned browser flow does not immediately release the hold; the expiry
sweep releases expired reservations. Verify the sweep runs on the deployment.
A late payment for goods that are gone is recorded as a paid order with
`cancelReason: "out_of_stock"`, is never fulfilled and is queued for a full
refund. Skip such orders when you ship, and do not promise that a paid order is
always delivered.

The whole order is cancelled when any tracked line no longer fits at payment,
even if other lines are still available; nothing is taken from stock. Together
then refunds the full amount automatically through Stripe, once per order, and
sends the buyer one "sold out, refund" e-mail (English or Polish) in the
member's saved language, otherwise the checkout language, otherwise the
workspace default language. The e-mail says the order was cancelled because the
goods sold out before the payment completed, that the full refund was started
and how long it usually takes: a card refund made soon after the payment often shows as a
reversal, otherwise as a credit after about 5-10 business days; a BLIK refund
takes about 120 minutes; a Przelewy24 refund arrives as a separate transfer
within 3 business days. The public session-status route reports such an order
as `cancelled` (section 6), the hosted success page shows a sold-out message
instead of the purchase confirmation and no purchase analytics event is sent.
Studio marks the order "Cancelled: sold out" in the order list and on the order
page, together with the state of its automatic refund.

The automatic refund needs the Charges and Refunds (write) permission
(`charge_write`) on the workspace's Stripe restricted key, in each mode you use.
Without it staff get an alert e-mail and the refund is attempted again every
hour for 72 hours, so adding the permission lets the next attempt pay it; after
72 hours the refund has to be made by hand in the Stripe Dashboard.

## 6. Connect an anonymous storefront from another origin

Use the workspace origin and `credentials: 'omit'`. These public JSON routes
allow open CORS without credentialed requests:

| Route | Cross-origin method | Purpose |
| --- | --- | --- |
| `/api/public/offer` or `?productRef=paperback` | `GET`, `OPTIONS` | Listed catalog, or one published product by ID/slug |
| `/api/public/payment-config` | `GET`, `OPTIONS` | Public checkout capability and active rates |
| `/api/public/sales-links/<slug>` | `GET`, `OPTIONS` | Active fixed bundle, VAT lines, total and public workspace context |
| `/api/public/checkout/coupon` | `POST`, `OPTIONS` | Server-side coupon validation |
| `/api/public/checkout/session` | `POST`, `OPTIONS` | Create the checkout handoff |
| `/api/public/checkout/session-status?session_id=<stripe-session-id>` | `GET`, `OPTIONS` | `pending`, `paid` or `cancelled` status, not buyer/address details |

The allowed request headers are `x-tenant, content-type, if-none-match`, not
Authorization or API-key headers. Never widen authenticated-origin rules or send
a staff token to the storefront. The separate
`POST /api/public/sales-links/<slug>/checkout` direct-checkout route is **not**
opened cross-origin by the sales-link read CORS registration.

Every offer product carries its public stock and the quantity a buyer can order:

| Field | Meaning |
| --- | --- |
| `stock.tracked` | Stock tracking is enabled for the product |
| `stock.available` | Pieces a buyer can take now (on hand minus pieces held by open checkouts); `null` when not tracked |
| `stock.soldOut` | A tracked product with no available piece |
| `stock.low` | A low-stock threshold is set and availability reached it |
| `maxQuantity` | The largest quantity one checkout line accepts now: `0` when sold out, otherwise 10 for a physical product and 1 for any other type, capped by `stock.available`; a membership's 1 is its single-product checkout, never a cart line |
| `variants[].available` | The same count for each variant, next to its `soldOut` flag |

Use `maxQuantity` as the upper bound of a quantity picker and `stock.available`
for an "N left" line. The offer ETag changes whenever a count changes, so a
storefront that revalidates with `If-None-Match` never keeps a stale count, but
a count can still drop between reading the offer and starting checkout: the
session route then answers `sold_out` (409). The sales-link offer carries
`available` (whole sets left) and `lines[].maxQuantity` and buys one set per
checkout; see [Sales links: public offer](sales-links.md#public-offer).

For the smallest custom UI, read the public offer, render its cover and active
prices, then navigate the browser to the workspace's `/checkout/<product-id>`.
For a fixed sales-link bundle use `/offer/<slug>?checkout=together`. For a cart
of several products use `/checkout/cart/pay?lines=<product-id>.<quantity>~<product-id>.<quantity>`
(see the cart section below). The hosted
form already collects legal acceptance, applicable consent choices, billing and
shipping selections. Do not embed it in an iframe.

For a custom form on an external site, the following plain JavaScript runs in a
`<script type="module">` element without any package. Call the session request
only after the buyer accepted the displayed legal terms. This example selects
the configured manual `courier` rate; choose an active rate from the offer in a
real UI.

```js
const workspaceOrigin = 'https://acme.togethercommunity.app';

const readData = async (response) => {
  const body = await response.json();
  if (body.ok !== true) throw new Error(`${body.error.code}: ${body.error.message}`);
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return body.data;
};

const offer = await readData(await fetch(`${workspaceOrigin}/api/public/offer?productRef=paperback`, {
  credentials: 'omit',
}));
const product = offer.products.find((item) => item.slug === 'paperback');
const price = product?.prices.find((item) => item.kind === 'one_time');
if (!product || !price || product.stock.soldOut) throw new Error('Product is unavailable');
const coverUrl = product.coverUrl === null ? null : new URL(product.coverUrl, workspaceOrigin).href;
const session = await readData(await fetch(`${workspaceOrigin}/api/public/checkout/session`, {
  method: 'POST',
  credentials: 'omit',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    productId: product.id,
    priceId: price.id,
    termsAccepted: true,
    language: 'en',
    shipping: { rateId: 'courier' },
  }),
}));
window.location.assign(session.url);
```

Inside this repository only, the same flow can use the contract schemas at both
JSON boundaries. The `#core/contract/index.js` import resolves only within the
repository's own packages; an external site cannot import it, so use the plain
example above there.

```ts
import {
  checkoutSessionOutputSchema,
  checkoutSessionRequestSchema,
  envelopeSchema,
  publicOfferOutputSchema,
} from '#core/contract/index.js';

const workspaceOrigin = 'https://acme.togethercommunity.app';
const offerResponse = await fetch(`${workspaceOrigin}/api/public/offer?productRef=paperback`, {
  credentials: 'omit',
});
const offerJson: unknown = await offerResponse.json();
const offer = envelopeSchema(publicOfferOutputSchema).parse(offerJson);
if (!offer.ok) throw new Error(`${offer.error.code}: ${offer.error.message}`);
if (!offerResponse.ok) throw new Error('Offer request failed');
const product = offer.data.products.find((item) => item.slug === 'paperback');
const price = product?.prices.find((item) => item.kind === 'one_time');
if (!product || !price || product.stock.soldOut) throw new Error('Product is unavailable');
const coverUrl = product.coverUrl === null ? null : new URL(product.coverUrl, workspaceOrigin).href;
const input = checkoutSessionRequestSchema.parse({
  productId: product.id,
  priceId: price.id,
  termsAccepted: true,
  language: 'en',
  shipping: { rateId: 'courier' },
});
const sessionResponse = await fetch(`${workspaceOrigin}/api/public/checkout/session`, {
  method: 'POST',
  credentials: 'omit',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(input),
});
const sessionJson: unknown = await sessionResponse.json();
const session = envelopeSchema(checkoutSessionOutputSchema).parse(sessionJson);
if (!session.ok) throw new Error(`${session.error.code}: ${session.error.message}`);
if (!sessionResponse.ok) throw new Error('Checkout request failed');
window.location.assign(session.data.url);
```

`coverUrl` is ready for the storefront's image component. A pickup product omits
`shipping`. For a locker rate, add `shipping.pickupPoint` with `provider: "inpost"`
and the selected `code`; optional `name` and `address` are display metadata.
The payment provider collects the shipping address/phone; do not invent an
address field in this session request. Optional `email`, `billing`, `couponCode`
and `marketingConsentDefinitionIds` must follow `checkoutSessionRequestSchema`.
Display the returned consent wording and never preselect marketing consent.

Optional `clientReference` is the storefront's own reference for the checkout,
such as its cart or order number: 1–200 printable ASCII characters (space to
`~`), with surrounding spaces trimmed; any other value is a `validation` error
(400). The platform stores it with the checkout and copies it onto the paid
order, so it appears as `clientReference` in the order list, detail and verify
answers and the JSON export, in the `client_reference` CSV export column, and
in the session-status answer of a paid session. It is not sent to Stripe, it
need not be unique, and it must not carry personal data. A request without it
behaves as before, and its order has no `clientReference`.

Optional `personalizations` carries the buyer's request for a product that
offers a personalisation (`personalization` in the offer):
`[{ productId, text, conditionAccepted }]`, at most one entry per product. The
text is trimmed and must fit the product's `maxLength`, and a product with a
`condition` needs `conditionAccepted: true`; otherwise the request is a
`validation` error (400). Show the seller's `label`, `description`,
`inputLabel` and `condition` as plain text. A cart request refuses the field.
The order lines then carry `personalization`. See
[Personalisation](shop.md#personalisation).

For bundles the same session route takes `productId` equal to the bundle's first
base product and `salesLinkSlug` (or `salesLinkId`, not both), without `priceId`.
The server derives the product selection and amounts from the stored sales link.
It is not a free-form cart. Use the hosted bundle form when variant or consent
selection is needed rather than guessing a payload.

### Cart: several products and quantities

The same session route accepts a cart: several products, each with a quantity,
paid in one payment. A body that has a `lines` field is a cart request; any other
body is the single-product or sales-link request above, parsed exactly as before.
With the `readData` helper and `workspaceOrigin` of the example above, a custom
form sends:

```js
const catalog = await readData(await fetch(`${workspaceOrigin}/api/public/offer`, {
  credentials: 'omit',
}));
const paperback = catalog.products.find((item) => item.slug === 'paperback');
const bookmark = catalog.products.find((item) => item.slug === 'bookmark');
if (!paperback || !bookmark) throw new Error('Product is unavailable');
const cartSession = await readData(await fetch(`${workspaceOrigin}/api/public/checkout/session`, {
  method: 'POST',
  credentials: 'omit',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    lines: [
      { productId: paperback.id, quantity: 2 },
      { productId: bookmark.id, quantity: 1 },
    ],
    termsAccepted: true,
    language: 'en',
    shipping: { rateId: 'courier' },
  }),
}));
window.location.assign(cartSession.url);
```

Each line has `productId`, `quantity` and an optional `priceId` (an active
one-time price of that product; without it the product needs exactly one).
`email`, `language`, `termsAccepted`, `marketingConsentDefinitionIds`,
`couponCode`, `billing`, `shipping`, `attribution` and `clientReference` work
as in the single-product request. A cart request must not contain `productId`, `priceId`,
`salesLinkId`, `salesLinkSlug`, `variantSelections` or `personalizations`, and the cart schema is
strict: an unknown field in the body or in a line, such as a price or an amount,
is rejected, not ignored. The client sends product IDs and quantities only; the
server sets every price from the stored prices. Stripe shows one line item per
product with its unit price and quantity, and the buyer cannot change the
quantity there.

To check a coupon for a cart, send `{ "lines": [...], "couponCode": "SPRING" }`
(and the optional `email`) to `POST /api/public/checkout/coupon`. The discount
applies to the subtotal of the product lines without the delivery fee. A coupon
limited to some products is valid only when every product of the cart is in its
scope; otherwise the answer is the usual unavailable-coupon `validation` error.

The cart answers with the same error envelope as the other routes:

| Situation | `error.code` (HTTP) |
| --- | --- |
| a body or line that breaks the schema or the limits below, a duplicate product, a forbidden or unknown field | `validation` (400) |
| a line above the quantity allowed for its product (`"<title>" can be ordered in a quantity of at most <n>`) | `validation` (400) |
| a membership product, a product without exactly one active one-time price, a recurring `priceId`, products in different currencies, a product without a VAT rate | `validation` (400) |
| an unknown or unpublished product, a product sold only through sales links, an unknown or inactive `priceId` | `not_found` (404) |
| a tracked product with fewer available pieces than its line quantity | `sold_out` (409) |
| a shipped product without `shipping` | `shipping_required` (400) |

A custom cart form bounds each quantity picker by `maxQuantity` and shows the
remaining count from `stock.available`. Membership products cannot join a cart
(`validation`, 400); send the buyer to `/checkout/<product-id>` for them. With a
product read from the offer as above:

```js
const quantityPicker = (product) => {
  const picker = document.createElement('select');
  for (let quantity = 1; quantity <= product.maxQuantity; quantity += 1) {
    picker.append(new Option(String(quantity), String(quantity)));
  }
  picker.disabled = product.maxQuantity === 0;
  const stockLine = document.createElement('p');
  if (product.stock.soldOut) stockLine.textContent = 'Sold out';
  else if (product.stock.available !== null) stockLine.textContent = `${product.stock.available} left`;
  return { elements: [picker, stockLine], quantity: () => Number(picker.value) };
};
```

A storefront without its own form can send the buyer to the hosted cart page
instead: `/checkout/cart/pay?lines=<product-id>.2~<product-id>.1`, one
`<product-id>.<quantity>` pair per product, separated by `~`, within the same
limits. The page reads product IDs in lower case, as the platform issues them,
so an upper-case ID finds its product and two IDs that differ only in case are
a duplicate. The page lets the buyer change the quantities within the limits or
remove a line, and collects delivery, billing, consents and a coupon as the
single-product page does. Each line's limit is the lower of its type rule and the
offer's `maxQuantity`; when the stock is the lower one the line says how many
pieces are left, and a line whose limit is 1 shows no quantity picker. A
sold-out line asks to be removed before paying, as an unavailable one does. On a
`sold_out` refusal the page reloads the offers and names the product. One summary
above the pay button lists the products, the discount of an applied code, the
delivery and the total to pay. A malformed or empty `lines` parameter shows an error
and sends no request. The page picks each line's price by the session route's
rule, so a product with one one-time and one recurring price is sold at its
one-time price, while a membership or a product without exactly one active
one-time price has to be removed before paying. A cart whose products are
priced in different currencies shows the session route's refusal, no total and
no coupon field, and cannot be paid until the products in the other currency
are removed. The cart page has two path segments below `/checkout/`, so
`/checkout/<product-id>` and `/checkout/<slug>` keep opening the
single-product page for every product, including one whose slug is `cart`.

The CLI posts the same cart with `checkout session --line '<product-id>:2'
--line '<product-id>:1'`; repeat `--line` once per product and leave out
`--product`. Both forms take `--client-reference '<reference>'`.

### Return and cancel addresses

Both request forms, the single-product or sales-link request and the cart, take
two optional addresses on the shop's own site:

- `cancelUrl`: where Stripe sends the buyer who cancels the payment. Without it
  the cancel address stays the workspace page described in section 7.
- `returnUrl`: stored with the checkout for the "Back to shop" button on the
  workspace confirmation page (section 7). Payment success still returns to the
  workspace confirmation page; the success address sent to Stripe does not
  change.

Each address is accepted only when all of these hold; otherwise the answer is a
`validation` error (400) and nothing is stored or sent to Stripe:

- it is an absolute `https:` URL of at most 2000 characters;
- it has no user name or password part;
- its origin (scheme, host and port, as a URL parser normalizes them) is exactly
  one of the workspace's `checkoutReturnOrigins` (section 3). The same host on
  another port, a subdomain or an `http:` address is a different origin. A
  workspace without origins refuses every address.

A fragment (`#...`) is removed before the address is used or stored. The error
message names the field (`returnUrl` or `cancelUrl`) but never repeats the
refused address. A request without either field behaves exactly as before.

| Situation | `error.code` (HTTP) |
| --- | --- |
| not an absolute `https:` URL (`http:`, `javascript:`, `data:`, a relative path), longer than 2000 characters, or with a user name or password | `validation` (400), `details.fieldErrors.returnUrl` or `details.fieldErrors.cancelUrl` |
| an origin that is not in the workspace's `checkoutReturnOrigins` | `validation` (400) |

### Errors, caching and retry behavior

Application JSON responses are `{ "ok": true, "data": ... }` or
`{ "ok": false, "error": { "code": ..., "message": ..., "details": ... } }`;
`details` is optional. Treat transport/JSON/schema failures separately from an
application error. Never fulfil an order after a failed or unparsed response.
Useful error mappings are validation/shipping-required `400`, unauthorized
`401`, forbidden `403`, not-found `404`, sold-out/fulfilment-conflict `409`,
integration-not-configured `412`, rate-limited `429` and
integration-unavailable `503`. Use the actual underscore-separated `error.code`
from the contract, such as `sold_out` or `shipping_required`, in program logic.

Back off on `429`; respect `Retry-After` when readable and otherwise use bounded
backoff. Cross-origin CORS does not expose every response header to JavaScript.
Do not blindly retry session creation or shipping after a timeout: a write may
have completed. Re-read protected order state before repeating fulfilment.

The offer supports `If-None-Match` and a bodyless `304`. Consumers that cache it
must retain the prior parsed offer and handle `304` **before** calling `.json()`.
The browser examples send no conditional header and expect a JSON response.
The open-CORS registration does not expose `ETag` to cross-origin JavaScript;
do not assume a browser can discover it from `response.headers`.

## 7. Preserve the hosted payment return

Standard checkout returns to the workspace `/checkout/<product-id>`; a cart
returns to the hosted cart page `/checkout/cart/pay`; sales-link checkout
returns to `/offer/<slug>`. Success uses `status=success` and, for paid
Stripe sessions, `session_id`; cancellation uses `status=cancelled` (with
`checkout=together` for the standard sales-link flow, and with the cart's
`lines` for a cart, so the buyer can try the same cart again). Preserve the returned URL
and its other query parameters. A validated `cancelUrl` (section 6, "Return and
cancel addresses") replaces only the cancel address. There is no `successUrl`
field: success always returns to the workspace confirmation page.

The hosted success document remains the confirmation page and the place for the
platform's configured, consent-controlled purchase analytics. The separate
direct-sales-link flow has restricted external cancellation behavior, but
shipping, compliance or attached checkout consent requires workspace checkout;
it does not provide an external success return for shipped books. This guide
does not change which documents load vendor scripts.

A browser success URL is not proof of payment. The public session-status route
returns `data.status` (`pending`, `paid` or `cancelled`), for a paid session the
`clientReference` sent with it, and may include optional analytics fields with
`paid` only; use it for buyer display only. `cancelled` means the payment
arrived after the goods sold out: the order is cancelled and refunded
automatically (section 5), and the response carries no analytics, Meta
conversion data or shop return address. With `cancelled`, `data.charged` is
`false` when the order was paid with zero, so there is nothing to refund. Fulfil from the authenticated paid-order
ledger, not from a caller-supplied paid flag or a browser redirect.

### Back to shop

When the checkout carried a `returnUrl`, the session-status answer of that paid
session also holds `returnUrl` and `checkoutRef` (the checkout snapshot id). The
address is returned only for its own session and workspace, and only while its
origin is still one of the workspace's `checkoutReturnOrigins`: an origin
removed after the checkout hides the address. A pending session never returns
it.

The workspace confirmation page then shows a "Back to shop" button. There is no
automatic redirect: the buyer leaves by clicking it, as a full document
navigation. The button links to the stored `returnUrl` with these query
parameters appended after the address's own query:

| Parameter | Value |
| --- | --- |
| `checkout_ref` | the checkout snapshot id, the same as `checkoutRef` |
| `status` | `paid` |
| `client_reference` | the `clientReference` of the checkout, only when one was sent |

Parameters of the stored address with any of these three names are removed
first, so the platform's values are the only ones in the link. The address's
other parameters keep their order, but the whole query is written again in form
encoding: for example `%20` becomes `+`, and characters such as `~`, `'`, `/`
or `:` in a parameter become percent escapes. A parameter without `=` gains an
empty value (`a` becomes `a=`).

These parameters are a hint for display only: anyone can type them into the
address bar. The shop's backend confirms the payment by reading its paid orders
with a management key (section 8) and matching the order's `clientReference`,
and fulfils only from that answer. The order answers do not carry
`checkout_ref`, so send a `clientReference` when the shop needs to match the
return to its own cart.

### Free checkout

When nothing is to be paid (a free one-time price, or a coupon that removes the
whole price, in an order without delivery), there is no payment step and no
return trip. The request must carry `email`. The platform records the order
before it answers, so the answer to the session request itself says the
checkout is complete:

- `data.free` is `true` (a checkout that goes to payment answers `false`);
- `data.url` is the workspace confirmation page (`/checkout/<product-id>`,
  `/checkout/cart/pay` or `/offer/<slug>`) with `status=success`;
- with a coupon, `data.coupon` holds the price breakdown, `finalCents` being 0.

`checkoutSessionOutputSchema` declares `free` and `coupon` as optional fields,
so a typed client reads `session.data.free` after the parse.

The calling shop keeps control of the page, so it should not navigate to
`data.url`. It shows its own confirmation instead: the order is complete,
nothing was charged, and the buyer receives the access or download e-mail
(section 9). The order is already in the paid-order ledger with amount 0 and
the `clientReference` of the request, so the shop's backend confirms it the same
way as a paid order (section 8). A `returnUrl` sent with a free checkout is
stored but never offered: the workspace confirmation page of a free checkout has
no "Back to shop" button.

## 8. Poll live orders and record fulfilment

Always request live mode explicitly for operational automation:

```sh
pnpm --silent run cli --api-url https://acme.togethercommunity.app --tenant acme --json orders list --mode live --status paid --page 1 --page-size 100
```

The corresponding staff-session read is
`GET /api/orders?mode=live&status=paid&page=1&pageSize=100`. Success has
`data.orders`, `total`, `page`, `pageSize` and `sources`. `pageSize` is at most
100. The list also accepts `productId`, `kind`, `couponId`, `fulfilmentStatus`,
`search`, `source` and `sourceMatch` (`exact`). Omitted mode preserves the mixed
live/test list; `mode=test` selects test rows; an unknown or empty mode is a
validation error. Workspace authorization still applies independently of mode.

The list is newest-first offset pagination: new orders can shift page
boundaries, and older orders can change state. To follow every new order and
every later change, read the change feed below instead of rescanning the list.
Use `GET /api/orders/<order-id>` for protected detail (`data.order` and nullable
`data.invoice`). Protect buyer addresses and emails as personal data. This
integration uses polling; it does not rely on an outbound order-push contract.

### Follow order changes

`GET /api/orders/changes?after=<cursor>&limit=100&mode=live` returns the orders
of the workspace that were created or changed after the cursor, oldest change
first. It needs the same staff session and `order:read` permission as the order
list:

```json
{
  "ok": true,
  "data": {
    "changes": [{ "cursor": "<cursor>", "order": { "id": "<order-id>", "status": "paid", "fulfilmentStatus": "shipped" } }],
    "nextCursor": "<cursor>"
  }
}
```

Each `order` has the shape of an entry in `data.orders` of the order list, in
its state at the time of the read, not at the time of the change. An order
changed several times within one page appears once, at its latest cursor.
Payment, refunds, collection, shipping and issuing or changing the invoice all
produce a change, and so does every change of `refundJobStatus` on an order
cancelled out of stock (`cancelReason: "out_of_stock"`). The member name and e-mail address, the product title and the
sales link title (`memberName`, `memberEmail`, `productTitle`,
`salesLinkTitle`) are read at fetch time, and editing them produces no entry.
`limit` is 1–200 (default 100). `mode` behaves as in the list: `live` or `test`
selects one mode, and an omitted mode returns both. A malformed cursor or limit
is a validation error (HTTP 400).

A shop backend follows the feed like this:

1. Start without `after` to read from the oldest change. Orders last written
   before the change log was introduced appear only after their next change,
   so read those once from the order list.
2. Process every entry of `changes` (for example, update the order in the shop's
   database by `order.id`).
3. Store `nextCursor` only after the processing is saved, then request the next
   page with `after=<nextCursor>`.
4. When `changes` is empty, `nextCursor` stays the cursor that was sent (or is
   `null` before the first change); wait a minute and ask again.

The feed delivers each change at least once: a backend that stops between
processing and storing the cursor receives the same entries again, so the
processing must be idempotent by `order.id`. The cursor is opaque: store and
send it unchanged, and do not compare, sort or build cursors. A change becomes
visible only after every earlier database transaction has finished, so it can
appear a little later than the write that caused it, but it never lands behind
a cursor that was already returned.

After a move or restore of its database the platform rotates the feed epoch,
and a cursor issued before that is answered with HTTP 409:

```json
{
  "ok": false,
  "error": {
    "code": "feed_cursor_reset",
    "message": "Order change feed reset: resync from the order list, then start from the cursor in this answer",
    "details": { "cursor": "<cursor>" }
  }
}
```

The client resyncs once: read the order list, update the shop's database from
it, then store `error.details.cursor` and continue the feed from it. Changes
made while the order list was read appear again in the feed, which the
idempotent processing absorbs.

CLI: `orders changes --mode live --after '<cursor>'` prints one line per change
(cursor, order ID, status, fulfilment status, client reference) and the next
cursor; `--json` prints the envelope above. `orders changes --mode live --after
'<cursor>' --follow` keeps polling every `--interval` seconds (default 10)
while nothing changes, prints each change once and stops cleanly on Ctrl+C; with
`--json` it prints one single-line envelope per page that has changes. A poll
that fails with a network error, or that the server answers with an error of
HTTP 5xx or rate limiting (HTTP 429), is repeated from the same cursor after a pause that starts at
`--interval` and doubles after each further failure up to 60 seconds (or
`--interval` when that is longer), with one line per failure on stderr; the
first successful poll resets the pause. Any other answer, including one that is
not JSON or does not match the contract, stops the command with its message and
the taxonomy exit code, for example `unauthorized` (3), `forbidden` (4),
`validation` (2) and `internal` (10). On `feed_cursor_reset` the command prints
the cursor to continue from after the resync and exits with code 30 instead of
polling again.

For shipping, select live, paid orders whose `fulfilmentStatus` is `to_pack`.
Packing-list/export tools are also available, but they are not proof of carrier
purchase. Arrange the physical shipment manually, then record its actual
tracking number:

```http
POST /api/orders/<order-id>/ship
Authorization: Bearer <staff-session-token>
Content-Type: application/json

{ "carrier": "other", "trackingNumber": "TRACK1234" }
```

The path supplies the order ID. Success returns `data.order` with the stored
shipment and `fulfilmentStatus: "shipped"`. Tracking numbers are 4–64 characters.
The manual path does not require ShipX and queues tracking mail for a live order;
`other` has no generated carrier tracking URL. Repeating a completed shipment
returns `fulfilment_conflict`. CLI: `orders ship '<order-id>' --carrier other
--tracking TRACK1234`.

For pickup, staff can `GET /api/orders/verify/<order-number-or-opaque-token>`
(`data.order`) or run `orders verify '<reference>'`. Check the live mode, payment,
items and prior issue state, then record each physical line's handover with
`POST /api/orders/<order-id>/lines/<product-id>/issue`, returning `data.order`.
The request needs no body; an empty body issues one unit, and an optional JSON
body `{ "count": 2 }` hands over several units of a line at once. A non-empty body
must be an `application/json` object whose `count`, when present, is a positive
integer (the path identifiers win over `orderId` and `productId` in the body);
invalid or whitespace-only JSON, `null`, arrays, other values or other fields
return `validation` (HTTP 400) and issue nothing. Each order line in
`data.order.lines` carries `quantity` (1 for lines stored without one) and
`issuedCount`; a request that would issue more than the units left returns
`conflict`. CLI:
`orders issue '<order-id>' '<product-id>' [--count 2]`. Record handover
only when the goods actually change hands; neither verification nor the buyer's
QR image alone records collection.

Configured ShipX operations are a separate option. A workspace keeps two ShipX
connections, `production` for live orders and `sandbox` for test-mode orders;
the order's mode picks the connection, and an order whose connection is not
saved answers `integration_not_configured` naming it (see
[InPost ShipX](shop.md#inpost-shipx)). Creating/paying a real ShipX shipment for
a live order is an external financial action requiring operational approval; a
token or a test fixture is not that approval. Manual fulfilment needs no such
purchase.

## 9. What the buyer receives

A physical purchase still ensures a global account and workspace membership;
it is not guest-only ordering. It does not grant digital access items merely
because an account exists. The live purchase flow queues welcome/sign-in mail.
Where an order verification token is present, the purchase mail includes the
order number, verification link/QR, item amounts and delivery details. Shipping
queues a separate tracking message. Mail being queued is not evidence it reached
the buyer: verify delivery on the configured deployment before opening sales.

Automatic invoices depend on `autoIssueInvoices`, the selected provider and its
credentials, seller/VAT data and scope. The default automatic scope is
`b2b_only`, which skips orders without a billing NIP. A purchase confirmation is
not a tax invoice, and this guide does not promise automatic invoice attachments
or certify a live provider/KSeF submission.

## Limits

- **Cart size.** A cart has 1–20 lines, one line per product, and at most 200
  units in total.
- **Quantity per line.** A physical product allows a whole quantity of 1–99 per
  line, but at most 10 while checkout holds stock for an unpaid session (the
  current behavior). Download, course and other non-physical products allow
  quantity 1 only; membership products cannot be in a cart. The single-product
  and sales-link requests buy one unit of each product.
- **One delivery fee per order.** The fee of the chosen delivery option is
  charged once, whatever the number of products and units.
- **Coupon scope.** A coupon limited to some products applies only when every
  product of the cart is in its scope.
- **Server-side prices.** The server sets every price; a request cannot override
  a price or an amount.
- **Fixed bundles stay sales links.** A sales link keeps its stored products and
  one unit of each; use a cart request for a buyer-chosen selection.
- **Products sold only through sales links.** A product with the sales channel
  `sales_links_only` answers every standalone request exactly as an unknown
  product: `?productRef=` returns an empty `products` list, and the session,
  cart and coupon requests without a sales link return `not_found` (404). It is
  never in the listed catalogue. Sell it through its sales link (`salesLinkSlug`
  or `salesLinkId`, `/offer/<slug>`); see
  [Sales links](sales-links.md#products-sold-only-through-sales-links).
- **One cover.** The product exposes `coverUrl`, not a product gallery.
- **Delivery in Poland.** Shipping is limited to `PL`, with at most five rates.
  Pickup instructions remain seller/storefront content.
- **Hosted confirmation.** Payment success returns to the workspace confirmation
  document, not an arbitrary storefront URL. Only the cancel address may point at
  the shop, and only on an origin in `checkoutReturnOrigins` (at most five).
- **Buyer account.** Physical checkout creates or reuses an account/member; it is
  not a guest-only flow.
- **Polling instead of push.** Plan this integration around protected order
  reads and the order change feed, not a promised general outbound order
  webhook.
- **Shared seller invoice numbering.** KSeF allocation is workspace/year scoped,
  while the printed number is `FV/<year>/<six-digit-sequence>` without a workspace
  prefix. Several workspaces using one legal seller can therefore allocate the
  same printed number. Keep automatic multi-workspace issuance disabled until a
  legally reviewed unique seller series/counter is designed; sharing credentials
  is not centralized invoicing.

## Contract and implementation references

Request/response shapes and paths are defined in
[`core/contract/routes.ts`](../core/contract/routes.ts),
[`sales-links.ts`](../core/contract/sales-links.ts),
[`order-fulfilment.ts`](../core/contract/order-fulfilment.ts),
[`order-changes.ts`](../core/contract/order-changes.ts) and
[`order-verification.ts`](../core/contract/order-verification.ts).
The executable client boundary is [`core/client/http.ts`](../core/client/http.ts).
The corresponding session handlers are in
[`internal-app.ts`](../apps/server/src/internal-app.ts) and
[`order-change-routes.ts`](../apps/server/src/order-change-routes.ts), public
handlers and CORS in [`public-app.ts`](../apps/server/src/public-app.ts), and CLI
flags in [`main.ts`](../apps/cli/src/main.ts) and
[`order-change-commands.ts`](../apps/cli/src/order-change-commands.ts). Follow those schemas instead of guessing
uniform body IDs or undocumented checkout fields.

## Several workspaces of one company

Treat each shop as an independent workspace, even when the legal seller and
Stripe account are the same. The same verified global account may own several
workspaces, but each needs its own owner grant, configuration and operational
records. This setup does not introduce a company entity, shared permissions or
live inheritance of settings.

### Create the further workspace through the trusted operator route

Production uses first-workspace bootstrap policy: once a workspace exists,
ordinary session `POST /api/tenants` cannot create the next one, even when
`TENANT_CREATION=open`. Do not change that policy or give a merchant an operator
credential to work around it.

An instance operator can provision a further workspace from a protected backend
using the existing route below. The owner must already have a verified global
account; provisioning does not create or verify that account. The example uses
fixture values and a placeholder secret, not production credentials:

```http
POST /api/internal/tenants/provision
x-scheduler-operator-secret: <instance-operator-secret>
Content-Type: application/json

{
  "slug": "studio",
  "name": "Studio",
  "ownerEmail": "owner@togethercommunity.app",
  "defaultLanguage": "en"
}
```

Send this to the intended instance origin using a protected HTTP client's secret
facility. Never put the operator secret in a browser, shop manifest, URL, saved
command arguments or logs. This route uses the instance operator secret, not an
owner session or a shop management key.

Success returns the normal envelope with `data.tenant` (`id`, `slug`, `name`),
`created`, `ownerUserId` and `readiness`. Save the returned workspace ID. Retrying
the same normalized slug for the same verified owner returns the existing
workspace with `created: false`, without changing its name/language, duplicating
the owner grant or recording another provisioning audit event. A slug owned by
someone else is a conflict; an unknown or unverified owner is refused.
`GET /api/internal/tenants/studio/readiness`, authenticated with the same header,
returns configuration facts, not credentials or proof of a real payment.

After provisioning, use the owner's session against the new workspace origin
and verify its workspace identity before applying settings. The protected operator
route is for workspace creation/readiness; normal shop administration continues
through the workspace's existing owner/staff interfaces.

### Register independent Stripe endpoints and slots

With separate operational approval for provider changes, run owner-session
`POST /api/integrations/stripe/configure` separately in each workspace. Its body
is `{ "restrictedKey": "<live-restricted-key>", "mode": "live" }`; use a
matching test restricted key and `"mode": "test"` for the sandbox slot. A company
may supply credentials for the same Stripe account to several workspaces from
its protected backend, but must not copy another workspace's webhook setup.

Configuration registers that workspace's endpoint and stores its returned
endpoint ID and signing secret with its restricted key. The live endpoint is
`https://studio.togethercommunity.app/api/webhooks/stripe/<workspace-id>`; the test
endpoint appends `?mode=test`. Each workspace and each live/test slot needs its
own endpoint and signing secret, even with one Stripe account. Reconfiguring a
slot replaces that workspace's matching endpoint, not another workspace's
endpoint or the other slot. The configuration response contains `mode` and
`webhookUrl`, not the signing secret. Check provider endpoint capacity and the
restricted key's required permissions as external preflight items; source tests
are not a guarantee that a particular Stripe account can accept another endpoint.

A correctly signed event for one workspace is ignored by the other workspace's
endpoint when its ownership does not match. A signature made with the first
endpoint's secret is not valid for the second endpoint. Duplicate local delivery
does not create another paid order. Do not bypass ownership validation or route
all events through a shared signing secret to make setup appear simpler.

### Keep workspace-owned data separate

Never copy these between workspaces:

- Webhook URLs, endpoint IDs or signing secrets, including across live/test slots.
- Stripe Customer or Subscription objects/IDs. Sharing a Stripe account does not
  authorize sharing those objects. The same buyer email or global user account
  does not override workspace ownership; use workspace-local payment objects.
- Orders, payment-event ledgers, stock/reservations, grants, memberships or role
  rows. Provision the owner grant through the trusted route rather than cloning
  it, and configure any additional staff access deliberately.
- Invoice/order numbering counters or number allocations. Copying a counter is
  not a safe way to coordinate a seller's numbering.

Seller/legal/delivery values may be applied deliberately as independent settings
copies. For a reviewed declarative settings/catalogue plan and application flow,
use the [shop manifest tool](shop-manifest.md). It can also provision missing
workspaces through the operator route (see
[Missing workspaces and operator provisioning](shop-manifest.md#missing-workspaces-and-operator-provisioning))
and configure integrations from environment references with
`shop apply --integrations` (see
[Explicit integration configuration](shop-manifest.md#explicit-integration-configuration)).
Its company settings are copied into each workspace on apply; they do not
become server-side inheritance.

**Invoice numbering requires a separate decision.** KSeF sequences are scoped to
the workspace, invoice type and year, but the printed number is
`FV/<year>/<six-digit-sequence>` without a workspace prefix. Two workspaces for
one legal seller can therefore allocate the same printed number. Keep automatic
multi-workspace issuance disabled until a legally reviewed unique seller
series/counter is implemented. Sharing invoice credentials, copying counters or
using one Stripe account does not solve that collision.
