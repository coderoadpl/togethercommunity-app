# Shop: shipped physical products and stock

A physical product is either collected in person or shipped by parcel. This
page covers shipping: delivery methods, delivery options (rates), the parcel
locker flow, what an order stores, fulfilment (packing and marking orders as
shipped), InPost ShipX shipments and labels, product safety information,
product variants, the content security policy for the parcel locker map, and
the CLI. The last section covers stock tracking with checkout reservations.

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

The checkout page renders a **Delivery** section with the active options and
their prices directly under the order summary, the variant chips and the price
choice, before the personalisation, the invoice and discount code rows and the
pay button. For a parcel locker option it shows, under the chosen option, a filled
**Choose a parcel locker** button with a map pin that opens the
[parcel locker picker](#parcel-locker-picker) with the InPost map (under the
rule in
[Content security policy for the parcel locker map](#content-security-policy-for-the-parcel-locker-map)),
and a small **I know the code** toggle with a chevron that reveals the
**Parcel locker code** input (upper-cased, 4–12 letters or digits). Once a
locker is chosen on the map the option shows a check with **Selected parcel
locker**, the code, name and address and a **Change** button that reopens the
picker, and the typed-code field closes. Without a map (no Geowidget token, a staff session or test mode, or
a map that failed to load) the option shows the code input directly, with one
short reason when there is one. The pay button stays disabled until an option,
and a valid code when the option needs one, is chosen, and a line under the
button says which of the two is missing.

A typed code is checked at the carrier through the
[parcel locker lookup](#parcel-locker-lookup-at-the-carrier) when the buyer
leaves the code field and again when the form is submitted, through the bound
`actions.publicParcelLocker` query (no vendor script, so the check works the
same for staff sessions and test mode). A polite live region under the field
(`role="status"`) says **Checking the parcel locker code…** while the carrier
is asked, then shows **Parcel locker found** with the code, the locker name and
its address, or one error, behind an exclamation-circle glyph, for a code the
carrier does not know, a point where parcels cannot be collected, or a locker
that is not operating. While that line is shown it is the first line under the
field and the example hint is hidden; the hint is shown for an empty field,
before the code is checked, or when the carrier cannot be asked, and becomes
the format error for a
malformed code. The field's `aria-describedby` names only the line that is
shown. On an error the field and its label turn red and the field is marked
`aria-invalid`, the pay button stays disabled and the line under it reads
**Choose another parcel locker or type another code to go to payment.** (the
hosted cart page shows the same line under its button); editing the code
clears the verdict, and so does an answer for a code the field no longer shows. When the carrier cannot be
asked (it is down, the lookup is rate-limited or the workspace answer is
refused) the page shows nothing and lets the buyer pay, because the server
accepts the code as unverified. The page asks its own server once per lookup,
without retries. A code chosen on the map is never looked up by the page. When
the server still refuses the locker on checkout start or on a simulated
purchase, the page shows its reason once: under the field, or under the
selected point for a map choice (a `role="alert"` line, and the box takes the
error border), never again in an alert by the pay button. A preview answer that
arrives after that refusal does not replace it. The pay button stays disabled
until the buyer changes the locker. The submit-time check runs only when the chosen
delivery option needs a locker. While it runs the form is locked and the pay
button shows its pending label; the payment then starts from the form as it is
at that moment, and does not start when the locker, the form, the payable
amount, the currency or the payment mode changed. The page waits at most five
seconds for that check; after that it leaves the decision to the server and
starts the payment, and a later answer never starts it again. The lookup runs
also when the browser reports being offline, so the check never pauses. Focus
and keyboard rules of the page do not change: Enter in the code field still
does not submit the form.

### Parcel locker picker

The map never sits inside the checkout page. `LockerPicker` in
`apps/web/src/features/checkout/` is shared by the product checkout, the sales
link checkout and the hosted cart page through `DeliveryStep`:

- On a phone or a short screen (narrower than the `md` breakpoint or lower than
  600 px) it is a full-screen view of `100dvh` that respects the safe-area
  insets; on a desktop it is a large dialog. The page behind it does not scroll
  and is hidden from assistive technology.
- A fixed header holds the title, one line of guidance (**Tap a point, then
  the yellow “Select” button.**), an **I know the code** action and the way
  out. In the full-screen view the way out is a **Back** control with an arrow
  on the left, away from the map's own close buttons at the top right; the
  desktop dialog keeps a close button. On a phone narrower than the `sm`
  breakpoint the header has two rows, **Back** and **I know the code** above
  the guidance line, and the title stays in the page only as the dialog's
  heading for assistive technology; wider screens show **Back**, the title
  with the guidance line and **I know the code** in one row. The map fills all
  the remaining space down to the bottom edge, without a scrolling container
  around it and without a footer, and the full-screen view has no rounded
  corners or border.
- **I know the code** in the header closes the picker the same way as
  **Back**, opens the **Parcel locker code** field on the page and moves focus
  into it. When the field already holds a code, that code is selected, so the
  first key replaces it (the same after **Type the code**).
- One tap chooses the locker. InPost's map reports a point only when the buyer
  taps the map's own yellow select button in the point's card or details
  panel; tapping a marker, a list item or the map's details link only shows
  the point. The picker therefore commits the reported point at once,
  closes, returns focus to **Change** and announces the chosen locker in a
  polite live region on the page ("Parcel locker WAW01M chosen: Example
  Street 5, 00-001 Warsaw."). There is no second confirm button: it would mean
  the same as the map's own select button, and the map shows no feedback
  after it, so our page closing is the feedback.
- Reopening the picker with a locker already chosen asks the map to show that
  locker (`showPoint` on the handle from `inpost.geowidget.init`). The call is
  guarded: a missing handle, a missing method, a thrown error or a rejected
  promise is ignored, and the map then starts at its own default spot. InPost
  ignores such calls silently until the token is registered for the exact
  domain.
- **Back**, the close button, Escape (also from inside the map, which reports it with the
  `inpost.geowidget.escape` event, on the map element or on the document) and
  the phone's back gesture close the picker and keep the previous choice.
- Opening the picker adds one browser history entry for the same address, so
  the back gesture closes the picker instead of leaving the checkout; closing
  it in any other way, or choosing a locker, removes that entry again without
  leaving the page.
- Focus moves to the picker title when it opens, stays inside it, and returns to
  **Choose a parcel locker** or **Change** when it closes (to the code input
  after **I know the code**, **Type the code** or a map failure). The guidance
  line describes the dialog and is a polite live region, so a map failure is
  read out. Enter inside the picker never submits the checkout.
- The map element is created only while the picker is open and removed when it
  closes. When the map script fails to load (for example a content security
  policy kept from an in-app navigation), the picker says so in the guidance
  line and again above **Try again** and **Type the code** in the map area
  (that copy is hidden from assistive technology, so the failure is read out
  once). The header then shows no **I know the code**, so **Type the code** is
  the only code exit. **Try again** clears the failure, brings **I know the
  code** back, moves focus to the picker title and mounts the map again with a
  fresh script.
  After **Type the code** the option shows the code input with the reason for
  the rest of the page's life. A script that fails
  while the picker is closed is removed, so the next opening loads it again.
  A token InPost rejects (for example one issued for another domain) loads the
  map with InPost's own red access-denied banner, a watermark and no points;
  the page cannot detect that inside the cross-origin frame, so the buyer uses
  **I know the code** in the picker header.

### Layout of the Together checkout page

`/checkout/<productRef>` and `/offer/<slug>?checkout=together` show one short
step before Stripe and keep only what Stripe Checkout does not show:

1. A step indicator, `1 Delivery · 2 Details and payment`, or `1 Your order`
   when nothing is shipped. It is shown only when the order continues to
   Stripe.
2. The offer title and one summary row, `N items · total`, with the total after
   the discount code and the delivery fee. **Details and VAT** opens the cover,
   the description and, for a sales link, the per-line net amount, VAT rate,
   VAT amount and gross amount.
3. The variant chips, the price choice when a product has several prices, the
   delivery options with the parcel locker picker under the locker option, and
   the personalisation rows.
4. Two collapsed rows: **I need an invoice** (the invoice data stays on the
   page because Stripe's tax ID form does not guarantee an address for the
   invoice) and **I have a discount code** (the coupon rules and the lowest
   price in the last 30 days are shown before payment).
5. The workspace purchase consents, the staff test-mode switch for staff, and
   the compact [product safety line](#product-safety-information-gpsr).
6. The pay button with the total, `Go to payment · PLN 159.00`, sticky at the
   bottom of the screen, a line that names what Stripe asks for next (email,
   delivery address, terms) and, when the button is disabled, the reason under
   it.

The email and the terms acceptance move to Stripe when the workspace has both a
terms URL and a privacy URL (see
[Payments](payments.md#terms-acceptance-on-the-together-checkout-page)). The page
asks for the email only for a discount code with a per-person limit (the field
appears inside the code row after the server asks for it, with a line saying that
without it the buyer pays the full price), and for the email and the terms for
an order with nothing to pay, which never reaches Stripe. A code from the
checkout link keeps its discount while the address in the code row is edited and
is validated again for the new complete address; once that address is cleared
or no longer complete, the discount is dropped, the pay button shows the full
amount and sends no code, and the code is validated again by itself when the
address is complete. A
signed-in buyer is never asked for the email: the account email is sent with the
request. A workspace without both legal URLs, and the development simulated
payment, keep the email field and, when a URL is set, the terms checkbox on the
page. When the workspace's Stripe account has no terms URL in its Dashboard public
details, Stripe refuses to collect the terms; the page then shows the email field
and the terms checkbox itself, keeps everything the buyer chose and asks once to
accept the terms there (see
[Payments](payments.md#stripe-accounts-without-a-dashboard-terms-url)). Expandable parts are buttons with `aria-expanded` and `aria-controls`;
their panels open below the button, so nothing above them moves.

The shared parts (`CheckoutSteps`, `CheckoutSummaryRow`, `CheckoutDisclosureRow`
and `CheckoutPayBar` in `apps/web/src/components/ui/CheckoutStepParts.tsx`, and
`ProductSafetySummary` in `apps/web/src/features/checkout/`) take plain props so
the cart checkout can adopt them; the cart page uses `CheckoutPriceBreakdown`
for its summary above the pay button, so its coupon panel (`breakdown="discount"`
on `CouponField`) shows only the discount and the lowest price of the last 30
days, and otherwise keeps its own layout, a
plain list of delivery options with the parcel locker block (**Choose a parcel
locker** or the chosen locker, and **I know the code**) directly under the
locker option, before the next option.
The locker stored on the order carries the carrier's canonical code, name and
address whenever the carrier answered, see
[Parcel locker lookup at the carrier](#parcel-locker-lookup-at-the-carrier). When the buyer reaches
the checkout page through an in-app navigation from another page, the document
keeps that page's content security policy, the map does not load, the picker
says so, and the code input remains the way to choose a locker.

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
| locker code the carrier does not know | `validation` with the message `No InPost parcel locker has this code` and `details.pickupPointReason: 'not_found'` |
| carrier point that is not a parcel locker or cannot hold parcels for collection | `validation`, `This InPost point cannot hold parcels for collection`, `not_usable` |
| carrier point that is not operating | `validation`, `This InPost parcel locker is not operating`, `not_operating` |
| order total, shipping fee included, is zero (a free or fully discounted product with a zero-fee option) | `validation` with the message `Delivery is not available for free orders`, returned before any checkout snapshot or coupon session is written; the checkout page shows it as a localized message |

The zero-total rule exists because a free order never reaches Stripe, so
nothing would collect the delivery address. A fully discounted product with a
paid delivery option is a normal Stripe checkout for the fee alone: Stripe
collects the address, and the webhook claims the coupon redemption. When a
concurrent buyer takes the coupon's last redemption before that claim, the buyer
has already paid the delivery fee on Stripe, so the webhook still records the
order normally, with the coupon and the discount Stripe applied, its delivery
data and `to_pack` status, sends the purchase confirmation and logs a warning
with `reason=coupon_over_redeemed`. No redemption row is written, so such a race
can over-redeem a coupon by one shipped order; staff see the order on the
Studio Orders page and decide whether to refund it in Stripe. A checkout that
charged nothing is still refused with `Coupon redemption limit reached`.

Stripe Checkout receives the product lines as line items and the fee as exactly
one shipping option (`shipping_rate_data` with a fixed amount, the option label
as `display_name`, `tax_behavior: 'inclusive'` and the optional business-day
estimate), plus `shipping_address_collection` limited to the allowed countries
and `phone_number_collection`. See [Payments](payments.md#shipping-in-stripe-checkout).

### Parcel locker lookup at the carrier

Every checkout path that accepts a parcel locker (single product, sales link and
cart, which meet in `withCheckoutShipping` in
`core/server/usecases/checkout-selection.ts`, and the simulated purchase) asks
the carrier about the code through the `PickupPointDirectory` port before any
checkout snapshot, consent capture, coupon session, stock reservation or payment
session is written. Coupon validation previews and the direct sales-link
handoff ignore delivery and never ask the carrier; the direct handoff refuses
shipped products anyway.

The production adapter (`adapters/shipx/points.ts`) calls the public ShipX
Points resource `GET https://api-shipx-pl.easypack24.net/v1/points/<code>`,
which needs no authentication, with a fixed host for live and test mode alike
(the codes are real lockers), the normalized code URL-encoded as the only
variable part, a 3-second timeout, no retries and no redirects. Carrier
documentation:
[Points 1.23.0](https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/28639230/1.23.0+Points)
and [the points field reference](https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/18153470);
the newer token-gated `api.inpost.pl` points gateways are not used. The adapter
parses the answer strictly: an HTTP 200 body
`{"status":404,"key":"point_not_found"}` and a real HTTP 404 mean not found; any
other status, a timeout, a network error, a body that does not parse or an
answer for another point mean the carrier is unavailable. Recorded answers live
in `adapters/shipx/fixtures/point-*.json`: `point-operating.json` and
`point-not-found.json` keep the recorded shape of real answers with every
human-language value (address, location description, display name) replaced by
an English placeholder, and the `*.derived.json` files change only `status`,
`type` or `functions`.

A point is usable only when `status` is exactly `Operating` (`NonOperating`,
`Disabled`, `Removed` and any other value refuse it), its `type` includes
`parcel_locker` and its `functions` include `parcel_collect`
(`inpostPointRejection` in `core/domain/shipping.ts`). This is what the map
offers with `config="parcelCollect"`, so InPost partner pickup points that hold
parcels for collection (`partner_id` 33, typed `parcel_locker` as well as `pop`)
are accepted as on the map; the shipment still requests `inpost_locker_standard`,
and InPost switches a partner pickup point target to
`inpost_locker_customer_service_point` on its side. A usable point replaces what
the client sent with the carrier's canonical code, the location description as
the name and `address.line1, address.line2` as the address, built by
`pickupPointDetails`, the same function that reads a map choice.

When the carrier cannot be asked, the sale is not blocked: the code is kept as
the buyer typed it and the stored pickup point gains `verified: false`, which
Studio shows as **Locker not verified**. There is no staff e-mail for new
orders, so the note appears only in Studio. Alternative considered: block
payment when the locker cannot be verified.

The page uses `GET /api/public/parcel-lockers/<code>`: it resolves the workspace
like the other public checkout routes, refuses a code that does not match the
pattern with `validation` before any carrier call, answers `not_found` without
a carrier call when the workspace has no active parcel locker option, and
otherwise returns `{ status: 'found', code, name, address, usable, reason }`,
`{ status: 'not_found' }` or `{ status: 'unavailable' }` with
`Cache-Control: no-store`. It never forwards a query string or another path. It
is same-origin only (no open CORS) and limited per client address (30 per
minute in production), per workspace (600 per minute) and across the platform
(1,200 per minute for every carrier call, of which the page's lookups may use
600), see
[Security](security.md#parcel-locker-lookup).

The directory follows the payment provider: a deployment with
`PAYMENT_PROVIDER=stripe` (production and any staging that runs Stripe test
mode) asks InPost, and one with `PAYMENT_PROVIDER=fake` (development,
end-to-end runs and the smoke gate) uses the fake directory in
`adapters/shipx/fake.ts`: `WAW01M`, `WAW02M` and `WAW03M` are operating lockers,
`CLOSED01` is not operating, `SENDONLY1` is a send-only point, `OUTAGE01`
simulates the carrier being down, and every other code, such as `MISSING1`, is
not found. The lookup limits above follow the directory too: every deployment
that asks InPost, staging included, uses the production figures, and only one
with the fake directory uses the higher development values.

## Order data

The checkout snapshot appends a shipping line after the product lines:
`productType: 'shipping'`, `productId: 'shipping:<rateId>'`, the option label as
its name, gross, net and VAT split at the option's VAT rate and
`issuedCount: null`. `checkout_snapshots.shipping` freezes the option
(`rateId`, `label`, `amountCents`, `vatRatePercent`, `carrier`, `pickupPoint`)
and the allowed countries at checkout start, so later edits to the option do not
change an order in flight.

When Stripe reports the completed session, the webhook requires a shipping fee
reported by the event (`shipping_cost.amount_total`, or
`total_details.amount_shipping` in older API versions) to equal the shipping line,
and a delivery address in an allowed country; otherwise the event is rejected as
a validation failure. When the event reports no fee, the session is accepted only
when its total matches every snapshot line, and a session without `amount_total`
is rejected (see [Webhook API version](payments.md#webhook-api-version)). The
total check compares `amount_total + amount_discount` with the sum of all
snapshot lines, shipping included. The paid order stores:

- `orders.lines` with the shipping line last;
- `orders.shipping`: the frozen option, the pickup point or `null` (with
  `verified: false` only when the carrier could not be asked), the
  delivery address (`name`, `line1`, `line2`, `postalCode`, `city`, `country`)
  and the phone number collected by Stripe;
- `orders.fulfilment_status = 'to_pack'`. Orders without shipping keep `null`.

Rollback: the unverified mark is one optional key, written only when the carrier
could not be asked, in the same JSONB pickup point object of
`checkout_snapshots.shipping` and `orders.shipping`; no migration adds it. Every
schema the previous release uses to read stored orders, checkout snapshots,
fulfilment views and e-mail payloads is non-strict, so that release reads such a
row and drops the key, and e-mail payloads never carry it
(`orderDeliveryDetails` copies only the code, name and address).
`core/domain/shipping-rollback.test.ts` holds a literal copy of the previous
release's shipping schemas and proves they parse what this release writes.

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
address, phone, and a **Locker not verified** warning for a pickup point stored
with `verified: false`) and a fulfilment chip (**To pack** or **Shipped**). The orders
list has a **Fulfilment** filter (all orders, `to_pack` or `shipped`, sent as
`fulfilmentStatus`) and a **Fulfilment** column with the same chips. CSV and
JSON exports add the columns `shipping_rate`, `shipping_point`, `shipping_name`,
`shipping_phone`, `shipping_address`, `shipping_postal_code`, `shipping_city`,
`shipping_country` and `fulfilment_status`, followed by `client_reference`
(the storefront's `clientReference`, empty when the checkout had none),
`personalization` (see [Personalisation](#personalisation)) and `cancel_reason`:
`out_of_stock` for an order cancelled because its goods sold out before the
payment arrived, empty otherwise. `cancel_reason` is the last column so the
earlier column positions stay unchanged, and `status` keeps the payment status.
The JSON export carries the same value as `cancelReason`.

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
"Order shipped — <workspace> (#<reference>)", where the reference is the first
eight characters of the order id, upper-cased. Directly under the first sentence
comes the tracking link (InPost), then the shipped items (product lines, not the
delivery line; a line above one unit is named "<units> × <name>"), the delivery
option with the locker code and details or the postal address (a locker name
that repeats its code is printed once, the country by name), and one block with
the full order number, the carrier (left out for `other`) and the tracking
number. The language follows the member's
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
mode, oldest payment first. Studio sends the payment mode selected on the
orders page; with the **All** payment-mode filter it sends `live` and shows
"Live orders only" next to the button. The CLI takes `--mode live|test`
(default `live`). The columns are `order_number`,
`paid_at` (Europe/Warsaw, `YYYY-MM-DD HH:mm`), `buyer_name`, `email`, `phone`,
`delivery`, `pickup_point_code`, `pickup_point_address`, `shipping_name`,
`address_line1`, `address_line2`, `postal_code`, `city`, `country`, `items`
(`name × <units>; name × <units>`, product lines only), an empty `notes` column
`quantity`, the total units of the product lines, and `personalization`
(see [Personalisation](#personalisation)). New columns are added at the end so
the earlier column positions stay unchanged. Every
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
same product more than once, the purchase date, the status and the destination
all come from the newest order. A line of that order above one unit is named
"<units> × <title>"; one unit keeps the plain title.

## InPost ShipX

Staff create the InPost shipment, pay for it and store the tracking number from
the order page in one action, then print the A6 label. Manual dispatch in
Manager Paczek stays available: **Mark as shipped** with a typed tracking number
works as before.

### Setup

1. Generate the organization id and the API token in Manager Paczek under
   **My account → API** (the account data, including the invoice data, must be
   complete). The sandbox uses a separate account in the sandbox Manager Paczek
   at `https://sandbox-manager.paczkomaty.pl`; sandbox credentials do not work in
   production and the other way round. Locker shipments need funds on the
   account; the sandbox account is topped up virtually under **Payments**.
2. In **Studio → Settings → Shipping → InPost ShipX** the owner fills in two
   connections, each with its own organization id and token: **Production**
   serves paid orders, **Sandbox** serves test-mode orders, the way Stripe keeps
   a live and a test key. Each connection shows **Connected** once its
   organization id and token are saved, and has its own **Remove credentials**
   action. A workspace may connect one of them, both or none.
3. The sender block below the connections is shared by both and optional:
   name, optional company, e-mail, phone (a Polish 9-digit number, `+48`
   accepted), street, building number, city and post code (`00-000`). The
   sender country is always `PL`.

Each connection selects its API base URL: `https://api-shipx-pl.easypack24.net/v1`
for production and `https://sandbox-api-shipx-pl.easypack24.net/v1` for the
sandbox (both from the authorization page of the ShipX API documentation).
Only the ShipX HTTP adapter (`adapters/shipx/http.ts`) knows these
URLs.

The organization ids and the tokens are stored like the Stripe keys: encrypted
tenant secrets (`shipx.production.organizationId`, `shipx.production.token`,
`shipx.sandbox.organizationId`, `shipx.sandbox.token`) that are write-only in
Studio and the CLI, which only show a masked preview. They never appear in the
public payment configuration or in tenant settings, and the server decrypts
them only for the ShipX call. The sender block is stored on the workspace
(`tenants.shipx_sender`). Both are read through `GET /api/integrations/shipx`,
never through the tenant settings that members can read: the answer carries the
sender and, per connection, the masked organization id, the masked token and
`configured` (both stored). Reading needs `tenant:secret:read` (owners and
admins); saving with `POST /api/integrations/shipx/configure` needs
`tenant:secret:write` (owners). The body is strict:

```json
{
  "sender": { "name": "Anna Sender", "email": "shop@example.com", "phone": "500600700", "street": "Example Street", "buildingNumber": "7", "city": "Warsaw", "postCode": "00-001" },
  "production": { "organizationId": "1234", "token": "<ShipX token>" },
  "sandbox": { "clearCredentials": true }
}
```

Every part is optional and a part left out changes nothing: `sender: null`
removes the sender, `production` and `sandbox` each take `organizationId`,
`token` or `clearCredentials: true` (not together with new credentials).
Saving or clearing one connection never reads, writes or deletes the other
connection's secrets. The single-connection fields of the earlier body
(`environment`, top-level `organizationId`, `token` and `clearCredentials`) are
refused with `validation`.

The sender is optional because InPost does not require it: the ShipX
documentation of the `sender` attribute on shipment creation says that when no
sender data are given, the data of the organization the shipment is created in
are used
([ShipX documentation: creating a shipment](https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/11731061)).
Without a saved sender the request leaves `sender` out entirely. A saved sender
is sent as it is, and since InPost validates a sender object with its e-mail
and a 9-digit phone
([ShipX documentation: sender form](https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/11731043)),
Studio, the CLI and the API refuse a sender without them.

### Parcel size

Every product has `parcelTemplate`: `small`, `medium` (the default) or `large`,
the InPost locker sizes A (8 × 38 × 64 cm), B (19 × 38 × 64 cm) and C
(41 × 38 × 64 cm). Studio shows **InPost parcel size** in the editor and on the
create page of physical products shipped by parcel; the API and the CLI accept
it on every product. A shipment uses the largest size among the order's product
lines, unless staff choose another size for that shipment (see
[Creating the shipment](#creating-the-shipment)). One order is one parcel with
one label; an order that does not fit one large locker parcel goes by courier
or is shipped by hand. Locker shipments send the size as the ShipX
`template`; courier shipments send the size's dimensions and a fixed weight of 5 kg
(`SHIPX_COURIER_PARCEL_WEIGHT_KG` in `core/domain/shipx.ts`). Product
snapshots carry the parcel size from version 9
(`core/domain/snapshots/product/v9.ts`); version 8 snapshots read unchanged
because the field is optional, and restoring a product version keeps the
current size.

### Which ShipX client answers

The order's payment mode picks the connection, so the whole flow can be tried
against the sandbox with test orders while paid orders ship through
production:

| Deployment | Order mode | Connection | Client | Connection not saved |
|---|---|---|---|---|
| `PAYMENT_PROVIDER=stripe` | test | `sandbox` | the real client against the ShipX sandbox | `credentials_missing` for `sandbox` |
| `PAYMENT_PROVIDER=stripe` | live | `production` | the real client against ShipX production | `credentials_missing` for `production` |
| `PAYMENT_PROVIDER=fake` | test | `sandbox` | the deterministic fake client | `credentials_missing` for `sandbox` |
| `PAYMENT_PROVIDER=fake` | live | `production` | the deterministic fake client | `credentials_missing` for `production` |

The rule is `shipxEnvironmentForMode` in `core/domain/shipx.ts` (live →
`production`, test → `sandbox`), and every ShipX use case (view, create,
refresh, discard, label) resolves the organization id and the token of that
connection only. A test-mode order never reaches production credentials or the
production URL, and a paid order never reaches the sandbox ones. A missing
connection affects only the orders of its mode: the order view answers
`available: false` with `reason: 'credentials_missing'` and
`environment` naming the connection, and create answers
`integration_not_configured` with `details.state: 'setup_missing'` and the same
`environment`. The order page then says which connection to save, for a
test-mode order: connect the sandbox in **Settings → Shipping**.

`composition.ts` passes no real client in deployments with
`PAYMENT_PROVIDER=fake` (local development, the smoke gate and the end-to-end
scripts), so they never contact InPost; they still need the connection of the
order's mode to be saved, with any placeholder values. The fake client
(`adapters/shipx/fake.ts`) answers with an id and a 24-digit tracking number
derived from the order id and a one-page PDF, charges nothing and, like every
test-mode shipment, sends no e-mail. A deployment with a real client never uses
the fake client.

Every `order_shipments` row stores the environment and the organization id it
was created with. Reads, purchases and label downloads for a stored shipment use
the connection of the order's mode. When the row's environment is not that
connection (for example a test-mode shipment that the fake client created
before the two connections existed, while the workspace was set to
production), the request answers `conflict` with
`details.state: 'environment_mismatch'` and calls nothing; when the row's
organization id differs from the connection's current one, it answers
`conflict` with `details.state: 'organization_mismatch'`. Restore the
organization id of that connection, or finish the shipment in Manager Paczek.
Opening the order still shows the stored status.

### Upgrade from the single connection

Before the two connections, a workspace had one organization id and token
(`shipx.organizationId`, `shipx.token`) and a switch
(`tenants.shipx_environment`) that named their environment. There is no data
migration: the stored single connection keeps serving the connection that the
stored switch names until that connection is saved or cleared. Each of the two
values is read from the connection's own row and, only when that row does not
exist and the stored switch names the same connection, from the legacy row.
This applies to resolving the credentials of an order, to the readiness of the
order view and to the masked previews and the `configured` flag of the settings, so
Studio shows the stored values under that connection and the other connection as
not connected. A connection row that exists but cannot be decrypted never falls
back to the legacy row. A test-mode order of a workspace whose switch names
production never reads a legacy row, and the reverse.

Saving a value writes only the connection's own row, which then wins over the
legacy row for that value; the other value keeps coming from the legacy row
until it is saved too. Removing the credentials of the connection that the
stored switch names also deletes the legacy rows, so nothing resolves
afterwards. The previous release keeps reading its own rows, the switch and the
sender (which it still requires). Removing the legacy rows, their key names and
the column is a later change.

Rollback: the previous release cannot list a workspace's secrets while rows
named `shipx.sandbox.*` or `shipx.production.*` exist, because it parses every
secret key against a fixed list; such rows exist only after an owner saved a
connection under this release. Before rolling back, check what is stored, by key
name and count only, never values:

```sql
SELECT key, count(*) FROM tenant_secrets WHERE key LIKE 'shipx.%' GROUP BY key;
```

and remove the connection rows:

```sql
DELETE FROM tenant_secrets WHERE key LIKE 'shipx.sandbox.%' OR key LIKE 'shipx.production.%';
```

The legacy rows then serve the previous release with the values stored before
this release. Values saved since then and a connection removed since then (the
one the switch named, whose legacy rows were deleted with it) are not restored,
and a sender removed since then stops the previous release with
`sender_missing`.

### Creating the shipment

The order page shows **Create InPost shipment** on an order to pack whose
delivery option has the carrier `inpost`, when the staff role has `order:write`
and the workspace is ready. The service follows the option: a parcel locker
option sends `inpost_locker_standard` with the locker code as `target_point`,
an address option sends `inpost_courier_standard` with the delivery address.
The confirmation names the service, the parcel size and the buyer e-mail, and
offers **Parcel size for this shipment**: **Automatic** (the largest product
size, the default) or one of the three sizes. The chosen size is sent as the
optional `parcelTemplate` (`small`, `medium` or `large`) in the body of
`POST /api/orders/<orderId>/shipx`, or with
`order shipx create <orderId> --parcel-template <size>` in the CLI; another
value is refused with `validation` before anything is claimed or sent to ShipX.
Without it the parcel takes the largest product size. The size applies only
when the request creates the ShipX shipment: a retry that finishes the payment
of a stored shipment or looks up an unconfirmed attempt keeps the shipment
ShipX already has, and **Discard the attempt and create again** offers the same
choice for the new shipment. The receiver is the delivery name (split into
first and last name at the last space), the member e-mail and the delivery phone. For courier shipments the
street line is split into street and building number; an address without a
building number is refused with a validation message so staff can dispatch it
manually. ShipX e-mail and SMS notifications (`additional_services`) stay off
because Together sends its own shipment e-mail. The ShipX `reference` is the
order id (cut to 100 characters).

`POST /api/orders/<orderId>/shipx` then:

1. claims the order's `order_shipments` row (one row per order, unique on the
   workspace and the order): it inserts the row or sets a fresh random
   `operation_token` and `operation_started_at` with one conditional
   statement, so only one request at a time works on an order (see
   [Concurrency](#concurrency));
2. when the row has no ShipX id yet, records the attempt (`status: 'unknown'`,
   `create_attempted_at`) and creates the shipment with the simplified ShipX
   creation mode (`service` given, `only_choice_of_offer` not set), in which
   ShipX selects and buys the offer itself; the answer stores the ShipX id and
   status. When the row holds an earlier unconfirmed attempt, it reconciles
   instead of creating (see [Indeterminate outcomes](#indeterminate-outcomes));
3. reads the shipment until it is bought (a tracking number and a status past
   `offer_selected`): at most 10 reads two seconds apart, each one stored on
   the row. Every read state is first checked for a failed payment: a ShipX
   transaction that ends in `failure` after the first read of this request
   (for example missing funds), or an offer that became `unavailable` or
   `expired`, stops the request at once with `shipx_rejected`,
   `details.state: 'failed'` and the ShipX reason; the row stays, and staff
   retry with another click, which pays again. Otherwise a shipment that
   already existed before this request and still waits for payment
   (`offers_prepared` or `offer_selected` without a running or successful
   transaction) is paid with the selected or the matching available offer
   (`POST /v1/shipments/<id>/buy`), at most once per request;
4. stores the tracking number and the purchase time and calls the existing
   **Mark as shipped** use-case with the carrier `inpost` and the tracking
   number, so the fulfilment event, the shipment projection and the buyer
   e-mail come from the same code path as a manual shipment. That step is a
   conditional transition inside the fulfilment transaction: when staff marked
   the order as shipped by hand in the meantime, the ShipX shipment stays
   stored and the request answers `fulfilment_conflict` with the tracking
   number in the message and in `details`, so staff can reconcile the two in
   Manager Paczek.

The request has one deadline, 20 seconds from its start, checked before the
create, before each read and before the purchase, and once before the
reconciliation lookup as a whole, whose page reads (up to 5) run without a
further check; the label download is a separate request. When the deadline
has passed, the request makes no further call and answers `shipx_unavailable` with
`details.state: 'pending'`; the row keeps the ShipX id, or the unconfirmed
attempt, and the last status, and the order stays to pack. A row that holds
neither yet (the deadline passed before the create was recorded) is deleted,
so the next click starts over with the current settings. `GET /api/orders/<orderId>/shipx`
(`order:read`) returns the readiness and the stored shipment without calling
ShipX or writing. `POST /api/orders/<orderId>/shipx/refresh` (`order:write`, CLI
`order shipx refresh <orderId>`) returns the same view after reading the live
ShipX status once for a stored shipment that is not bought yet and storing it.
When staff who may ship open the order, Studio loads the view through the
refresh; clicking **Create InPost shipment** again continues from that status
and never creates a second shipment.

### Indeterminate outcomes

ShipX shipment creation is not idempotent, so the client never repeats it. A
definite rejection (`shipx_rejected`, a 4xx answer) deletes the row, and the
next click starts over. Any other failure of the create call (a timeout, a lost
connection, a 5xx answer, an unreadable body) may still have created the
shipment, so the row stays with `status: 'unknown'` and the attempt time, and
the request answers `shipx_unavailable` with `details.state: 'unconfirmed'`.

The next click reconciles before creating anything. The ShipX documentation
lists the organization's shipments (`GET /v1/organizations/<id>/shipments`)
with `page` and `per_page` but documents no filter by `reference`, so the
client pages through the newest shipments (`per_page=50`,
`sort_by=created_at`, `sort_order=desc`, `page` from 1), without a retry, and
matches `reference` with the order id. It stops at the first match, at the end
of the list, at a page whose last shipment was created more than 10 minutes
(a clock margin) before the recorded attempt, or after 5 pages. A match is
adopted: its id and status are stored and the flow continues with step 3. Without a match the request answers `conflict`
("ShipX did not confirm the previous attempt; check Manager Paczek") and the
order page shows that warning with **Discard the attempt and create again**.
That action (`POST /api/orders/<orderId>/shipx/discard`, `order:write`, CLI
`order shipx discard <orderId>`) deletes only a row that has no ShipX id and is
not in use by another request; the page then creates the shipment again. It
also clears a claim that a crashed request left before recording any create
attempt, which could otherwise block the order with an environment or
organization mismatch after the ShipX settings changed. The page offers the
action for every stored row without a ShipX id to staff who can create the
shipment. For an unconfirmed attempt the confirmation tells staff to check
Manager Paczek first, because a shipment that ShipX created but did not list
yet would be paid twice. For a claim without a recorded attempt no create
request was sent, so the confirmation says that InPost has no shipment for the
order.

### Concurrency

A request owns the row through its claim: a random `operation_token` and the
`operation_started_at` lease. Taking the claim is the `INSERT` of a new row or
one conditional `UPDATE` that succeeds only when `operation_started_at` is
`NULL` or older than the lease of 90 seconds; a request that finds the claim
held answers `fulfilment_conflict` ("Another request is creating the InPost
shipment for this order; refresh the order in a moment") without calling
ShipX. Taking the claim first locks the order row (`SELECT … FOR UPDATE`, the
lock a staff refund takes) and re-reads it; an order that is no longer paid and
`to_pack`, for example because a staff refund took it off the packing list
after the request read it, is refused with `conflict` and no claim is taken.
The lease is longer than the slowest request: the 20-second deadline
plus the last ShipX step: one call of at most 5 seconds, since no call in this
flow is retried, or the reconciliation lookup of at most 5 pages of 5 seconds
each.

Every later write of the request (the attempt, each ShipX state, the release
of a rejected attempt, and the final clearing of the claim) is a conditional
statement on the workspace, the order and the request's `operation_token`. When
another request holds the row by then, the write changes nothing, and the
request stops without calling ShipX again and answers `fulfilment_conflict`
with `details.state: 'lost_lock'`. A request that ends therefore never clears
or deletes the claim of the next one. A crashed or stuck request keeps the
lease until it expires after 90 seconds; its row then shows a ShipX id (the
next click continues), an unconfirmed attempt (the next click reconciles) or,
when it crashed before recording the attempt, neither (the next click creates;
the page also offers **discard** for it, which clears it when the settings
changed meanwhile). The refresh stores the live ShipX status only while no
request holds the claim and only when the row is unchanged since it was read
before the ShipX call; it never clears a stored tracking number and never
changes a bought row, so a slow read cannot overwrite a purchase that a
concurrent click confirmed.

### Shipment history

Every ShipX attempt step is recorded with the staff user who caused it in the
append-only `order_shipment_events` table, written in the same transaction as
the `order_shipments` change, so the row can be deleted on release or discard
without losing what happened. Each event stores the workspace, the order, the
ShipX shipment id known at that moment, the staff user, the request's
`operation_token` (when the step belongs to a claimed request) and a small
`details` object:

| Event | Written when | `details` |
| --- | --- | --- |
| `attempt_claimed` | a request takes a free claim (new or existing row) | `environment` |
| `lease_taken_over` | a request takes a claim whose 90-second lease expired | `previousOperationToken`, `previousOperationStartedAt` |
| `attempt_marked` | the attempt is recorded before the create call | `createAttemptedAt` |
| `shipment_created` | the create call answers and its ShipX id is stored | `status` |
| `shipment_adopted` | the reconciliation lookup finds the shipment and stores its id | `status` |
| `offer_bought` | the purchase time is stored for the first time (by the request or by the refresh) | `status`, `trackingNumber` |
| `payment_failed` | ShipX reports a failed payment or a dead offer, or refuses the purchase | `status`, `reason` |
| `attempt_released` | a rejected attempt, or a claim whose deadline passed before the create was recorded, is deleted without a ShipX id | `status`, `createAttemptedAt` |
| `attempt_discarded` | staff discard an unconfirmed attempt or a claim left before any create attempt | `status`, `createAttemptedAt` |
| `label_fetched` | a label is downloaded | none |
| `status_refreshed` | a ShipX read (a request's poll or the refresh) changes the stored status or tracking number | `from`, `to` (statuses), `trackingNumber` |
| `operation_finished` | a request clears its own claim at the end | `outcome`: `bought`, `pending`, `unconfirmed`, `released`, `lost_lock` or `failed` |

Every `order_shipments` change writes at least one event in the same
transaction. A ShipX read that reports the stored status and tracking number
again changes nothing and writes nothing. A request whose claim was taken over,
or whose attempt was already released, finds no row to clear and writes no
`operation_finished`. Events are never updated or deleted; they go only with
their workspace.

The shipment row stores only identifiers (the ShipX shipment id and the ShipX
organization id), the environment, the ShipX status, the tracking number and
the attempt, claim, purchase and label times; no personal data, so member
erasure does not touch it. The events add only staff user ids. The receiver data sent to InPost stays in the
workspace's Manager Paczek account, outside Together's erasure. There are no
ShipX webhooks.

### Label

**Print label** appears once the shipment has a tracking number. Studio calls
`POST /api/orders/<orderId>/shipx/label` (`order:write`) with the API client,
checks that the answer is `application/pdf` and saves it as a file; an error
answer is shown under the button instead of being saved. The route asks ShipX
for the A6 PDF (`POST /v1/organizations/<id>/shipments/labels` with
`{ "shipment_ids": [id], "format": "Pdf", "type": "A6" }`), checks the `%PDF`
signature and streams it as `attachment; filename=inpost-<tracking number>.pdf`
with `no-store`. The browser never sees a ShipX URL, so the content security
policy is unchanged. ShipX answers `invalid_action` for a shipment that is not
paid yet.

### Failures

| Situation | Result |
|---|---|
| the connection of the order's mode is not saved | `integration_not_configured` (HTTP 412, CLI exit 8) naming the connection |
| order not to pack, or already shipped | `validation` or `fulfilment_conflict` |
| delivery option not InPost, phone not a Polish number, building number missing | `validation` |
| another request holds the order's claim, or took it over during the request | `fulfilment_conflict` (HTTP 409, CLI exit 27) |
| the order was marked as shipped by hand while the shipment was bought | `fulfilment_conflict` with the tracking number |
| the stored shipment belongs to another connection than the order's mode uses, or to another organization | `conflict` (HTTP 409, CLI exit 6) |
| an earlier attempt is unconfirmed and ShipX lists no shipment for the order | `conflict` |
| ShipX refuses the request (4xx), the payment fails or the offer is unavailable or expired | `shipx_rejected` (HTTP 422, CLI exit 29) with the ShipX `error` key, a description of at most 300 characters and the field keys of `details`; the raw body is never stored or logged |
| ShipX does not answer within 5 seconds (body included), answers 5xx, or the shipment is not bought before the 20-second deadline | `shipx_unavailable` (HTTP 503, CLI exit 28) |

Every ShipX call has a 5-second timeout that covers reading the whole body
(JSON or PDF bytes). Shipment creation, offer purchases, shipment reads and the
shipment list are never retried by the HTTP client: a lost purchase answer is
followed by a fresh read, and the request continues from the status ShipX
reports. Only label downloads are retried once after a network error or a 5xx
answer; 4xx answers are never retried. Studio shows the error with the ShipX
reason under the button; the order stays to pack.

### First sandbox run

These details are taken from the ShipX documentation and are not yet confirmed
against the sandbox. The owner checks them on the first run with the sandbox
connection and a test-mode order:

- the label request with `format: "Pdf"` and numeric `shipment_ids` returns a
  PDF (`application/pdf`);
- the simplified creation buys the offer within the 20-second deadline; when
  it does not, the order page shows the pending status and a second click
  finishes;
- ShipX accepts the shipment without `custom_attributes.sending_method` (the
  documentation requires it only for Allegro services) and uses the
  organization's default;
- the receiver phone as 9 digits without `+48` is accepted;
- courier shipments are priced with the template dimensions and the fixed
  weight of 5 kg;
- the organization shipments list accepts `sort_by=created_at&sort_order=desc`
  with `per_page=50`, returns the newest shipments first and carries
  `reference` and `created_at` on each item, which the reconciliation of an
  unconfirmed attempt relies on;
- a transaction `failure` (for example an empty sandbox balance) is reported
  with the ShipX reason.

## Product safety information (GPSR)

Products have an optional `compliance` object with the manufacturer and safety
information the EU General Product Safety Regulation requires on the offer of
physical goods:

| Field | Values |
|---|---|
| `manufacturerName` | 1–200 characters |
| `manufacturerAddress` | 1–300 characters, postal address |
| `manufacturerEmail` | contact e-mail |
| `manufacturerOutsideEu` | `true` when the manufacturer is not established in the EU, `false` by default |
| `responsiblePersonName` | 1–200 characters, the responsible person in the EU |
| `responsiblePersonAddress` | 1–300 characters, its postal address |
| `responsiblePersonEmail` | its contact e-mail |
| `modelIdentifier` | 1–100 characters, model or type |
| `batchIdentifier` | optional, 1–100 characters |
| `safetyWarnings` | 0–5000 characters of Markdown, empty by default |
| `instructionsUrl` | optional HTTPS URL |

When `manufacturerOutsideEu` is `true`, the three responsible-person fields are
required, and each missing one fails validation with
`<field> is required when the manufacturer is outside the EU`. When it is
`false` they are optional, but given together or not at all, and the offer
does not show them. Safety information stored before these fields existed
reads as a manufacturer in the EU without a responsible person.

The field is accepted on every product type through the API, the CLI and the
import API; Studio shows the expandable **Product safety (GPSR)** section in the
product editor for physical products only. The workspace is responsible for the
content; the platform only validates the shape.

In that section the **The manufacturer is established outside the EU** switch,
its hint and, while it is on, the three responsible-person fields sit in one
group under a left rule. The name field says the responsible person is usually
the importer or the manufacturer's authorised representative in the EU, and the
address field asks for the country. Saving checks the draft against the same
schema: when a responsible-person field fails, the editor asks to fill in or
correct the responsible person and marks the failing fields; when another field
fails, it shows the manufacturer message; both show when both fail. While the
switch is off, the hidden responsible-person texts do not count, so clearing
every visible field removes the safety information.

The public offer returns `compliance` for each product with
`safetyWarningsHtml`, the warnings rendered by the server-side Markdown renderer
used for sales-link descriptions (links, emphasis and lists only; HTML and
images are escaped or dropped). Public sales-link offers carry `compliance` and
the product `coverUrl` on each line the same way. Both leave out
`responsiblePersonName`, `responsiblePersonAddress` and `responsiblePersonEmail`
while `manufacturerOutsideEu` is off; the stored values stay visible to staff in
Studio and the management API.

Regulation (EU) 2023/988 art. 19 says an online offer "shall clearly and
visibly indicate at least":

- (a) the manufacturer's name, registered trade name or trade mark, with its
  postal and electronic address;
- (b) where the manufacturer is not established in the Union, the name, postal
  and electronic address of the responsible person;
- (c) "information allowing the identification of the product, including a
  picture of it, its type and any other product identifier";
- (d) "any warning or safety information" to be affixed to the product or its
  packaging or included in an accompanying document, in a language consumers
  can easily understand.

The Together checkout page shows a compact **Product safety information**
section above the pay button, for every product type with `compliance`. Without
a click it shows, per manufacturer, the name, the postal address, the contact
e-mail and, when the offer sells more than one product, `applies to N products`
(a); for a manufacturer outside the EU, a **Responsible person in the EU** line
right under it with that person's name, postal address and e-mail (b), and when
the section shows a responsible person every manufacturer name in it carries a
**Manufacturer** label in the same form, the label in the line colour and the
name in the primary colour; then,
for each product of that manufacturer, a 40 px picture from the product cover
with the product title as its alternative text when the product has a cover,
the product title when the offer sells more than one product, the model
identifier (c), and the safety warnings as plain text when the workspace
entered any (d), so the section covers (a) to (d) without a click. A warning
longer than 280 characters shows its first three
lines with **Show more**, which extends the same text; while it is collapsed
the paragraphs of the warning sit without a gap, so the third line is never cut.
Screen readers read the whole warning either way. Products without warnings show
no warning line. When at least one product of a manufacturer has a picture, the
rows without one keep an empty 40 px slot hidden from assistive technology, so
the texts of one manufacturer start at the same edge.
Products whose manufacturer name, address and e-mail and whose responsible
person are identical share one manufacturer line.

**Details**, after a manufacturer's product rows and directly above its panel,
holds only what goes beyond that minimum: per product the batch and the
instructions link, with the product's title only when more than one product of
that manufacturer has them. A manufacturer whose products have neither shows no
**Details**. The cart checkout keeps one section per product, expanded for
physical products, with the responsible person under the manufacturer when it
applies, in the manufacturer's shape: a label, name and address row, then its
contact row right under it.
A sales link with any product that carries safety information never
takes the automatic `/offer/<slug>` handoff to Stripe: like shipped and
consent-bound products it stays on the Together page at `?checkout=together`,
so the section is shown before payment, and
`POST /api/public/sales-links/<slug>/checkout` refuses the link. The purchase
confirmation e-mail does not include it.

Product snapshots carry the descriptive fields, so the field was added in
product snapshot version 8 (`core/domain/snapshots/product/v8.ts`); version 7
snapshots read unchanged because the field is optional. The responsible-person
fields were added in version 11 (`core/domain/snapshots/product/v11.ts`); older
snapshots read with `manufacturerOutsideEu: false` and no responsible person.
The `compliance` column is JSON, so no migration was needed.

Rollback: the release before the responsible-person fields reads `compliance`
with a strict schema that knows none of `manufacturerOutsideEu`,
`responsiblePersonName`, `responsiblePersonAddress` and
`responsiblePersonEmail`, and every product read parses the row with it. Every
write of a product (Studio, the API, the CLI, the import API, change proposals
and restores) therefore stores none of the four keys while the switch is off
and no responsible-person field is given, so that release reads those products
unchanged; the domain and every API output still carry
`manufacturerOutsideEu: false`. A product with the switch on, or with a
responsible-person field, stores the four keys, and that release cannot read
it: reading that product, and every product list that includes it, fails.
Before rolling back to that release, find every product whose `compliance`
holds any of the four keys, whatever their values, and remove them; for a
product with the switch on, keep the responsible person's details elsewhere
first. Change proposals record safety information in the same stored form, so
a pending proposal on a product with the switch off applies under either
release; one on a product with the switch on is reported as stale after the
rollback and has to be submitted again. Product content versions written by
this release are snapshot version 11; that release refuses to open or restore
them as newer than its version 10 and leaves the rows intact.

## Product variants

Variants are separate products, each with its own price, stock, slug and
checkout. `variantGroup` (1–60 lowercase letters, digits and hyphens) links
products of one workspace; `variantLabel` (1–60 characters, for example
`Black · ASA`) names the variant. Studio shows both under **Variants** in the
editor of physical products; the API, the CLI and the import API accept them on
every product.

The public offer returns `variants: [{ productId, slug, label, soldOut, available }]` for a
product whose group has at least two published products, including the product
itself, in creation order; otherwise the list is empty. A variant without a
label uses its title. The checkout page renders the variants as chips under the
order summary row: the current product is selected, the others link to their own checkout
page (campaign parameters are kept), and a sold-out variant is disabled with
"Sold out". The sold-out flag and the `available` count are the public stock
of the sibling: a tracked variant without an available piece is sold out, an
untracked one never is and has `available: null`. The offer reads the stock of the offered products and of every published
sibling in their groups in one query.

A sibling sold only through sales links (sales channel `sales_links_only`) is
never offered as a variant of a standalone product; inside a sales link it is an
eligible variant like any other. See
[Products sold only through sales links](sales-links.md#products-sold-only-through-sales-links).

Sales-link offers, including one-line offers, show chips below each eligible
line name. A chip stays on `/offer/<slug>` and carries repeatable
`variant=<baseProductId>.<chosenProductId>` query parameters. Eligible siblings
are published products of the same workspace and variant group, with the same
type and delivery method, exactly one active non-imported one-time price in the
link currency, and resolvable VAT. Memberships are never eligible. Each chosen
product keeps its own price: the bundle total is the sum of the chosen prices.
Two lines cannot choose the same product; a sibling already chosen elsewhere
is disabled with "Already in the bundle". A simultaneous exchange is valid
when the final products are distinct. Sold-out siblings are disabled, but a
sold-out current variant does not prevent switching to an available sibling.
Any link with a line offering two or more eligible variants uses the Together
checkout, even when its saved base product is sold out. Choices survive Stripe
cancellation and Retry. Chip navigation reloads the form; typed details and
consent ticks are not preserved. See [Sales links](sales-links.md) for request
validation and checkout behaviour.

## Personalisation

A product may offer one optional request the buyer can add at checkout, with
text the buyer types, such as a dedication in a printed book or an engraving.
The seller decides whether asking for it carries a condition the buyer must
accept before paying. There is no surcharge, no stock effect and one request
per order line, not one per unit.

### Setting

`products.personalization` (migration 0160, nullable `jsonb`) holds
`{ label, description, inputLabel, maxLength, condition }` or `null`
(`productPersonalizationSchema` in `core/domain/personalization.ts`):

| Field | Rule |
|---|---|
| `label` | 1–80 characters, trimmed; the text next to the buyer's checkbox, for example "Add an engraving" |
| `description` | 0–1000 characters of plain text, default empty |
| `inputLabel` | 1–80 characters, trimmed; the label of the text field, for example "Engraving text" |
| `maxLength` | whole number 1–500, default 200; the longest text the buyer may type |
| `condition` | 1–1000 characters, trimmed, or `null` (default); when set, the buyer must tick it, for example "I understand a personalised item is made to my order." |

Unknown fields are refused. The seller's texts are stored as entered, in one
language, as plain text: never Markdown or HTML. A membership cannot offer a
personalisation (`validation` on every editing surface). `POST /api/products`
and `POST /api/products/update`, the keyed `/api/m2m/shop/products` routes,
the [import API](import-api.md#product) and the
[shop manifest](shop-manifest.md) accept `personalization`; an update without
the field keeps the stored value and `null` removes it. Studio shows the
section **Personalisation** in the product editor (not for memberships) and
sends the field only after the seller has edited the section.

The setting is checkout configuration, not product content: like stock it is
not part of the product snapshot (`core/domain/snapshots/product`), so
restoring a product version never changes or removes it.

The public offer and the sales-link offer expose it per product (per line) as
`personalization: { label, description, inputLabel, maxLength, condition } | null`.

### The Together checkout page is required

`requiresWorkspaceCheckout` (`core/domain/shipping.ts`) is true for a product
with a personalisation, as it is for shipped products, products with safety
information and products with purchase consents. A sales link with such a
product keeps `/offer/<slug>?checkout=together` instead of the automatic Stripe
handoff, and `POST /api/public/sales-links/<slug>/checkout` refuses it with
`validation` ("This sales link requires the workspace checkout page"). On the
Together page each line that offers a personalisation shows one checkbox with
the seller's label and description; ticking it reveals the text field with the
seller's input label, a character counter and, when a condition is set, a
second checkbox with the condition text.

### Checkout request

`POST /api/public/checkout/session` takes optional
`personalizations: [{ productId, text, conditionAccepted }]`, at most 20
entries, each strict. One entry means the buyer ticked the option for that
product; for a sales link with variant choices `productId` is the chosen
product. The single-product, sales-link and simulated checkouts validate it
with the current product setting before any checkout snapshot, consent capture,
coupon session, stock reservation or Stripe session is written:

| Request | Result |
|---|---|
| no `personalizations`, or an empty array | the checkout of today, unchanged |
| entry for a product outside the selection | `validation` |
| two entries for the same product | `validation` |
| entry for a product without a current setting | `validation` |
| trimmed text empty or longer than the current `maxLength` | `validation` |
| condition set and `conditionAccepted` not `true` | `validation` |
| `personalizations` on a cart request (`lines`) | `validation` |
| `personalizations` with a recurring (subscription) price | `validation`; the checkout page does not offer the option while a recurring price is selected |

The cart is out of scope: a cart with a personalisable product checks out as
before, without the option. The text never goes to Stripe (neither line items
nor metadata), application logs, telemetry attributes or analytics events.

### Proof on the snapshot and the order

The checkout snapshot line (`checkout_snapshots.lines`, `OrderLine`) receives
`personalization`:

| Field | Value |
|---|---|
| `text` | the trimmed buyer text |
| `label`, `description`, `inputLabel`, `condition`, `maxLength` | the wording of the product setting at that moment |
| `requestedAt` | server time of the request |
| `conditionAcceptedAt` | server time when a condition existed and was accepted, otherwise `null` |
| `originalText`, `editedAt`, `editedBy` | set only after a staff correction |

A later edit of the product setting does not change a captured line. The
consent capture row of the same request already holds the buyer's IP address
and user agent; the personalisation adds no consent definition. Every path that
creates an order from a checkout copies the snapshot line onto the order line:
the Stripe webhook, free and coupon-claimed orders, staff test-mode purchases
and the simulated purchase.

### Orders

Order list and detail answers, the keyed shop order routes and the
[order change feed](shop-integration.md#follow-order-changes) return
`lines[].personalization`. The orders list in Studio marks such orders with a
**Personalised** chip (derived from the lines; the list adds no separate
field), and the order detail shows a **Personalisation** block under the line
with the seller label, the text, the accepted condition and its time
(Europe/Warsaw) and, after a correction, the original text, the correction time
and the staff user id.

The packing list ends with a `personalization` column, the CSV export carries it just before `cancel_reason`, and
the JSON export adds a `personalization` field: one `<line name>: <text>` per
personalised line, joined with `; `, empty otherwise. CSV cells go through the
same formula guard as every other cell.

### Staff correction

`POST /api/orders/<orderId>/personalization` with `{ productId, text }` needs
`order:write`, the capability of marking an order as shipped. The text is
trimmed and must have 1 to the stored `maxLength` characters. In one
transaction the order row is locked, `originalText` is set on the first
correction only and never overwritten, and `text`, `editedAt` and `editedBy`
(the staff user id) are set. A line without a personalisation is `validation`,
an unknown order `not_found`. The update of the order row produces an order
change feed entry through the existing trigger. The condition and its
acceptance cannot be edited.

### Purchase confirmation

The purchase block of the `welcome-sign-in` e-mail shows, after the items, one
paragraph per personalised line with the heading "Personalisation: <line
name>", the text and, when a condition existed, "Condition you accepted:
<condition>"; the Polish labels are the `purchase.personalization` and
`purchase.personalizationCondition` keys of the Polish e-mail dictionary. All values are
escaped like the other e-mail values.

### Erasure

[Member erasure](member-erasure.md) replaces `text` and `originalText` with the
deleted-member label on the member's order lines, on the checkout snapshots
bound to those orders' checkout sessions, and in the purchase confirmation
payloads of queued and sent e-mails to the member, like the delivery name. An
abandoned checkout snapshot is bound to no member and keeps its text.

### Wording

Platform wording around the option gives instructions and data labels only. It
never states a legal rule, such as a return or withdrawal right: such wording
belongs in the seller's `condition`.

## Content security policy for the parcel locker map

Following the owner decision of 2026-11-05, the page injects
`https://geowidget.inpost.pl/inpost-geowidget.js` (with `defer`) and
`https://geowidget.inpost.pl/inpost-geowidget.css` on demand, only when all of
these hold: the workspace has a Geowidget token, the buyer has chosen a parcel
locker option and opened the parcel locker picker, the checkout runs in live
mode (the Stripe test-mode switch is off), and the viewer holds no staff session
(owner or admin) for the workspace.
The page learns the last two from `GET /api/public/payment-config`: `canTest`
is true for a signed-in owner or admin of the workspace, and `testEnabled` for
the session-bound test-mode switch. Owners and admins, who use `/checkout/*`
and `/offer/*?checkout=together` for test-mode purchases, never load the map:
their delivery step shows only the locker code input with the hint "The
parcel-locker map is available to buyers; enter the locker code." As defence in
depth the endpoint itself returns `inpostGeowidgetToken: null` with
`inpostGeowidgetWithheld: true` to a staff session, and to an owner or admin
viewing the workspace as a member (impersonation), so the page shows the same
hint without the map.

Following the same decision, the checkout form documents add
`https://geowidget.inpost.pl` to `script-src` and `style-src`:

- `/checkout/<productRef>` and the hosted cart page `/checkout/cart/pay`
  without `status=success`;
- `/offer/<slug>?checkout=together` and `/offer/<slug>?status=cancelled`.

The server middleware (`apps/server/src/app.ts`) and the static hosting headers
(`vercel.json`) apply the same rule. No `connect-src` change is part of it: each
document keeps its base value, `'self' https:` on `/checkout/*` documents and in
the static hosting headers, and `'self' https://*.sentry.io` on `/offer/*`
server responses. On a server-rendered `/offer/*` form document the map may
therefore fail to reach InPost's API; the buyer then enters the locker code in
the typed input, which the delivery step always offers. `img-src` already allows
`https:`. Success documents keep the
analytics policy described in [Security](security.md) and never allow the map
origin. No other document allows it; `vercel.json` keeps its policy entries
mutually exclusive, so header precedence cannot hand the map origin to a success
document.

The injected script cannot be unloaded, so once the map has been shown, leaving
the form document by an in-app link, programmatic navigation or browser history
step becomes a full document navigation (the same guard as the analytics success
document). The guard stays in place after the buyer closes the picker or
switches to another delivery option, so the map code never runs in sign-in or
signed-in views. The page keeps one such guard however often the picker is
opened. The history entry the open picker adds keeps the same address,
so the back gesture that closes the picker is not a navigation away from the
form document.

Follow-up: a browser check on staging lists the exact origins the map calls;
any `connect-src` change for them needs a separate owner decision.

## CLI

```bash
pnpm --silent run cli --tenant acme tenant settings-set \
  --shipping-rates '[{"id":"locker","label":"Parcel locker","amountCents":1499,"carrier":"inpost","pickupPoint":"inpost_locker","active":true}]' \
  --inpost-geowidget-token '<public token>'
pnpm --silent run cli --tenant acme tenant settings-set \
  --checkout-return-origins 'https://shop.example.test,https://www.shop.example.test'
pnpm --silent run cli --tenant acme product create --title 'Printed holder' \
  --type physical --delivery-method shipping --price-cents 4900
pnpm --silent run cli --tenant acme product update <id> --delivery-method pickup
pnpm --silent run cli --tenant acme checkout session --product <id> \
  --shipping-rate locker --pickup-point WAW01M
pnpm --silent run cli --tenant acme checkout session --line <id>:2 --line <other-id>:1 \
  --shipping-rate locker --pickup-point WAW01M
pnpm --silent run cli --tenant acme simulate-purchase --email buyer@example.com \
  --product <id> --shipping-rate locker --pickup-point WAW01M
pnpm --silent run cli --tenant acme orders list --fulfilment to_pack
pnpm --silent run cli --tenant acme orders packing-list --format csv --out packing-list.csv
pnpm --silent run cli --tenant acme orders packing-list --format csv --mode test
pnpm --silent run cli --tenant acme orders ship <orderId> --carrier inpost --tracking 520000011395200025754311
pnpm --silent run cli --tenant acme orders list --fulfilment shipped
pnpm --silent run cli --tenant acme tenant shipx-set --slot sandbox \
  --organization-id 1234 --token-env SHIPX_SANDBOX_TOKEN
pnpm --silent run cli --tenant acme tenant shipx-set --slot production \
  --organization-id 5678 --token-stdin < shipx-production-token.txt
pnpm --silent run cli --tenant acme tenant shipx-set \
  --sender '{"name":"Anna Sender","email":"shop@example.com","phone":"500600700","street":"Example Street","buildingNumber":"7","city":"Warsaw","postCode":"00-001"}'
pnpm --silent run cli --tenant acme tenant shipx-set --slot sandbox --clear-credentials
pnpm --silent run cli --tenant acme tenant shipx
pnpm --silent run cli --tenant acme product update <id> --parcel-template large
pnpm --silent run cli --tenant acme --json order shipx show <orderId>
pnpm --silent run cli --tenant acme --json order shipx refresh <orderId>
pnpm --silent run cli --tenant acme --json order shipx create <orderId>
pnpm --silent run cli --tenant acme order shipx label <orderId> --out label.pdf
pnpm --silent run cli --tenant acme order shipx discard <orderId>
pnpm --silent run cli --tenant acme product update <id> \
  --compliance '{"manufacturerName":"Example Workshop","manufacturerAddress":"Example Street 1, 00-001 Warsaw","manufacturerEmail":"safety@example.com","modelIdentifier":"STAND-1"}' \
  --variant-group printed-stand --variant-label 'Black · ASA'
pnpm --silent run cli --tenant acme product update <id> --personalization-file engraving.json
pnpm --silent run cli --tenant acme product update <id> --no-personalization
pnpm --silent run cli --tenant acme checkout session --sales-link <link-id> --product <id> \
  --personalization '<id>:For Ann' --accept-condition
pnpm --silent run cli --tenant acme orders personalization <orderId> <productId> --text 'For Anna'
```

`--shipping-rates` replaces the whole list; an empty string for
`--inpost-geowidget-token` clears the token. `--checkout-return-origins` replaces
the list of shop origins that checkout return and cancel addresses may use
(see [Return and cancel addresses](shop-integration.md#return-and-cancel-addresses));
an empty string clears it. `--pickup-point` needs
`--shipping-rate`. `checkout session --line <product-id>:<quantity>` posts a
cart; repeat it once per product and leave out `--product` and `--sales-link`
(see [Cart: several products and quantities](shop-integration.md#cart-several-products-and-quantities)).
For an order with a line above one unit, `orders list` shows its product lines
as `2 × Title; Title`; other orders keep the product title. For a manufacturer
outside the EU, `--compliance` adds `"manufacturerOutsideEu":true` with
`responsiblePersonName`, `responsiblePersonAddress` and
`responsiblePersonEmail`. `--compliance null` removes the safety information and
`--clear-variant` removes the variant group and label. `product create|update
--sales-channel sales_links_only` limits a product to sales links (see
[Products sold only through sales links](sales-links.md#products-sold-only-through-sales-links));
`--sales-channel any` lifts the limit. `product create|update
--personalization-file <path>` sets the [personalisation](#personalisation)
from a JSON file (`{ "label", "description", "inputLabel", "maxLength",
"condition" }`, validated before the request) and `--no-personalization`
removes it; the two flags exclude each other. `checkout session` and
`simulate-purchase` take a repeatable `--personalization <product-id>:<text>`
(the text is everything after the first colon) and `--accept-condition`, which
accepts the condition of every entry; `checkout session --line` refuses
`--personalization`. `orders personalization <orderId> <productId> --text
<text>` corrects the text of an order line. `order` is an alias of
`orders`. `tenant shipx-set --slot <sandbox|production>` names the connection
that `--organization-id`, `--token-env`, `--token-stdin` and
`--clear-credentials` change, and is required with them; the other connection
stays as it is. The token is read from the named environment variable or from
stdin, never from a flag, so it does not reach the shell history.
`--sender` needs no slot, and `--sender null` removes the sender so InPost uses
the organization data. `tenant shipx` prints both connections with masked
credentials and the sender.

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
example damaged goods); a later commit of a live hold then records `oversold`
and alerts, while a late payment that no longer fits cancels the order (see
Payment and expiry).

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

1. `validateCheckoutSelection` (`validateCartSelection` for a cart) reads the
   stock of the selected products and returns `sold_out` early when any tracked
   product has fewer available pieces than requested (the line quantity of a
   cart, one per product otherwise). This read is advisory only.
2. After the checkout snapshot is captured and before the Stripe session is
   created, `StockRepository.reserve` reserves the quantity of every tracked
   product line of the snapshot (a line without a quantity counts as one piece;
   only a cart request sets a quantity, at most 10 per physical line while this
   hold applies) in one transaction,
   updating products in product-id order so concurrent multi-product
   reservations cannot deadlock. Repeated products in one call are merged into
   one reservation of the summed quantity. The conditional update is the only
   authority:

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
  drop by the reserved quantity;
- a `committed` reservation is left unchanged, so webhook retries are safe;
- a `released` reservation (the session outlived the sweep) becomes
  `committed` with a `committed_late` event and `on_hand` drops by the
  reserved quantity;
- a tracked product of the snapshot without any reservation (orders started
  before tracking) is committed late by the quantity of its snapshot line,
  recorded as a `committed` reservation of that quantity;
- an order without a checkout snapshot is committed late once: a retry finds
  the earlier commit event of that order and changes nothing;
- when `on_hand` would go below zero for a line held by the snapshot's own
  `active` reservation it is clamped at zero, an `oversold` event is appended,
  a warning is logged and the low-stock e-mail carries the oversold flag.

Before any of this, still inside the payment transaction and before the buyer
is enrolled, `StockRepository.lockForCommit` locks the snapshot's reservations
and the stock rows in product-id order and checks every tracked line that is
not covered by the snapshot's own `active` or `committed` reservation (a
`released` reservation, a line without one, an order without a snapshot)
against `on_hand - reserved`. The locks stay held until the payment transaction
ends, so two payments for the last piece are serialized. When any line is
short the whole order is cancelled and nothing is decremented:

- the order is recorded as `paid` with `cancel_reason = 'out_of_stock'`
  (the money arrived) and without a fulfilment status, so it never reaches the
  packing list or a ShipX shipment;
- every reservation of the snapshot that is still `active` (a line that fitted
  while another did not) is released with reason `out_of_stock`, so the public
  available count shows those pieces again at once instead of after the hold
  expires;
- the buyer becomes a member because the order needs one, but no product is
  granted, no purchase or welcome e-mail is queued, no automatic invoice job is
  queued and the order is never eligible for Meta conversions;
- one `order_refund_jobs` row is inserted in the same transaction (`pending`,
  the full paid amount, base idempotency key `oos-refund-<orderId>`, unique per
  order); an order paid with zero gets no job;
- staff get the `order-out-of-stock` e-mail (support address, or every staff
  member in their language) with the short products, the amount being refunded
  (or that nothing was charged, for an order paid with zero) and a Studio link
  to the order;
- the buyer gets the `order-sold-out-refund` e-mail (see Buyer communication
  below), queued in the same transaction.

A later event for a checkout session whose order is already cancelled changes
nothing. Recurring prices keep the commit above.

#### Automatic refund of a cancelled order

`dispatchOrderRefundJobs` runs on the existing minute tick (the
`/api/internal/dispatch-email` cron route and the Node ticker) after e-mail
dispatch has finished and before the Meta CAPI dispatch, so a slow or failing
refund run never holds e-mail back, and is also started right after a webhook
queues a refund job; a failing kick or tick is logged and never fails the
webhook response, the e-mail dispatch or the Meta CAPI dispatch. It handles at
most 25 due jobs per run (one on the cron tick, see below) and claims a job only
when the worst case of that job still ends before the run's deadline; jobs it
did not claim stay due for the next tick. When a run stops with due jobs left,
whether the job cap or the deadline stopped it, it logs one warning naming the
reason and their number (`[order-refund] run stopped by <cap|deadline>, <n> due
refund jobs left for the next run`); a run that leaves no due job logs nothing. The minute tick sets the deadline 45 seconds after the tick request
started, so the notification fan-out, the stock sweep and the e-mail dispatch
that run first use part of it; a run started any other way (the kick after a
webhook, the Node ticker) gets 30 seconds from its own start.

The worst case of a job: a job makes at most two Stripe calls (the refund list
and the create call, or one refund list for a status read) while the payment
has at most 100 refunds. A longer refund list is read page by page (100
refunds a page, at most 10 pages), one more call per page, and never past a
deadline: the job's deadline is the run's deadline, and on the cron tick at
most 21 seconds after the job was claimed. The first page is read at once (claiming
the job already made room for it); the list stops before any further page that
could not end by that deadline less the worst case of the create call (a status
read keeps no time for one), so the job still ends by its deadline. For a
sold-out job a list cut short this way, or longer than 1,000 refunds, counts as
a list that could not be read (a temporary failure, retried on the schedule
below), never as Stripe refusing the refund; on the cron tick this leaves a
payment with more than 100 refunds to be refunded by the kick after a webhook
or the Node ticker, whose 30-second runs leave room for more pages. A staff
refund treats such a list as sufficient (decision D20): Stripe lists refunds
newest first and its own refund is always made by its own job, so it is
matched among the newest refunds; a create call made while its own refund is
not among them is still capped by Stripe at what is left on the charge; and the
rule that ends a staff refund once refunds made outside the platform cover the
whole charge only applies to a complete list. A staff refund of a payment with
a long refund history therefore completes on cron ticks alone. Every refund call has a 5-second
timeout and no network retry (the SDK's per-request `timeout` and
`maxNetworkRetries: 0`). stripe-node still repeats a request once when its
connection was reset (`ECONNRESET` or `EPIPE`), after a 0.5-second pause, so a
call takes at most 2 × 5 s + 0.5 s = 10.5 s and a job at most 2 × 10.5 s =
21 s. The Meta CAPI dispatch that follows on the cron tick has its own
20-second budget (it starts a Meta request only while its 5-second timeout fits
in it). Two refund jobs (2 × 21 s = 42 s) plus that budget would already
outlast the 60-second function limit, and a refund backlog that kept every tick
busy until the 45-second deadline would leave Meta CAPI no time on any tick, so
the cron tick claims at most one refund job: with the fan-out, the stock sweep
and the e-mail dispatch taking t seconds, the refunds end by t + 21 s and Meta
CAPI by t + 41 s, inside the 60 seconds while t stays under 19 seconds. A job
is still claimed only when its worst case ends by the 45-second deadline (at
most 24 seconds after the tick started); when the work before the refunds
takes longer, the tick claims no refund job. Further due jobs wait for the next
minute or are taken by the kick after a webhook (up to 25 jobs in 30 seconds).
The Node ticker has no function limit and keeps the 25-job cap. Network retries
stay at 0 because any further SDK retry may wait for a `Retry-After` of up to
60 seconds. On Node the SDK's timeout restarts at each
stage of a request (connecting, sending, waiting for the answer), so a call
that is slow at every stage can outlast its 5 seconds; the arithmetic counts
one timeout per request. A refund request that gets no answer has an unknown
outcome and is retried with the same key. Each job is claimed with `FOR UPDATE SKIP LOCKED`
and a conditional update (`pending` becomes `running` with a 10-minute lease and
one more attempt), so two runs never work on the same job; a `running` job
whose lease expired goes back to `pending` and is retried with the same key.

For each claimed job the dispatcher reads the order of that workspace again:

- it lists the payment intent's refunds (`GET /v1/refunds`, covered by the
  Charges and Refunds permission). A listed refund whose metadata names this
  order (`orderId`) and the job's reason (`reason`) was issued by the job
  itself, for example by a call whose answer never arrived; every other listed
  refund was made outside the job, such as by hand in the Stripe Dashboard;
- it adds up every listed refund that is not `failed` or `canceled`. The
  refund list decides, not the order status. When that sum covers the job's
  amount, no refund call is made: the job ends as `skipped_refunded` only when
  refunds with the status `succeeded` cover the whole amount and none of them
  is the job's own; when the job's own refund is among them it takes that
  refund over (stores its Stripe id and status) and becomes `succeeded`, or
  `submitted` while any refund it relies on is still `pending` or
  `requires_action`. A job that relies on such a refund made outside the job
  becomes `submitted` without a Stripe refund id of its own and is watched by
  the status reads below like its own refund. A job's own refund that is
  `failed` or `canceled` ends the job as `failed` with a staff alert;
- when the sum falls short, it refunds the remainder through `POST /v1/refunds`
  with the payment intent, the workspace's restricted key in the order's mode
  and the job's current idempotency key, stores the Stripe refund id and status
  and marks the job `succeeded` (or `submitted` while Stripe reports that
  refund, or a refund made outside the job that the job relies on, as pending).
  When staff refunded part of the payment by hand, or a hand refund failed
  later, only the remainder is refunded. When the job's own refund is already
  listed but no longer covers the remainder (a hand refund failed after it was
  made), the remainder is refunded under the next key generation. A list call
  that fails is settled like a failed refund call (retried, blocked, or
  `failed` with a staff alert), also for an order already `refunded`. The
  existing `charge.refunded` handler marks the order `refunded`;
- a temporary Stripe failure or a short available balance is retried 1 min,
  5 min, 30 min, 2 h and 6 h later, then every 12 h until seven days after the
  job was queued; the job then ends as `failed`. The delay follows the number
  of consecutive temporary failures (`transient_failure_streak`), not the
  number of attempts: any other outcome, such as a missing permission, resets
  it, so the first temporary failure after hourly permission refusals is
  retried a minute later;
- a charge Stripe reports as already refunded (`charge_already_refunded`) is
  watched like a job that relies on a refund made outside the job: it becomes
  `submitted` and the status reads decide from the refund list; a missing
  payment intent, a refund Stripe rejects for good or an order that is
  not cancelled ends as `failed` at once;
- a key without the Charges and Refunds (write) permission moves the job to
  `blocked_permission` and retries it every hour for 72 hours from the first
  refusal; adding the permission in the Stripe Dashboard lets the next hourly
  attempt pay the refund. After 72 hours the job ends as `failed`, except when
  the order is already `refunded` (a `charge.refunded` reported a full refund
  made outside the platform) and the key either may not list the payment's
  refunds or the list shows no failed or canceled refund that would explain
  the shortfall: the job then ends as `unconfirmed` with the `unconfirmed`
  alert, because the platform cannot tell whether that refund succeeded and
  staff check it in the Stripe Dashboard. When the list shows that the hand
  refund failed, the job ends as `failed` as usual. The time of the first refusal
  (`permission_blocked_at`) is kept until a refund is issued, so a refusal
  after a temporary failure neither restarts the 72 hours nor sends a second
  alert.

Idempotency keys: the job keeps a key generation, starting at 0. Generation 0
sends `oos-refund-<orderId>`, generation n sends `oos-refund-<orderId>-<n>`.
Stripe saves the first response under a key once the endpoint starts executing,
errors included, and keeps keys for at least 24 hours, so resending a key after
an error answer only replays that error. The dispatcher therefore keeps the
same key only when the outcome of the last call is unknown: no HTTP answer
(timeout, connection error, an aborted request or a lease that expired while a
call was running) or a `409 idempotency_key_in_use`, which means the first
request with that key is still executing. After any other error answer the
next attempt uses the next generation. A second refund cannot follow: every
attempt first lists the payment's refunds, takes over one the job issued under
any key generation and subtracts the others, and Stripe never refunds more than
the charge (`charge_already_refunded` makes the job watch the refund list). The
same key is never sent with a different amount: a refund call that is retried
with the same key is preceded by a refund list, and when that list shows the
job's own refund from the unanswered call, or a status read sends the job back
to refund the remainder, the next key generation is used. Should Stripe still
answer an `idempotency_error` (the key was sent before with other parameters,
for example after a crash between the refund call and saving its result while
a hand refund changed the remainder), the job is not failed: it stays
`pending`, moves to the next key generation and tries again at once, after a
fresh refund list.

Staff get the `order-refund-alert` e-mail (support address, or every staff
member in their language) on the first failed attempt, on the first missing
permission (add the permission; waiting refunds are paid by the next hourly
attempt), when a job ends as `failed` (a separate message when the permission
was still missing after 72 hours), when a refund fails after it was issued and
when a refund ends `unconfirmed`. The alert rows are written to the e-mail
outbox in the same database transaction that saves the job's new state, under
the outbox id `order-refund-alert:<jobId>:<alert>:<attempt>:<recipient index>`.
When the staff lookup or the outbox write fails, nothing of that settlement is
saved: the job keeps its previous state, is due again a minute later and the
Stripe call or status read is repeated with the same idempotency key, so the
state change and its alert are saved together on a later tick. Studio shows
the job state, attempts, next attempt, Stripe refund and last error on the
order page. A `failed` job is resolved by refunding the payment by hand in the
Stripe Dashboard (the order then becomes `refunded`). Requeueing a failed job
from Studio is not available yet.

When `charge.refunded` reports a full refund of a cancelled order, the same
payment transaction marks the order `refunded`, moves a `failed` job to
`resolved_externally`, and makes a `pending` job and a `blocked_permission` job
without a Stripe refund of its own due at once (their next attempt time
becomes now, their status stays) and starts the dispatcher, whose refund list
then decides: a hand refund that already `succeeded` ends the job as
`skipped_refunded`, one still `pending` makes the job watch it (and reopen it
should that refund fail), and the job's own refund is taken over. The event
itself never ends a `pending` or `blocked_permission` job, because a hand
refund it reports may still be pending when the event fires and fail later; a
key that may list refunds but not create them still settles the job from the
list. A `failed` job is resolved because the dispatcher never picks a failed
job again either, so without this the order page in Studio would keep showing
the failed refund after staff refunded the payment by hand. Every other job is
left as it is: a `submitted` or `succeeded` job keeps its scheduled status
reads, a `running` job keeps its lease, and a `blocked_permission` job that
already holds a Stripe refund of its own is settled by its next hourly
attempt, whose refund list tells the job's own refund (taken over and tracked)
from one made by hand (subtracted from the amount to refund). A refund or
dispute of a cancelled order revokes no access, because the cancelled order
granted none.

A cancelled order never counts as a purchase: it keeps no access when another
order for the same product is refunded, is not listed under My products, is
not reported by order reconciliation as a paid order missing its grant, is
never the order a download copy is attributed to, is left out of the Studio
30-day revenue summary from the moment it is cancelled, cannot be invoiced by
hand (requesting or sending an invoice is refused with a `conflict` error), and
its physical lines cannot be handed over at pickup (the verification page shows
the cancellation and no issue button).

Stripe does not send `refund.failed` to the platform (the event is not
subscribed), so the dispatcher reads the payment's refunds again 24 hours and
7 days after the job issued its refund or started relying on a refund made
outside the job. Each read lists every refund of the payment intent, not only
the job's own:

- the job's own refund reported as `failed` or `canceled` marks the job
  `failed` and alerts staff to return the money another way;
- when a refund made outside the job failed or was canceled and the refunds
  that are not `failed` or `canceled` no longer cover the job's amount, the
  job goes back to `pending`, due at once, and refunds the remainder under the
  next key generation (a new 24-hour and 7-day read schedule follows);
- when refunds with the status `succeeded` cover the amount, the job is
  `succeeded` (with its own refund) or ends as `skipped_refunded` (refunds made
  outside the job only);
- a refund the job relies on that is still `pending` or `requires_action` at
  the 7-day read, and refund lists that keep failing (retried hourly) until
  8 days after the job issued or observed the refund, end the job as
  `unconfirmed`: staff get an alert to check the refunds in the Stripe
  Dashboard and return the money another way if one failed, and the
  dispatcher stops reading them.

#### Buyer communication for a cancelled order

The buyer's `order-sold-out-refund` e-mail is queued with the order in the
payment transaction under the outbox id
`order-sold-out-refund:<workspaceId>:<orderId>`, so it is sent once per
cancelled order: a repeated or later event for the same session queues nothing
new. It goes to the member's address in the member's language, then the
checkout language, then the workspace default (English or Polish), with the
workspace branding. It says the whole order was cancelled because the goods
sold out before the payment completed, lists the sold-out products and says a
full refund of the paid amount was started automatically, with the usual
timing by payment method from Stripe's documentation: a card refund made soon
after the payment usually shows as a reversal, otherwise as a separate credit
after about 5-10 business days; BLIK about 120 minutes; Przelewy24 a separate
transfer within 3 business days; other methods depend on the provider. An order
paid with zero says nothing was charged instead.

`GET /api/public/checkout/session-status` returns
`{ "status": "cancelled", "charged": true }` for such an order, whether it is
still `paid` or already `refunded`, without the purchase analytics payload and
without the Meta conversion consent payload; `charged` is `false` for an order
paid with zero. The hosted success page (`status=success`) then stops polling
and shows the sold-out message without the sign-in button, saying that the
refund was started, or that nothing was charged when `charged` is `false`, with
a "Back to shop" link to the workspace home (a full document navigation) and,
when the workspace has a support address, a "Contact the seller" link; it
sends no purchase event. The
document keeps its script policy: the analytics libraries may still load as on
any success return, and the full-navigation exit rule is unchanged.

Studio shows a "Cancelled: sold out" badge, with the state of the automatic
refund job, in the order list (status column) and on the order page.

`checkout.session.expired` is not handled. The expiry sweep
`releaseExpiredStockReservations` runs on the existing minute tick (the
`/api/internal/dispatch-email` cron route and the Node ticker) before e-mail
dispatch. It releases at most 100 expired `active` reservations per run, oldest
first, each in its own transaction, and logs one line when it released any. A
failing sweep is logged and never stops that tick's e-mail dispatch.

Refunds never change stock, except a full staff refund with stock return (see
Staff refunds below). Staff put goods back with an adjustment whose
reason is `returned` (recorded as a `returned` event).

#### Staff refunds

An owner or admin can refund a paid order from Studio or the CLI, in full or in
part, through the workspace's own Stripe key of the order's mode. The refund
runs through the same dispatcher, idempotency keys, retries, permission
handling, staff alerts and status reads as the sold-out refund above; there is
no second refund path. Staff refunds are stored in their own table,
`order_staff_refunds`, which the previous release never reads, so a rollback
cannot stop the sold-out refunds; staff refunds waiting to reach Stripe then
wait until the release is back.

An order can be refunded by staff when it is `paid`, `partially_refunded` or
`refunded`, was paid through Stripe with a payment intent, was paid more than
zero, was not cancelled because its goods sold out (its own job refunds it) and
something is left to refund. Anything else is refused with `conflict` or
`validation` and a sentence naming the reason. The refundable remainder is the
paid amount minus the larger of the refunds Stripe lists for the payment (not
`failed` or `canceled`) and the staff refunds the platform recorded that may
still move money; when Stripe's list cannot be read, the platform's records
decide and the preview says so, and Stripe still refuses anything above the
charge. An order marked `refunded` keeps a remainder only when its latest staff
refund is a full refund that Stripe failed or canceled after it was issued
(the platform saw it fail, decision D21): the remainder is at most that refund's
amount and, when Stripe's list can be read, at most the sum of the failed or
canceled refunds it shows. Any other order marked `refunded`, for example after
a dispute, also one whose older partial staff refund failed, has nothing left
to refund.

- **Every staff refund issues exactly its stored amount, once.** Its own
  Stripe refund is the one whose metadata `refundJobId` names the staff refund,
  or whose id was stored. A staff refund never re-derives its amount from other
  refunds, never pays another refund's shortfall and never reopens because
  another refund failed; a staff refund that fails alerts staff about its own
  amount.
- **Full refund** (no amount): the remainder computed under the order lock when
  it is requested, stored as a remainder refund (`kind = remainder`, which
  offers the stock and packing choices below). The request names the remainder
  staff confirmed in `expectedAmountCents`; when the remainder changed since
  (another refund failed, was issued or was made in the Stripe Dashboard), the
  request is refused with `conflict`, a message naming the current remainder
  and `details.remainderCents`, and nothing is stored. A dashboard refund made
  after the request that leaves less on the charge than the stored amount makes
  Stripe refuse the refund: it ends `failed`, nothing is refunded, no buyer
  e-mail is sent and the staff alert names the stored amount and says nothing
  was refunded. A dashboard refund that fails after a staff refund was
  paid is not paid again by the platform.
- **Partial refund** (any typed amount, also one equal to the remainder):
  stored as an amount refund; `expectedAmountCents` may be left out or must
  equal the amount. Partial refunds may follow each other.
- **Remainder seen**: every new request names the remainder staff saw in
  `expectedRemainderCents` (a full refund may name it in `expectedAmountCents`
  alone; when it sends both they must be equal). Under the order lock a request
  whose remainder differs is refused with `conflict`, a message naming the
  current remainder and `details.remainderCents`, and nothing is stored, so a
  typed amount that a dashboard refund made after the preview turned into the
  whole remainder never ends access or a subscription without staff seeing it.
  Studio reloads the preview and the CLI prints the new one. A request without
  the field is refused with `validation`, except a replay of a stored refund by
  its request key.
- **Already refunded**: when Stripe answers that the charge is already refunded
  (dashboard refunds cover it), the staff refund has no refund of its own and
  keeps watching. Once dashboard refunds that have succeeded cover the whole
  charge it ends `skipped_refunded`; while such a dashboard refund is still
  pending it keeps watching, and it issues its own amount if that refund fails,
  waiting an hour at a time while another staff refund of the order is waiting
  to reach Stripe.
- **Unknown outcomes**: before every create call the dispatcher saves, under
  the job's lease, that a create attempt is under way
  (`create_outcome_unknown`) together with the key generation it uses; a worker
  lost after Stripe accepted the refund therefore leaves the attempt recorded,
  and a dispatcher that lost the lease sends no request. A staff refund whose
  create call got no answer, a `409 idempotency_key_in_use` or a Stripe server
  error (`5xx`) keeps its key generation, so the next attempt either replays
  the refund Stripe made or makes it once; that attempt lists the payment's
  refunds first and takes over its own by `refundJobId`. The record is cleared
  only when its own Stripe refund is seen (in a list or returned by the create
  call) or when a list that shows none was followed by a create call Stripe
  answered with a refusal. While it is set, no failed refund list (not found,
  missing permission or any other answer) counts as Stripe refusing the refund:
  the read is retried, and a refund whose retries end while its refunds cannot
  be read ends `unconfirmed` with the `unconfirmed` alert, never `failed`, and
  still counts against the remainder and in the refunded totals. Sold-out jobs
  record no attempt and move to the next key generation after a server error,
  as before.
- **One at a time**: at most one staff refund of an order may wait to reach
  Stripe (`pending`, `running`, `blocked_permission`); a second one is refused
  with `conflict` until the first is accepted or failed. Every request carries
  a `requestKey`: the same key for the same order returns the existing refund
  when the amount and choices match, and `conflict` otherwise, so a double
  click or a retried request never refunds twice.
- **Packing and label state**: the preview names whether the order is on the
  packing list and whether it has a shipment or bought label, and the request
  sends that state back in `expectedShipmentState`
  (`{ onPackingList, hasShipmentOrLabel }`). When the state read under the
  order lock differs (a label was bought or the order was packed after the
  preview), the request is refused with `conflict`, a message asking to check
  the refund again and `details.shipmentState` naming the current state, and
  nothing is stored or moved. Studio reloads the preview with its new choices
  and defaults and the CLI sends the state of the preview it just read. A
  request without the field (an older CLI) is not checked.
- **Stock and packing**: a full refund of an order that is `to_pack` without a
  shipment or label returns its committed stock (a `returned` stock event per
  product with `reference = { orderId, reason: "staff_refund" }`) and takes the
  order off the packing list by default; staff may untick either. Goods
  returned to stock cannot stay on the packing list: returning stock while
  keeping a `to_pack` order on the list is refused with `validation` (put the
  order back later with Ship anyway, which takes the stock back). With a
  shipment or bought label, stock return defaults to off and the label is not
  cancelled; any carrier shipment row of the order counts as a bought label,
  also a claim the carrier has not been called for yet (an attempt that failed
  or was given up is deleted). The carrier claim and the refund serialise on the
  order row: the InPost create use-case takes its claim only after re-reading the
  order under `SELECT … FOR UPDATE` and refuses with `conflict` before any
  carrier call when the order is no longer `to_pack` (a staff refund took it off
  the packing list), and a refund that runs after the claim sees the claim. A
  `shipped` order is never moved. A typed amount that covers the
  whole remainder when it is requested gets the same stock and packing choices
  and defaults; any smaller amount changes no stock, packing or access, and
  asking for either change with it is refused. Both
  choices apply when the refund is requested; a refund that later fails leaves
  them as chosen and the staff alert says so. "Ship anyway"
  (`POST /api/orders/:orderId/packing-list`, `order ship-anyway`) puts an order
  without fulfilment status back to `to_pack` and, in the same transaction,
  takes back out of stock the units a staff refund returned (an `adjusted`
  stock event with `reference = { orderId, reason: "staff_refund_ship_anyway" }`),
  once. It takes back only units on hand that no other checkout has reserved
  (`on_hand - reserved`); when fewer are free than it must take back, it is
  refused with `conflict` naming the products, and staff adjust the stock
  first.
- **Access and subscriptions**: the existing `charge.refunded` handler marks a
  fully refunded order `refunded` and revokes the grants of its products unless
  another purchase keeps them; a partial refund changes no grant. When the
  order is the latest invoice of a subscription that is still running, the
  handler also cancels that subscription at Stripe; the preview says so
  (`cancelsSubscription`) and the dialog and the CLI preview name it for a full
  refund. The handler also
  makes the order's waiting staff refunds due at once, so Studio shows the
  outcome within a minute. Access revoked that way is not given back when the
  refund fails later: the `failed_after_submission` alert of a staff refund
  tells staff to grant it again on the member page, and the order can be
  refunded again when that refund was the order's latest staff refund and a
  full one.
- **Buyer e-mail**: one refund notice per staff refund (outbox id
  `order-refund-issued:<refundId>`), queued in the transaction that records
  that Stripe holds the platform's own refund as `pending` or `succeeded`; a
  refund that `requires_action` sends it at the status read that first sees it
  `pending` or `succeeded`, the last scheduled one included, even when that
  read ends the refund `unconfirmed` for staff because it is still awaited. It is rendered when it is queued from the
  `order-refund-issued` template, in the language and branding of the sold-out
  e-mail, and stored pre-rendered as an `m2m-transactional` message (subject,
  HTML and text) with source `staff-refunds` and no tenant transport
  requirement, the shape the previous release renders and lists, so a rollback
  neither drops it nor cuts the paging of older e-mails in Sent e-mails
  (decision D10'). It names the amount of the platform's own Stripe refund in
  the currency's own minor units (a zero-decimal currency such as JPY is not
  divided by 100), the short order reference and the usual arrival time; never
  a provider id or the staff note.
- **Staff alerts**: a staff refund raises the alerts of the sold-out refund
  (retrying, blocked by the permission, still blocked after 72 hours, failed,
  failed after it was issued, not confirmed) on the same outbox id scheme
  (`order-refund-alert:<refundId>:<alert>:<attempt>:<recipient>`) and attempt
  rules, but with wording of its own: a staff member asked to refund the amount
  of the order, what state it is in, whether anything was refunded, the stock
  and packing changes that stay for a refund that is no longer tried, the
  access guidance for a refund that failed after it was issued (grant access
  again on the member page) and the last error. A retry whose request got an
  answer says the refund has not reached Stripe yet; a retry after an unknown
  outcome has a subject of its own ("outcome not known yet") and says Stripe
  may already have received the request, which the retries repeat, so the
  order is never refunded twice. An `unconfirmed` alert names why (the request
  may have reached Stripe but its refunds could not be read, Stripe still had
  the refund in progress at the last check, a full refund made outside the
  platform the key could not confirm, or no confirmation) and tells staff to
  check the payment in the Stripe Dashboard: nothing more is needed when the
  refund is listed there; when it is not, staff refund it there and the
  order is updated once Stripe reports it. The explanation of a staff refund
  in the alerts and in Studio's refund history is derived in the reader's
  language from the refund's status and flags (`create_outcome_unknown`,
  `provider_refund_status`, `permission_blocked_at`); `last_error` keeps only
  Stripe's own diagnostic, or a short neutral token when there is none (for
  example `waiting_for_other_refund` or `refund_pending`).
  Each alert is rendered per recipient in the recipient's language when it is
  queued and stored pre-rendered as an `m2m-transactional` message with source
  `staff-refunds`, like the buyer notice, so the previous release renders and
  lists it. Sold-out alerts keep the `order-refund-alert` payload and wording. A refund that never reached Stripe or failed sends none, and
  neither does a test-mode order, whose checkout sent no buyer e-mail either. A
  test-mode order never took stock, so restocking it returns nothing.
- **Audit**: each row keeps who requested it (`requested_by_user_id`,
  `requested_by_email`), the amount, the staff-only note (at most 500
  characters; control characters other than line breaks and tabs are refused
  with `validation`) and the time. The server logs one line per new request with the
  workspace, order, refund id, actor id and amount, without e-mail addresses or
  Stripe ids. The dispatcher's log lines replace Stripe object ids and keys in
  Stripe's messages with `[provider id]`; the refund keeps the message with its
  object ids for Studio and the staff alert, but every refund failure message
  has Stripe API keys and webhook secrets (`sk_`, `rk_`, `pk_`, `ek_` live or
  test keys and `whsec_` secrets) replaced with `[credential]` before it is
  stored, shown or e-mailed; so is the `failure_reason` of every refund object
  Stripe returns, before the refund that failed after it was issued stores it.
  The log line written when `charge.refunded` makes
  staff refunds due names no Stripe event id. Stripe metadata carries `tenantId`, `orderId`, `reason: staff` and
  `refundJobId` only.

Routes (session only, `order:refund`, see [the route table](route-table.md)):

| Method and path | Purpose |
|---|---|
| `GET /api/orders/:orderId/refund-preview` | Paid amount, the refunds actually committed (`refundedCents`: Stripe's list when it was read, else the platform's records) and the remainder staff may refund (`remainderCents`, which the rules above may hold below the rest of the payment; `remainderWithheld` says so for an order marked refunded), currency, mode, whether the remainder came from Stripe, stock a full refund can return, packing list, shipment or label, invoice, whether a full refund cancels a subscription, the default choices and any refund still waiting |
| `POST /api/orders/:orderId/refunds` | `{ requestKey, amountCents?, expectedAmountCents?, expectedRemainderCents?, reason?, restock?, removeFromPackingList?, expectedShipmentState? }` (`expectedAmountCents` required without `amountCents`, `expectedRemainderCents` with it) → `{ refund, created }` |
| `POST /api/orders/:orderId/packing-list` | Ship anyway |

The routes follow the origin and CSRF policy of other Studio writes and are
rate-limited with the shared limiter per staff member and per workspace: 10 and
60 requests a minute for refunds and ship anyway, 60 and 300 for previews; a
refused request answers `429 rate_limited` with `Retry-After`. The order detail
(`GET /api/orders/:orderId`) carries `staffRefunds` (newest first) and
`refundTotals` (paid, refunded, remaining). The Studio orders list
(`GET /api/orders`) carries `staffRefundStatus` and `staffRefundAmountCents`,
the state and amount of the order's latest staff refund while it is unsettled; `refundJobStatus` keeps meaning only the
sold-out refund job, and the shop key order list and the order feed carry no
staff refund state. The orders export gains a
trailing `refunded_amount` column (CSV, minor units) and `refundedCents` (JSON):
the platform-recorded staff and sold-out refunds, or the paid amount for a
`refunded` order. The
shop integration order feed is unchanged. An invoiced order gets no automatic
correcting invoice; the preview says the order has one.

In Studio the order detail shows a **Payment** card with the paid, refunded and
remaining amounts (refunds not yet confirmed by Stripe are counted and named;
a refund waiting for the refund permission is listed apart as a requested
refund, with a warning that it has not been paid out). When the refund preview
read Stripe's list, the card takes its amounts from the preview, so a refund
made in the Stripe Dashboard and a full refund that failed after
`charge.refunded` show as Stripe holds them, and a refund waiting for the
permission is listed beside Stripe's total, never inside it; otherwise it shows
the platform's records and says why (Stripe's list could not be read, or the
refund check itself could not be loaded). An order marked refunded whose
refunds do not cover the payment (for example after a dispute) is never shown
as wholly refunded: the card shows the amount actually refunded and says that
nothing more can be refunded there,
a **Refund history** with each refund's amount, requester, time, staff-only
reason and state (a refund waiting for the refund permission also names its
attempts, the next attempt and the last possible one, 72 hours after the first
refusal, from the view's `permissionBlockedAt`), and **Ship anyway** in the delivery card of an order a refund
took off the packing list. The **Refund** action appears only to an owner or
admin with a verified e-mail outside impersonation, for an order the preview
can refund; while another refund of the order waits for Stripe it stays
disabled with the reason. The dialog refunds the whole remainder it shows by
default and sends that remainder as `expectedAmountCents`, and with a partial
amount too as `expectedRemainderCents`; when the server answers that the
remainder changed, the dialog reloads the preview, names the new remainder and
lets staff confirm it, with the consequences of the new remainder (a typed
amount that now covers it says access ends). When it answers that the packing list
or label changed, the dialog reloads the preview, resets the stock and packing
choices to the new defaults, says what happened and lets staff confirm again.
The consequences say that access ends unless another purchase keeps it and,
for the latest invoice of a running subscription, that a full refund cancels
the subscription too. Another refund still waiting for
Stripe disables the refund button and offers Close; any other `conflict`
(nothing left, an order that can no longer be refunded, a request key used for
other values) shows the server's message the same way;
Ticking the stock option ticks and locks the packing-list option with a hint
that returned goods cannot stay on the list.
**Partial amount** takes a decimal amount in the order's currency and names the
remainder when the amount is refused; it always asks to keep stock and the
packing list as they are, so a remainder that shrank after the dialog opened
never turns it into a full refund's choices. Every field is locked while the
request is in flight, and a refusal stays pinned above the buttons. The stock option is hidden when nothing
can return to stock (a test-mode order). One request key is generated per
opening of the dialog and reused on a retry, so a double click or a repeated
request returns the same refund. On a phone the dialog opens as a bottom sheet
with the actions pinned below the scrolling content, the primary button first
in both reading and focus order. The orders list shows the
amount and state of the latest unsettled staff refund next to the order status;
on a phone it shows one card per order instead of the table, and a tap anywhere
on a card opens the order while the buyer name still opens the member.

```bash
pnpm --silent run cli --tenant acme order refund-preview <orderId>
pnpm --silent run cli --tenant acme order refund <orderId> --yes --remainder 40.99
pnpm --silent run cli --tenant acme order refund <orderId> --amount 12.50 --reason 'Damaged cover' --yes
pnpm --silent run cli --tenant acme order ship-anyway <orderId>
```

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
recorded. An adjustment, a released reservation (explicit or by the expiry
sweep) or a threshold change that lifts availability above the threshold clears
`low_stock_notified_at`; an adjustment or a released reservation that leaves any
piece available clears `sold_out_notified_at`, so the next commit that empties
the shelf sends the zero alert again. Products without a threshold only alert
when oversold.
The e-mail is queued in the payment transaction.

### Public offer

The public offer exposes per product `stock: { tracked, soldOut, low, available }`.
`available` is the number of pieces a buyer can take now (on hand minus the
pieces held by open checkouts, never below zero) for a tracked product and
`null` for an untracked one; the stored on-hand and reserved counts are never
public. `low` means a threshold is set and availability reached it. Each product
also carries `maxQuantity`, the largest quantity one checkout line accepts right
now: `0` when sold out, otherwise the rule bound of its checkout path (10 for a
physical product in the cart, 1 for every other type) capped by `available`. A
membership is never a cart line: its `maxQuantity` of 1 is the single-product
checkout at `/checkout/<product-id>`. The offer ETag
includes a hash of the available count and the low flag of every tracked
product the standalone offer can show: published products with `salesChannel: 'any'`.
A sale, reservation, release or adjustment that changes one of those counts
revalidates cached offers.

A sales link is sold out when any of its products is: the direct handoff page
shows the "checkout unavailable" state (HTTP 409) instead of posting to Stripe,
while crawlers still receive the preview metadata, and the Together checkout
page disables the pay button with a "Sold out" label. The public sales-link
offer carries the number of whole sets left and a `maxQuantity` per line; see
[Public offer](sales-links.md#public-offer).

### Studio and CLI

The product editor shows on hand, reserved and available pieces, an adjustment
form (signed change and reason) and the low-stock threshold. The products list
shows "on hand · reserved", "Sold out" or "Low" for tracked products. The CLI
offers `product stock show|enable|adjust|threshold` and `product list` prints
the same summary for tracked products. All writes require `product:write`.

Stock is not part of the product content snapshot (`core/domain/snapshots/product`):
it is operational state with its own event history, so restoring a product
version never changes stock.

## Follow-ups

These parts of the shop are not built yet and are handled as described:

- Returns (RMA): there is no return flow. Staff refund the buyer in Stripe and
  put the goods back with a stock adjustment whose reason is `returned`.
- Carrier labels: only InPost is integrated, without dispatch orders (courier
  pickup orders), webhooks, return labels or multi-parcel shipments; see
  [InPost ShipX](#inpost-shipx). Other carriers stay manual: staff buy the label
  with the carrier and type the tracking number when they mark the order as
  shipped.
- Parcel-locker map origins: the `connect-src` decision stays as described in
  [Content security policy for the parcel locker map](#content-security-policy-for-the-parcel-locker-map).
