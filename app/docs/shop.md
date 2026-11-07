# Shop: shipped physical products and stock

A physical product is either collected in person or shipped by parcel. This
page covers shipping: delivery methods, delivery options (rates), the parcel
locker flow, what an order stores, fulfilment (packing and marking orders as
shipped), product safety information, product variants, the content security
policy for the parcel locker map, and the CLI. The last section covers stock
tracking with checkout reservations.

## Delivery methods

Every product has `deliveryMethod`: `pickup` (the default) or `shipping`.
Only `physical` products may use `shipping`; creating or updating any other
product type with `shipping` returns a validation error. Products created before
delivery methods existed are `pickup` and keep the in-person collection flow
described in [Sales links](sales-links.md#product-vat-and-physical-items).

Studio shows a **Delivery** select on the product create page and in the
product editor for physical products only. The public offer and the public
payment configuration expose `deliveryMethod` on each product.

## Delivery options

Delivery options are workspace settings, not code. **Studio → Settings →
Shipping** edits up to five options (the Stripe limit for shipping options on
one Checkout Session) and the InPost parcel locker map token.

| Field | Values |
|---|---|
| `id` | 1–40 lowercase letters, digits or hyphens; unique in the workspace |
| `label` | 1–100 characters; shown to buyers, in Stripe Checkout, on the order and on the invoice |
| `amountCents` | gross fee in the checkout currency, an integer of at least 0 |
| `vatRatePercent` | 5, 8 or 23; defaults to 23 |
| `carrier` | `inpost` or `other` |
| `pickupPoint` | `none` (delivery to an address) or `inpost_locker` |
| `active` | inactive options stay configured but are not offered |
| `deliveryEstimateDays` | optional `{ min, max }` business days, both positive |

Options carry no currency: the fee is charged in the checkout currency. The
allowed shipping countries are the constant `SHIPPING_ALLOWED_COUNTRIES`
(`['PL']`) in `core/domain/shipping.ts`; they are not configurable yet.

The InPost Geowidget token is a public token issued for the browser map. It is
stored as a plain workspace setting, not as a secret, and is returned by the
public offer and payment configuration responses together with the active
options (`id`, `label`, `amountCents`, `carrier`, `pickupPoint`,
`deliveryEstimateDays`). The VAT rate and inactive options are not public.

## Checkout

A selection that contains a shipped product cannot use the automatic
`/offer/<slug>` handoff to Stripe, because the buyer chooses the delivery option
on the Together checkout page first. The handoff applies the same rule as
products with purchase consent checkboxes: it keeps the Together page at
`?checkout=together`, and `POST /api/public/sales-links/<slug>/checkout` refuses
the link.

The checkout page renders a **Delivery** step above the pay button with the
active options and their prices. For a parcel locker option it shows a
**Parcel locker code** input (upper-cased, 4–12 letters or digits) and the
InPost map under the rule in
[Content security policy for the parcel locker map](#content-security-policy-for-the-parcel-locker-map).
Choosing a locker on the map fills the code and shows the locker name and
address. The pay button stays disabled until an option, and a valid code when
the option needs one, is chosen.
The locker name and address stored on the order are as entered by the buyer;
only the code is validated, and staff pack by the code. When the buyer reaches
the checkout page through an in-app navigation from another page, the document
keeps that page's content security policy, the map does not load, and the code
input remains the way to choose a locker.

The checkout request carries
`shipping: { rateId, pickupPoint?: { provider: 'inpost', code, name?, address? } }`.
The server validates it again:

| Situation | Result |
|---|---|
| a selected product ships and `shipping` is missing | `shipping_required` (HTTP 400, CLI exit 25) |
| no selected product ships and `shipping` is present | `validation` |
| unknown or inactive option | `validation` |
| locker option without a locker, or address option with one | `validation` |
| locker code not matching `^[A-Z0-9]{4,12}$` after trimming and upper-casing | `validation` |
| order total, shipping fee included, is zero (a free or fully discounted product with a zero-fee option) | `validation` with the message `Delivery is not available for free orders`, returned before any checkout snapshot or coupon session is written; the checkout page shows it as a localized message |

The zero-total rule exists because a free order never reaches Stripe, so
nothing would collect the delivery address. A fully discounted product with a
paid delivery option is a normal Stripe checkout for the fee alone: Stripe
collects the address, and the webhook claims the coupon redemption. When the
coupon's redemption limit is reached before that claim, the buyer has already
paid the delivery fee on Stripe, but the webhook refuses the order and records
nothing; staff must refund the fee manually in Stripe. A follow-up may record
such orders instead.

Stripe Checkout receives the product lines as line items and the fee as exactly
one shipping option (`shipping_rate_data` with a fixed amount, the option label
as `display_name`, `tax_behavior: 'inclusive'` and the optional business-day
estimate), plus `shipping_address_collection` limited to the allowed countries
and `phone_number_collection`. See [Payments](payments.md#shipping-in-stripe-checkout).

## Order data

The checkout snapshot appends a shipping line after the product lines:
`productType: 'shipping'`, `productId: 'shipping:<rateId>'`, the option label as
its name, gross, net and VAT split at the option's VAT rate and
`issuedCount: null`. `checkout_snapshots.shipping` freezes the option
(`rateId`, `label`, `amountCents`, `vatRatePercent`, `carrier`, `pickupPoint`)
and the allowed countries at checkout start, so later edits to the option do not
change an order in flight.

When Stripe reports the completed session, the webhook requires the collected
shipping cost to equal the shipping line and a delivery address in an allowed
country; otherwise the event is rejected as a validation failure. The total check
compares `amount_total + amount_discount` with the sum of all snapshot lines,
shipping included. The paid order stores:

- `orders.lines` with the shipping line last;
- `orders.shipping`: the frozen option, the pickup point or `null`, the
  delivery address (`name`, `line1`, `line2`, `postalCode`, `city`, `country`)
  and the phone number collected by Stripe;
- `orders.fulfilment_status = 'to_pack'`. Orders without shipping keep `null`.

Every consumer that grants or revokes access, issues physical lines, lists My
products or enrols products skips the shipping line. Coupons discount product
lines only, as in Stripe, so the paid total minus the shipping fee is spread
over the product lines with the cumulative rounding used before, while the
shipping line keeps its face value (`allocatePaidOrderLineGross` in
`core/domain/commerce.ts`). Invoices, purchase confirmation amounts and the
uninvoiced consumer sales summary use that allocation. The shipping line becomes
an invoice position named after the option with its own VAT rate.

The purchase confirmation e-mail lists the shipping line in its table and adds
a **Delivery** paragraph with the option label and either the locker code, name
and address or the postal address. The checkout success page shows no delivery
details because the session status endpoint returns no order data to buyers.

Staff test purchases store the same snapshot and the pending test order
receives the shipping data when the test session completes. Simulated
purchases accept the same `shipping` input and use a fixed Polish address and
phone number in place of the data Stripe would collect.

Member erasure replaces the delivery name and street lines with the deleted
member label and clears the phone number; the option, amounts, locker, postal
code, city and country stay with the order. The delivery address in queued and
sent purchase confirmation e-mails is pseudonymised the same way. See
[Member erasure](member-erasure.md).

My products shows a shipped physical purchase as "Will be shipped to" the
locker code or, for address delivery, the city, until the order is shipped;
purchases collected in person keep "Collected in person". The fulfilment state
is shown below that line, see [Fulfilment](#fulfilment).

## Studio

The order detail page shows a **Delivery** card (option, price, locker,
address, phone) and a fulfilment chip (**To pack** or **Shipped**). The orders
list has a **Fulfilment** filter (all orders, `to_pack` or `shipped`, sent as
`fulfilmentStatus`) and a **Fulfilment** column with the same chips. CSV and
JSON exports add the columns `shipping_rate`, `shipping_point`, `shipping_name`,
`shipping_phone`, `shipping_address`, `shipping_postal_code`, `shipping_city`,
`shipping_country` and `fulfilment_status`.

## Fulfilment

`orders.fulfilment_status` is `null` for orders with nothing to ship, `to_pack`
for paid orders with shipping (set when the payment completes) and `shipped`
once staff mark the order as shipped. The only transition is `to_pack` →
`shipped`:

| Situation | Result |
|---|---|
| paid, refunded or partially refunded order that is `to_pack` | shipped; refunded orders can still be shipped because the goods may already be on the way |
| pending or failed order | `validation` |
| order with nothing to ship (`null`) | `validation` |
| order that is already `shipped` | `fulfilment_conflict` (HTTP 409, CLI exit 27) |

Marking an order as shipped needs `order:write`, the same capability as
recording an in-person collection. `POST /api/orders/<orderId>/ship` takes
`{ carrier: 'inpost' | 'other', trackingNumber }`; the tracking number is
trimmed and must have 4 to 64 characters. In one transaction the order row is
locked, the status is checked again, `orders.shipment` receives
`{ carrier, trackingNumber, shippedAt, shippedBy }`, an immutable
`order_fulfilment_events` row (`type = 'shipped'`, the carrier and tracking
number as payload, the staff user and the time) is appended and the buyer
e-mail is queued. A unique index on the order and event type keeps one shipped
event per order. Two concurrent requests serialize on the order row: one ships
the order, the other returns `fulfilment_conflict` and queues nothing.

The tracking link is derived from the carrier and the number by
`shipmentTrackingUrl` in `core/domain/fulfilment.ts`: InPost parcels link to
`https://inpost.pl/sledzenie-przesylek?number=<trackingNumber>`; `other` shows
the number without a link. A new carrier is one entry in that map.

### Shipment e-mail

The buyer receives the `order-shipped` e-mail at the member e-mail address:
"Your order <number> has been shipped — <workspace>" with the order number, the
shipped items (product lines, not the delivery line), the delivery option with
the locker code and details or the postal address, the carrier, the tracking
number and, for InPost, the tracking link. The language follows the member's
language, then the workspace default. Test-mode orders send no e-mail, like
other purchase e-mails. The message is queued in the same transaction as the
shipment and dispatched right after commit; it uses the workspace transport
rules of other transactional e-mail and is not auth-bearing. Member erasure
pseudonymises its delivery name and street lines like the purchase
confirmation.

### Packing list

With the **To pack** filter selected, the orders page offers **Download packing
list (CSV)**: `GET /api/orders/packing-list?format=csv` (optionally
`fulfilmentStatus=to_pack|shipped`, default `to_pack`, and `mode=live|test`,
default `live`) needs `order:export` and returns the orders of that payment
mode, oldest payment first; Studio sends the payment mode selected on the
orders page. The columns are `order_number`,
`paid_at` (Europe/Warsaw, `YYYY-MM-DD HH:mm`), `buyer_name`, `email`, `phone`,
`delivery`, `pickup_point_code`, `pickup_point_address`, `shipping_name`,
`address_line1`, `address_line2`, `postal_code`, `city`, `country`, `items`
(`name × 1; name × 1`, product lines only) and an empty `notes` column. Every
cell is quoted and cells starting with `=`, `+`, `-`, `@`, a tab or a carriage
return are prefixed with an apostrophe so spreadsheets do not run them as
formulas; a phone number such as `+48…` therefore appears as `'+48…`.

### Studio and My products

The order detail **Delivery** card offers **Mark as shipped** for orders to
pack when the staff role has `order:write`: a carrier select (preset to the
delivery option's carrier), the tracking number and a confirmation that names
the buyer e-mail; for a test-mode order it says instead that no e-mail is sent.
A shipped order shows the shipment date and time
(Europe/Warsaw), the staff member who shipped it, the carrier and the tracking
number with its link.

My products shows "Being prepared for shipping" for a physical line of an order
to pack and "Shipped on <date> · <carrier> <tracking number>" with the tracking
link once shipped, with the date in Europe/Warsaw. When the buyer ordered the
same product more than once, the status and destination come from the newest
order.

## Product safety information (GPSR)

Products have an optional `compliance` object with the manufacturer and safety
information the EU General Product Safety Regulation requires on the offer of
physical goods:

| Field | Values |
|---|---|
| `manufacturerName` | 1–200 characters |
| `manufacturerAddress` | 1–300 characters, postal address |
| `manufacturerEmail` | contact e-mail |
| `modelIdentifier` | 1–100 characters, model or type |
| `batchIdentifier` | optional, 1–100 characters |
| `safetyWarnings` | 0–5000 characters of Markdown, empty by default |
| `instructionsUrl` | optional HTTPS URL |

The field is accepted on every product type through the API, the CLI and the
import API; Studio shows the expandable **Product safety (GPSR)** section in the
product editor for physical products only. The workspace is responsible for the
content; the platform only validates the shape.

The public offer returns `compliance` for each product with
`safetyWarningsHtml`, the warnings rendered by the server-side Markdown renderer
used for sales-link descriptions (links, emphasis and lists only; HTML and
images are escaped or dropped). The Together checkout page shows the section
**Product safety information** directly under the description and renders the
warnings through the product description sanitiser. For physical products the
section is always expanded; for other product types it is collapsed until
opened. Public sales-link offers carry `compliance` on each line the same way,
and the sales-link checkout shows one section per product with safety
information, titled with the product name when the link sells more than one
product. The purchase confirmation e-mail does not include it.

Product snapshots carry the descriptive fields, so the field was added in
product snapshot version 8 (`core/domain/snapshots/product/v8.ts`); version 7
snapshots read unchanged because the field is optional.

## Product variants

Variants are separate products, each with its own price, stock, slug and
checkout. `variantGroup` (1–60 lowercase letters, digits and hyphens) links
products of one workspace; `variantLabel` (1–60 characters, for example
`Black · ASA`) names the variant. Studio shows both under **Variants** in the
editor of physical products; the API, the CLI and the import API accept them on
every product.

The public offer returns `variants: [{ productId, slug, label, soldOut }]` for a
product whose group has at least two published products, including the product
itself, in creation order; otherwise the list is empty. A variant without a
label uses its title. The checkout page renders the variants as chips above the
price: the current product is selected, the others link to their own checkout
page (campaign parameters are kept), and a sold-out variant is disabled with
"Sold out". The sold-out flag is the public stock flag of the sibling: a
tracked variant without an available piece is sold out, an untracked one never
is. The offer reads the stock of the offered products and of every published
sibling in their groups in one query.

## Content security policy for the parcel locker map

Following the owner decision of 2026-11-05, the page injects
`https://geowidget.inpost.pl/inpost-geowidget.js` (with `defer`) and
`https://geowidget.inpost.pl/inpost-geowidget.css` on demand, only when all of
these hold: the workspace has a Geowidget token, the buyer has chosen a parcel
locker option, the checkout runs in live mode (the Stripe test-mode switch is
off), and the viewer holds no staff session (owner or admin) for the workspace.
The page learns the last two from `GET /api/public/payment-config`: `canTest`
is true for a signed-in owner or admin of the workspace, and `testEnabled` for
the session-bound test-mode switch. Owners and admins, who use `/checkout/*`
and `/offer/*?checkout=together` for test-mode purchases, never load the map:
their delivery step shows only the locker code input with the hint "The
parcel-locker map is available to buyers; enter the locker code."

Following the same decision, the checkout form documents add
`https://geowidget.inpost.pl` to `script-src` and `style-src`:

- `/checkout/<productRef>` without `status=success`;
- `/offer/<slug>?checkout=together` and `/offer/<slug>?status=cancelled`.

The server middleware (`apps/server/src/app.ts`) and the static hosting headers
(`vercel.json`) apply the same rule. No `connect-src` change is part of it: each
document keeps its base value, `'self' https:` on `/checkout/*` documents and in
the static hosting headers, and `'self' https://*.sentry.io` on `/offer/*`
server responses. On a server-rendered `/offer/*` form document the map may
therefore fail to reach InPost's API; the buyer then enters the locker code in
the typed input, which the delivery step always shows. `img-src` already allows
`https:`. Success documents keep the
analytics policy described in [Security](security.md) and never allow the map
origin. No other document allows it; `vercel.json` keeps its policy entries
mutually exclusive, so header precedence cannot hand the map origin to a success
document.

The injected script cannot be unloaded, so once the map has been shown, leaving
the form document by an in-app link, programmatic navigation or browser history
step becomes a full document navigation (the same guard as the analytics success
document). The guard stays in place after the buyer switches to another
delivery option, so the map code never runs in sign-in or signed-in views.

Follow-up: a browser check on staging lists the exact origins the map calls;
any `connect-src` change for them needs a separate owner decision.

## CLI

```bash
pnpm --silent run cli --tenant acme tenant settings-set \
  --shipping-rates '[{"id":"locker","label":"Parcel locker","amountCents":1499,"carrier":"inpost","pickupPoint":"inpost_locker","active":true}]' \
  --inpost-geowidget-token '<public token>'
pnpm --silent run cli --tenant acme product create --title 'Printed holder' \
  --type physical --delivery-method shipping --price-cents 4900
pnpm --silent run cli --tenant acme product update <id> --delivery-method pickup
pnpm --silent run cli --tenant acme checkout session --product <id> \
  --shipping-rate locker --pickup-point WAW01M
pnpm --silent run cli --tenant acme simulate-purchase --email buyer@example.com \
  --product <id> --shipping-rate locker --pickup-point WAW01M
pnpm --silent run cli --tenant acme orders list --fulfilment to_pack
pnpm --silent run cli --tenant acme orders packing-list --format csv --out packing-list.csv
pnpm --silent run cli --tenant acme orders ship <orderId> --carrier inpost --tracking 520000011395200025754311
pnpm --silent run cli --tenant acme orders list --fulfilment shipped
pnpm --silent run cli --tenant acme product update <id> \
  --compliance '{"manufacturerName":"Example Workshop","manufacturerAddress":"Example Street 1, 00-001 Warsaw","manufacturerEmail":"safety@example.com","modelIdentifier":"STAND-1"}' \
  --variant-group printed-stand --variant-label 'Black · ASA'
```

`--shipping-rates` replaces the whole list; an empty string for
`--inpost-geowidget-token` clears the token. `--pickup-point` needs
`--shipping-rate`. `--compliance null` removes the safety information and
`--clear-variant` removes the variant group and label.

## Stock

Stock tracking is optional per product. A product without a `product_stock`
row is untracked and sells without a limit, which keeps the behaviour of every
existing product. Staff enable tracking in Studio ("Track stock" in the Stock
section of a physical product's editor or create page) or with
`together product stock enable <productId> --on-hand N [--threshold N]`. The
API accepts tracking for any product type; Studio shows the section only for
physical products. Tracking cannot be switched off once enabled; the count is
corrected with an adjustment. Counts are capped at 1,000,000 pieces. An
adjustment may lower `on_hand` below the pieces reserved by open checkouts (for
example damaged goods); a later commit then records `oversold` and alerts.

### Model

- `product_stock` is the projection: `on_hand`, `reserved`, an optional
  `low_stock_threshold`, and `low_stock_notified_at` and `sold_out_notified_at`
  for alert deduplication.
  Available pieces are `on_hand - reserved`, never below zero.
- `stock_reservations` holds one row per tracked product of a checkout snapshot
  (`active`, `committed` or `released`) with its `expires_at`. The pair
  `(tenant_id, checkout_snapshot_id, product_id)` is unique.
- `stock_events` is append-only. `quantity` is the signed change of the type:
  `tracking_enabled` (initial `on_hand`), `adjusted` and `returned` (change of
  `on_hand`), `reserved` and `released` (change of `reserved`), `committed` and
  `committed_late` (change of `on_hand` actually applied), and `oversold` (the
  pieces sold beyond `on_hand`, not applied). Events carry `reference` with the
  checkout snapshot, order, reservation and reason where they apply.

### Checkout

1. `validateCheckoutSelection` reads the stock of the selected products and
   returns `sold_out` early when any tracked product has no available piece.
   This read is advisory only.
2. After the checkout snapshot is captured and before the Stripe session is
   created, `StockRepository.reserve` reserves one piece of every tracked
   product in one transaction. The conditional update is the only authority:

   ```sql
   update "product_stock" set "reserved" = "product_stock"."reserved" + $1, "updated_at" = $2
   where (("product_stock"."tenant_id" = $3 and "product_stock"."product_id" = $4)
     and "product_stock"."on_hand" - "product_stock"."reserved" >= $5)
   returning "product_id"
   ```

   No updated row for a tracked product rolls the whole reservation back and
   the checkout fails with `sold_out` (HTTP 409, CLI exit code 26) naming the
   product title.
3. With at least one tracked product the Stripe session expires after 31
   minutes (passed as `expires_at`; one minute above the Stripe minimum of 30,
   so the clock read and the request time never take it below the minimum) and
   the reservation after 36 minutes. Untracked-only checkouts keep the Stripe
   default.
4. A failed Stripe session creation, a failure to record the direct handoff
   snapshot, or any other checkout failure after the reservation releases it
   immediately, also when expiring the Stripe session fails as well. A cleanup
   step that fails (expiring the session or releasing the hold) is logged, and
   the checkout fails with the original error.
5. Free and fully discounted checkouts keep the reservation and fulfil at once;
   the fulfilment commits it.
6. Staff test checkouts never reserve or commit live stock. The simulated
   provider reserves and commits like a live checkout, after recording the
   order, and sends the same low-stock e-mail.

The shipping line of a shipped checkout is never a product for stock purposes:
reservation and commit cover product lines only. The sold-out check in step 1
runs before the delivery selection is validated, so a sold-out product fails
with `sold_out` (not `shipping_required`) before anything is written.

### Payment and expiry

The paid branch of `checkout.session.completed` and
`checkout.session.async_payment_succeeded` commits stock inside the payment
transaction that records the order:

- an `active` reservation becomes `committed`: `on_hand` and `reserved` both
  drop by one;
- a `committed` reservation is left unchanged, so webhook retries are safe;
- a `released` reservation (the session outlived the sweep) becomes
  `committed` with a `committed_late` event and `on_hand` drops by one;
- a tracked product of the snapshot without any reservation (orders started
  before tracking) is committed late the same way;
- an order without a checkout snapshot is committed late once: a retry finds
  the earlier commit event of that order and changes nothing;
- when `on_hand` would go below zero it is clamped at zero, an `oversold` event
  is appended, a warning is logged and the low-stock e-mail carries the
  oversold flag.

`checkout.session.expired` is not handled. The expiry sweep
`releaseExpiredStockReservations` runs on the existing minute tick (the
`/api/internal/dispatch-email` cron route and the Node ticker) before e-mail
dispatch. It releases at most 100 expired `active` reservations per run, oldest
first, each in its own transaction, and logs one line when it released any. A
failing sweep is logged and never stops that tick's e-mail dispatch.

Refunds never change stock. Staff put goods back with an adjustment whose
reason is `returned` (recorded as a `returned` event).

### Low-stock e-mail

A commit that leaves availability at or below the threshold sends the
`stock-low` e-mail to the support address, or else to every staff member in
their language, with the product title, the available count, the threshold, the
oversold flag and a Studio link. The first crossing records
`low_stock_notified_at`; later commits stay quiet until the zero alert. The
zero alert goes to the first commit that takes availability from above zero to
zero (for example a late commit that takes the last free piece while other
checkouts hold the rest) or takes `on_hand` from above zero to zero, whichever
comes first, and records `sold_out_notified_at`. Pieces held by open checkouts
keep availability at zero without a second alert, and a later commit that
empties the shelf stays quiet while `sold_out_notified_at` is set. An alert
counts as sent when at least one recipient was queued; when none was it is not
recorded. An adjustment or threshold change that lifts availability above the
threshold clears `low_stock_notified_at`; an adjustment that leaves any piece
available clears `sold_out_notified_at`. Products without a threshold only
alert when oversold.
The e-mail is queued in the payment transaction.

### Public offer

The public offer exposes per product `stock: { tracked, soldOut, low }` and never
the exact count. `low` means a threshold is set and availability reached it. The
offer ETag includes a hash of these flags, so a product selling out or running
low revalidates cached offers while count changes alone do not. A sales link is
sold out when any of its products is: the direct handoff page shows the
"checkout unavailable" state (HTTP 409) instead of posting to Stripe, while
crawlers still receive the preview metadata, and the Together checkout page
disables the pay button with a "Sold out" label.

### Studio and CLI

The product editor shows on hand, reserved and available pieces, an adjustment
form (signed change and reason) and the low-stock threshold. The products list
shows "on hand · reserved", "Sold out" or "Low" for tracked products. The CLI
offers `product stock show|enable|adjust|threshold` and `product list` prints
the same summary for tracked products. All writes require `product:write`.

Stock is not part of the product content snapshot (`core/domain/snapshots/product`):
it is operational state with its own event history, so restoring a product
version never changes stock.
