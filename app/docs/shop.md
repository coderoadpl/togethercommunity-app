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
mode, oldest payment first. Studio sends the payment mode selected on the
orders page; with the **All** payment-mode filter it sends `live` and shows
"Live orders only" next to the button. The CLI takes `--mode live|test`
(default `live`). The columns are `order_number`,
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
same product more than once, the purchase date, the status and the destination
all come from the newest order.

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
2. In **Studio → Settings → Shipping → InPost ShipX** the owner chooses the
   environment (`sandbox` by default, or `production`), enters the organization
   id and the token and fills in the sender block: name, optional company,
   e-mail, phone (a Polish 9-digit number, `+48` accepted), street, building
   number, city and post code (`00-000`). The sender country is always `PL`.
3. The card says **Ready** once the organization id, the token and the sender
   are saved.

The environment selects the API base URL: `https://api-shipx-pl.easypack24.net/v1`
for production and `https://sandbox-api-shipx-pl.easypack24.net/v1` for the
sandbox (both from the authorization page of the ShipX API documentation).
Only the ShipX HTTP adapter (`adapters/shipx/http.ts`) knows these
URLs.

The organization id and the token are stored like the Stripe keys: encrypted
tenant secrets (`shipx.organizationId`, `shipx.token`) that are write-only in
Studio and the CLI, which only show a masked preview. They never appear in the
public payment configuration or in tenant settings, and the server decrypts
them only for the ShipX call. The environment and the sender block are stored
on the workspace (`tenants.shipx_environment`, `tenants.shipx_sender`) and are
read through `GET /api/integrations/shipx`, never through the tenant settings
that members can read. Reading needs `tenant:secret:read` (owners and admins);
saving with `POST /api/integrations/shipx/configure` needs `tenant:secret:write`
(owners). `clearCredentials: true` removes the organization id and the token
and keeps the sender.

### Parcel size

Every product has `parcelTemplate`: `small`, `medium` (the default) or `large`,
the InPost locker sizes A (8 × 38 × 64 cm), B (19 × 38 × 64 cm) and C
(41 × 38 × 64 cm). Studio shows **InPost parcel size** in the editor and on the
create page of physical products shipped by parcel; the API and the CLI accept
it on every product. A shipment uses the largest size among the order's product
lines. Locker shipments send the size as the ShipX `template`; courier
shipments send the size's dimensions and a fixed weight of 5 kg
(`SHIPX_COURIER_PARCEL_WEIGHT_KG` in `core/domain/shipx.ts`). Product
snapshots carry the parcel size from version 9
(`core/domain/snapshots/product/v9.ts`); version 8 snapshots read unchanged
because the field is optional, and restoring a product version keeps the
current size.

### Which ShipX client answers

The workspace's ShipX environment decides which client serves an order, so the
whole flow can be tried against the sandbox with test orders before any paid
order reaches InPost:

| Deployment | Environment | Test-mode order | Live (paid) order |
|---|---|---|---|
| `PAYMENT_PROVIDER=stripe` | `sandbox` | the real client against the ShipX sandbox | refused with `validation`: "ShipX is configured for the sandbox; switch to production before shipping paid orders" |
| `PAYMENT_PROVIDER=stripe` | `production` | the deterministic fake client | the real client against ShipX production |
| `PAYMENT_PROVIDER=fake` | either | the fake client | the fake client |

The rule is `shipxClientKind` in `core/domain/shipx.ts`; `composition.ts` passes
no real client in deployments with `PAYMENT_PROVIDER=fake` (local development,
the smoke gate and the end-to-end scripts), so they never contact InPost. The
order page hides **Create InPost shipment** for a live order while the
environment is the sandbox and says why (`reason: 'sandbox_environment'`).

The fake client (`adapters/shipx/fake.ts`) answers with an id and a 24-digit
tracking number derived from the order id and a one-page PDF, charges nothing
and, like every test-mode shipment, sends no e-mail.

Every `order_shipments` row stores the environment and the organization id it
was created with. Reads, purchases and label downloads for that shipment use
the stored environment and organization with the current token. When the
current settings name another environment or organization, the request answers
`conflict` and calls nothing: switch the settings back, or finish the shipment
in Manager Paczek. Opening the order then shows the stored status.

### Creating the shipment

The order page shows **Create InPost shipment** on an order to pack whose
delivery option has the carrier `inpost`, when the staff role has `order:write`
and the workspace is ready. The service follows the option: a parcel locker
option sends `inpost_locker_standard` with the locker code as `target_point`,
an address option sends `inpost_courier_standard` with the delivery address.
The confirmation names the service, the parcel size and the buyer e-mail. The
receiver is the delivery name (split into first and last name at the last
space), the member e-mail and the delivery phone. For courier shipments the
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

The request has one deadline, 20 seconds from its start, checked before every
ShipX call (the reconciliation lookup, the create, each read and the purchase;
the label download is a separate request). When the deadline has passed, the
request makes no further call and answers `shipx_unavailable` with
`details.state: 'pending'`; the row keeps the ShipX id, or the unconfirmed
attempt, and the last status, and the order stays to pack. A row that holds
neither yet (the deadline passed before the create was recorded) is deleted,
so the next click starts over with the current settings. Opening the order reads the live ShipX status once
for a shipment that is not bought yet and stores it; clicking **Create InPost
shipment** again continues from that status and never creates a second
shipment.

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
client reads one page of the 50 newest shipments (`page=1`, `per_page=50`,
`sort_by=created_at`, `sort_order=desc`) per click, without a retry, and
matches `reference` with the order id. A match is adopted: its id and status are stored and the
flow continues with step 3. Without a match the request answers `conflict`
("ShipX did not confirm the previous attempt; check Manager Paczek") and the
order page shows that warning with **Discard the attempt and create again**.
That action (`POST /api/orders/<orderId>/shipx/discard`, `order:write`, CLI
`order shipx discard <orderId>`) deletes only a row that has no ShipX id and is
not in use by another request; the page then creates the shipment again. It
also clears a claim that a crashed request left before recording any create
attempt, which could otherwise block the order with an environment or
organization mismatch after the ShipX settings changed. Staff check Manager Paczek first, because a shipment that ShipX
created but did not list yet would be paid twice.

### Concurrency

A request owns the row through its claim: a random `operation_token` and the
`operation_started_at` lease. Taking the claim is the `INSERT` of a new row or
one conditional `UPDATE` that succeeds only when `operation_started_at` is
`NULL` or older than the lease of 90 seconds; a request that finds the claim
held answers `fulfilment_conflict` ("Another request is creating the InPost
shipment for this order; refresh the order in a moment") without calling
ShipX. The lease is longer than the slowest request: the 20-second deadline
plus one last call of at most 5 seconds, since no call in this flow is retried.

Every later write of the request (the attempt, each ShipX state, the release
of a rejected attempt, and the final clearing of the claim) is a conditional
statement on the workspace, the order and the request's `operation_token`. When
another request holds the row by then, the write changes nothing, and the
request stops without calling ShipX again and answers `fulfilment_conflict`
with `details.state: 'lost_lock'`. A request that ends therefore never clears
or deletes the claim of the next one. A crashed or stuck request keeps the
lease until it expires after 90 seconds; its row then shows a ShipX id (the
next click continues), an unconfirmed attempt (the next click reconciles) or,
when it crashed before recording the attempt, neither (the next click creates,
and **discard** clears it when the settings changed meanwhile). Opening the order stores the live ShipX status only while no
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
| `offer_bought` | the purchase time is stored for the first time (by the request or by opening the order) | `status`, `trackingNumber` |
| `payment_failed` | ShipX reports a failed payment or a dead offer, or refuses the purchase | `status`, `reason` |
| `attempt_released` | a rejected attempt, or a claim whose deadline passed before the create was recorded, is deleted without a ShipX id | `status`, `createAttemptedAt` |
| `attempt_discarded` | staff discard an unconfirmed attempt or a claim left before any create attempt | `status`, `createAttemptedAt` |
| `label_fetched` | a label is downloaded | none |
| `status_refreshed` | a ShipX read (a request's poll or opening the order) changes the stored status or tracking number | `from`, `to` (statuses), `trackingNumber` |
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

**Print label** appears once the shipment has a tracking number. Studio fetches
`GET /api/orders/<orderId>/shipx/label` (`order:read`) with the API client,
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
| credentials or sender missing | `integration_not_configured` (HTTP 412, CLI exit 8) |
| live order while the environment is the sandbox | `validation` (HTTP 400, CLI exit 2) |
| order not to pack, or already shipped | `validation` or `fulfilment_conflict` |
| delivery option not InPost, phone not a Polish number, building number missing | `validation` |
| another request holds the order's claim, or took it over during the request | `fulfilment_conflict` (HTTP 409, CLI exit 27) |
| the order was marked as shipped by hand while the shipment was bought | `fulfilment_conflict` with the tracking number |
| the stored shipment belongs to another environment or organization | `conflict` (HTTP 409, CLI exit 6) |
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
account, with a test-mode order and the environment set to `sandbox`:

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
  `reference` on each item, which the reconciliation of an unconfirmed attempt
  relies on;
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
product. A sales link with any product that carries safety information never
takes the automatic `/offer/<slug>` handoff to Stripe: like shipped and
consent-bound products it stays on the Together page at `?checkout=together`,
so the section is shown before payment, and
`POST /api/public/sales-links/<slug>/checkout` refuses the link. The purchase
confirmation e-mail does not include it.

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
parcel-locker map is available to buyers; enter the locker code." As defence in
depth the endpoint itself returns `inpostGeowidgetToken: null` with
`inpostGeowidgetWithheld: true` to a staff session, and to an owner or admin
viewing the workspace as a member (impersonation), so the page shows the same
hint without the map.

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
pnpm --silent run cli --tenant acme orders packing-list --format csv --mode test
pnpm --silent run cli --tenant acme orders ship <orderId> --carrier inpost --tracking 520000011395200025754311
pnpm --silent run cli --tenant acme orders list --fulfilment shipped
pnpm --silent run cli --tenant acme tenant shipx-set --environment sandbox \
  --organization-id 1234 --token '<ShipX token>' \
  --sender '{"name":"Anna Sender","email":"shop@example.com","phone":"500600700","street":"Example Street","buildingNumber":"7","city":"Warsaw","postCode":"00-001"}'
pnpm --silent run cli --tenant acme tenant shipx
pnpm --silent run cli --tenant acme product update <id> --parcel-template large
pnpm --silent run cli --tenant acme --json order shipx show <orderId>
pnpm --silent run cli --tenant acme --json order shipx create <orderId>
pnpm --silent run cli --tenant acme order shipx label <orderId> --out label.pdf
pnpm --silent run cli --tenant acme order shipx discard <orderId>
pnpm --silent run cli --tenant acme product update <id> \
  --compliance '{"manufacturerName":"Example Workshop","manufacturerAddress":"Example Street 1, 00-001 Warsaw","manufacturerEmail":"safety@example.com","modelIdentifier":"STAND-1"}' \
  --variant-group printed-stand --variant-label 'Black · ASA'
```

`--shipping-rates` replaces the whole list; an empty string for
`--inpost-geowidget-token` clears the token. `--pickup-point` needs
`--shipping-rate`. `--compliance null` removes the safety information and
`--clear-variant` removes the variant group and label. `order` is an alias of
`orders`. `tenant shipx-set --clear-credentials` removes the ShipX organization
id and token; `--sender null` removes the sender. Passing the token as a flag
puts it in the shell history: prefer entering it in Studio.

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
recorded. An adjustment, a released reservation (explicit or by the expiry
sweep) or a threshold change that lifts availability above the threshold clears
`low_stock_notified_at`; an adjustment or a released reservation that leaves any
piece available clears `sold_out_notified_at`, so the next commit that empties
the shelf sends the zero alert again. Products without a threshold only alert
when oversold.
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
