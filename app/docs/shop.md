# Shop: shipped physical products

A physical product is either collected in person or shipped by parcel. This
page covers shipping: delivery methods, delivery options (rates), the parcel
locker flow, what an order stores, the content security policy for the
parcel locker map, and the CLI.

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
locker code or, for address delivery, the city; purchases collected in person
keep "Collected in person".

## Studio

The order detail page shows a **Delivery** card (option, price, locker,
address, phone) and a **To pack** chip. The orders list has a **Needs shipping**
filter (`fulfilmentStatus=to_pack`). CSV and JSON exports add the columns
`shipping_rate`, `shipping_point`, `shipping_name`, `shipping_phone`,
`shipping_address`, `shipping_postal_code`, `shipping_city`, `shipping_country`
and `fulfilment_status`.

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
```

`--shipping-rates` replaces the whole list; an empty string for
`--inpost-geowidget-token` clears the token. `--pickup-point` needs
`--shipping-rate`.
