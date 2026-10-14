# Payments

## Purchase confirmation and purchased files

The success return page polls `GET /api/public/checkout/session-status?session_id=<id>` every three seconds for at most three minutes when a non-empty session ID is present. The tenant-scoped, mode-aware endpoint returns `pending` or `paid` in the API envelope with `Cache-Control: no-store`. Paid sessions include the purchase analytics payload described below only when the tenant has configured a GA4 measurement ID or Meta Pixel ID; buyer details are never included. Unknown sessions and unpaid sessions have identical responses; refunded payments also count as paid for this confirmation. Polling stops after payment confirmation or the timeout. Free and fully discounted checkouts are fulfilled synchronously and return without a session ID, showing the paid card immediately without polling; legacy returns and empty session IDs follow the same behavior. Welcome magic links target `/my/course/<productId>` for the first digital download product in the order lines (or the fulfilled download product when there are no order lines), and `/start` otherwise. The sidebar and mobile menu list granted products with download assets in a Downloads section directly below Spaces. Their product pages show the description and downloadable files, or courses followed by downloads when both are included. The avatar menu retains the full My products list.

## Checkout analytics

Owners configure **Studio → Settings → Analytics** through the existing
tenant settings update. Set a GA4 measurement ID (`G-` followed by 6–14 uppercase
letters or digits) and/or a Meta Pixel ID (8–20 digits). Google Tag Manager is
not supported. Clearing both IDs disables analytics. The consent cookie name
accepts 1–64 letters, digits,
underscores, dots or hyphens; the optional required value fragment accepts at
most 128 characters. The five settings are also available in `tenant settings`
and `tenant settings-set` through `--analytics-tag-id`, `--analytics-meta-pixel-id`,
`--analytics-consent-cookie-name`, `--analytics-consent-cookie-value` and
`--analytics-load-without-consent true|false`. An empty string clears a text field.
The public payment configuration exposes these settings under `analytics`, or
`null` when neither ID is configured. GA4 and Meta work independently.

The platform never loads tenant-authored scripts: checkout analytics is limited
to Google's GA4 `gtag.js` and Meta's `fbevents.js` libraries for tenant-configured
measurement and Pixel IDs, on the checkout success document only, after the
consent rule passes. The member session is not otherwise isolated from those
libraries, as on any site using GA4 or Meta Pixel.

Each configured library loads only when the live success card mounts on
`/offer/<slug>?status=success` or `/checkout/<reference>?status=success`. It never
loads for `test_purchase=1`, a test checkout session, the server-rendered checkout
handoff, cancellation, Studio or member pages. Each library is injected once per
document. A SPA is a single document, so a loaded tag remains active until reload;
leaving the return page after loading a tag forces a full document navigation,
including navigation to member pages or Studio.

The success card reads `document.cookie`. Loading requires at least one
configured ID and
either **Load without checking consent** or a configured consent cookie that is
present and contains the required value fragment, if one is configured. With no
fragment, cookie presence is sufficient. Cookie values are URL-decoded before
matching; malformed encoding falls back to the raw value. The creator's site must
set this cookie for the parent domain so it is readable on the platform
subdomain. Enabling the consent bypass makes the creator responsible for the
applicable consent rules.

After the loading rule passes, Consent Mode v2 defaults deny `analytics_storage`,
`ad_storage`, `ad_user_data` and `ad_personalization`, with `wait_for_update: 500`.
An immediate update grants all four categories because the creator's banner
collects a single all-or-nothing choice. The same sequence applies when the owner
enables loading without a consent-cookie check. GA4 then initializes with
`send_page_view: true`, and the client injects
`https://www.googletagmanager.com/gtag/js?id=<measurement-id>`.

Meta injects `https://connect.facebook.net/en_US/fbevents.js` with the official
`fbq` queue stub. With cookie checking enabled, it queues `fbq('consent', 'revoke')`
before `fbq('consent', 'grant')`; the bypass path queues only the grant. It then
initializes the configured Pixel ID and sends `PageView`. Both libraries use the
same consent-cookie rule.

When session status becomes `paid` and either ID is configured, its response adds:

```json
{
  "analytics": {
    "transactionId": "order-id",
    "value": 99,
    "currency": "PLN",
    "offerSlug": "workbook",
    "items": [
      { "itemId": "product-id", "itemName": "Digital workbook", "price": 99 }
    ]
  }
}
```

The transaction ID is the order ID; the value is the gross order total in major
currency units, and each item's price is the gross order-line amount in major
units. `offerSlug` is the order's sales-link slug, or `null` when no link is
available. Pending and unknown sessions retain identical responses without analytics.
Unconfigured tenants receive no analytics payload even when paid. Rate limits
and `Cache-Control: no-store` remain unchanged.

Once GA4 has loaded, the success card emits
`gtag('event', 'purchase', { transaction_id, value, currency, items, offer_slug })`.
Each item uses `item_id`, `item_name`, `price` and `quantity: 1`. The creator can
register `offer_slug` as a custom dimension in GA4. The client writes
`together.analytics.purchase.<session_id>` to local storage before emission,
preventing another GA4 event for that session on reload.

Once Meta has loaded, the card emits
`fbq('track', 'Purchase', { value, currency, content_type: 'product', content_ids, contents, num_items }, { eventID: transactionId })`.
`content_ids` lists the product IDs; each `contents` entry has `id`, `quantity: 1`
and `item_price` in gross major currency units. `num_items` is the number of order
lines. The order ID is the event ID for future server-side deduplication. The
separate local-storage key `together.analytics.meta-purchase.<session_id>` is set
before emission, preventing another Meta event for that session on reload.
Returns without a session ID, including free checkouts and legacy links, may load
the libraries but never emit a purchase event.

For SPA documents under `/offer/` and `/checkout/`, the server extends
`script-src` with `https://www.googletagmanager.com` and
`https://connect.facebook.net`, and `connect-src` with
`https://*.google-analytics.com`, `https://*.analytics.google.com`,
`https://www.googletagmanager.com` and `https://www.facebook.com`. `img-src`
explicitly adds `https://www.facebook.com` alongside its existing HTTPS allowance.
Server-rendered handoff and crawler pages and all other documents retain their
existing policy. Hosting configuration and document routing are unchanged.

GA4 uses its default cookie domain. A parent-domain `_ga` cookie is shared across
the creator's site and the platform subdomain, recognizing the same visitor
without additional cross-domain configuration.

Creators should add a privacy-policy statement describing their actual setup,
for example: “After our configured consent-cookie check passes, our purchase
confirmation page loads Google's GA4 `gtag.js` library for our measurement ID and
Meta's `fbevents.js` library for our Pixel ID. Google receives an order identifier,
purchased product identifiers and names, currency, gross purchase amounts and the
sales-link slug. Meta receives page-view and purchase events with the order
identifier, product identifiers, quantities, currency and gross purchase amounts.
Our single consent choice
grants analytics storage, advertising storage, advertising user data and
advertising personalization. A parent-domain analytics cookie links visits to
our website and purchase confirmation page. You can manage consent through our
website's consent controls.” When cookie checking is disabled, explain that the
libraries load without checking that cookie and how consent is obtained. The
statement must describe the creator's retention, recipients and
consent-withdrawal arrangements.

## Direct sales-link checkout

Public `/offer/<slug>` URLs send buyers straight to live Stripe Checkout. The server
renders the sales-link title, description, Open Graph metadata and tenant favicon,
then posts to `/api/public/sales-links/<slug>/checkout` with an optional `returnUrl` and replaces the page
with the returned URL. The endpoint always creates live sessions and rejects a
`mode` field, including `mode: "test"` or `mode: "live"`, with a 400 validation
error. It does not read the staff test session. A noscript POST button supports
browsers without JavaScript.
The existing public-write limiter limits the POST per IP and tenant. GET requests
do not create sessions. `/link/<key>` redirects into the same flow. Cancellation
can return to an external tenant-configured HTTPS address through `cancelReturnUrl`
and an accepted `return` query parameter; see [Sales links](sales-links.md).

The redirect page shows a centred card with the tenant's resolved checkout display
name, HTTPS logo when configured, button colour as its accent and background colour
when set. It includes a CSS spinner and status text, follows the system light or
dark preference and uses system fonts without external font requests.

The crawler user agents listed by the edge (facebookexternalhit, Twitterbot,
LinkedInBot, Slackbot, Discordbot, WhatsApp, TelegramBot, Googlebot, redditbot and
Applebot) receive metadata without a script or form. Checkout POSTs from those
agents are refused as well. This also applies to `?checkout=together` and
`status=success|cancelled` URLs: the edge forwards crawlers before the browser
fallback rewrites.

Stripe receives one line per product, the tenant language, tax ID collection and
a mandatory terms checkbox. Promotion codes are disabled in this direct flow.
Set a valid terms URL once in the Stripe account Dashboard; Stripe requires this
account-level setting even when Together overrides the acceptance message with
links to the tenant's terms and privacy policy. Together records accepted consent
against the exact URLs saved in session metadata. Missing tenant legal URLs show
an error page and prevent session creation.

Webhook fulfillment uses the session customer details for email, name, billing
address when supplied, and tax IDs. Polish `eu_vat` IDs starting with `PL` are
stored as digits-only billing NIP even when the optional address is incomplete.
Foreign and incomplete addresses are retained even without a Polish NIP.
Under the All-orders invoice scope, consumer invoices retain the collected name,
country, postcode, city and street address, including country-and-postcode-only
billing. A NIP remains optional. The B2B-only scope still skips orders without a
NIP; orders with a NIP still require complete Polish billing details. iFirma
retains its domestic-address restriction. Live order lines, grants and confirmation email
continue through the existing fulfillment flow.

Purchase emails are dispatched immediately after the payment transaction commits.
The opportunistic dispatcher runs one bounded batch without delaying the webhook
response, and Vercel keeps the function alive until the dispatch loop finishes.
The `dispatch-email` cron runs every minute as a safety net behind immediate
post-commit dispatch: purchase emails must not wait if opportunistic dispatch
does not complete.

Staff test purchases use the Together checkout page at `/checkout/<productRef>`
or `/offer/<slug>?checkout=together` and its **Stripe test mode** switch.
These pages never hand off automatically. The switch uses the tenant's configured
test key and the existing server-side Stripe test session bound to the signed-in
account and tenant. Checkout rechecks tenant staff membership. An unreadable
stored test key or a live key in the test slot returns an error for an authorized
test checkout instead of switching to live credentials.
Cancelled staff test checkout returns to `?checkout=together`. Retry stays on the
Together page and requires a manual checkout action. The switch reflects the
staff test session; enable it again before starting another test purchase.

Staff test checkout stores a pending order for the signed-in staff account
before returning the Stripe URL. Fulfillment preserves the member and test
grants while suppressing purchase confirmation email and magic links. Test
purchases retain the TEST indicator, never unlock real access and remain
excluded from revenue. A return query alone does not enable the TEST indicator
for anonymous visitors.

A sales link with product purchase consent checkboxes keeps the Together page at
`?checkout=together`, because Stripe has no custom checkbox field. Its existing
billing and coupon flow remains available. Both tenant legal URLs are required
on this fallback page and its checkout endpoint too. Success and cancellation return to the
Together page and cannot restart the automatic redirect. The single-product
checkout page retains its existing behavior.

## Checkout appearance

Owners can configure **Integrations → Stripe → Checkout appearance**. Available
overrides are display name, logo URL, icon URL, background colour, button colour,
font and corners (`pill`, `rounded`, `rectangular`). Colours must be `#RRGGBB` and
image URLs must use HTTPS. The font selector contains Stripe's supported font
families and defaults to `default`.

Empty fields fall back to the tenant branding in Settings: name, logo, accent
colour for the button and favicon for the icon. Every sales-link, single-product
and subscription Checkout Session receives the resolved `branding_settings` in
both live and test mode, including permission probes and connection tests.
If neither overrides nor tenant branding supply a value,
Together omits the appearance settings and Stripe uses its account appearance.

The Stripe SDK is pinned to **19.0.0**, using API **2025-09-30.clover**, which
natively supports `branding_settings`. Both promotion-code creation paths use
`promotion: { type: 'coupon', coupon: <id> }`. Clover exposes a discount's
coupon through `source`; Together reads the Checkout Session's aggregate
`total_details.amount_discount` and its own coupon metadata, so it does not
need to inspect discount sources. Subscription checkout explicitly selects
`subscription_data.billing_mode.type = 'classic'` to preserve existing billing
behavior instead of adopting Clover's new flexible default. Subscription and
invoice webhook handling continues to use item billing periods and invoice
subscription references.

For `invoice.paid` and `invoice.payment_failed`, Clover payment correlation comes
from `payments.data`, which is not included by default. For an invoice matched to
a local subscription or order, when that list is missing or empty, Together
retrieves the invoice with `expand: ['payments']` using the tenant's restricted
key for the webhook's live or test slot. The key needs read
access to Invoices. Only the payment references are taken from the lookup; the
original event supplies the invoice amounts, currency and billing period.
Payment-intent or charge IDs are stored on renewal orders so later refunds and
disputes can find them. Lookup failures fail webhook processing for retry instead
of acknowledging an event without its payment references. Existing pre-Clover
top-level payment references remain supported for older events. Signature
verification and the signed mode check happen before any lookup.

Checkout Sessions propagate `tenantId` to subscription metadata and, for one-time
payments, PaymentIntent metadata. Signed webhook metadata explicitly naming a
different tenant returns HTTP 400 before any Stripe API lookup, even if an object
ID matches a local record. This includes metadata on expanded customers and
subscriptions and invoice subscription details.
Customer, subscription and order IDs that resolve to another tenant's stored
records also return HTTP 400 before any Stripe API lookup.

Uncorrelated invoices and subscriptions without evidence of foreign ownership are
acknowledged with HTTP 200 and `processed: false`. Invoice events without a local subscription
or order skip the Stripe lookup. This applies both to older objects without
metadata and objects with matching tenant metadata: Stripe can deliver invoice or
subscription events before `checkout.session.completed`, and abandoned or failed
initial subscriptions may never create a local record. Unrelated objects in a
BYO or shared Stripe account are ignored under the same policy. Ignored events do
not mark fulfillment complete; a later delivery can process after checkout has
created the subscription. Checkout completion remains responsible for the initial
order and enrollment.

## Test mode for staff

A tenant owner can configure an independent Stripe sandbox in Studio → Integrations → Stripe → Test mode. Create a restricted key in the tenant's Stripe sandbox and enter the `rk_test_` key in this card. Grant the same checkout, subscription and webhook permissions shown for the live integration. The live card accepts only `rk_live_` keys; the test card accepts only `rk_test_` keys, including when credentials are saved through the API.

An installation whose live card already holds an `rk_test_` key predates the two slots. The live card now refuses it, the checkout page reports the tenant as not configured, and Studio marks the live card as holding a sandbox key. The live webhook endpoint also now discards every delivery from that sandbox account (a signed `livemode:false` event on the live slot), so renewals stop renewing and cancellations stop revoking until the key is moved. Paste that key into the **Test mode** card, then remove it from the live card and save an `rk_live_` key there. Orders already recorded through the sandbox key stay `mode=live`; the payment-mode filter will not separate them.

Configuration registers a separate webhook endpoint at `/api/webhooks/stripe/<tenantId>?mode=test`. The restricted key, webhook signing secret and webhook endpoint ID are written atomically for each Stripe slot. The card shows whether its signing secret is configured and when the last signature-verified test event arrived. Removing test mode unregisters that endpoint and removes the sandbox credentials and status. Live credentials and existing purchases remain intact.

Sign in as an owner or admin on the tenant's own domain, open a public product checkout, and enable **Stripe test mode**. The switch starts off, appears only once the sandbox key is saved, and is hidden from members and anonymous visitors. The server binds an encrypted, one-hour flag to the staff account and tenant and checks staff membership again when checkout starts. The flag is cleared after checkout creation. Impersonation cannot enable test checkout, and a `mode` field in the checkout body cannot select test mode.

Select a paid one-time or recurring price. The coupon field and the free-purchase action are disabled while the switch is on, and the server refuses a coupon or a zero price before it creates anything. The purchase is assigned to the signed-in staff account. Complete Stripe Checkout with a [Stripe test card](https://docs.stripe.com/testing), for example `4242 4242 4242 4242`, a future expiry date and a three-digit CVC. The return page identifies the purchase as a test for staff of the same tenant only. This banner confirms the checkout mode; webhook delivery completes fulfilment.

Test orders, subscriptions and grants carry `mode=test`. Studio sales and member details identify them with **TEST** and provide a payment-mode filter. Test grants do not unlock member access or change an existing live grant. Test rows are excluded from revenue, sales counts, active-subscription counts, reconciliation and exports. Single-product staff test checkout records no consent capture and does not redeem coupons or send Together transactional or marketing-consent email to members; diagnostic messages go to the platform log. Sales-link staff test checkout preserves the member and test grants while suppressing purchase confirmation email and magic links. Test orders can be invoiced only through KSeF with a configured test slot (KSeF TEST); iFirma and tenants without that test slot refuse invoice issuance. Coupons and free purchases use the ordinary checkout flow.

A pre-existing unique index still constrains `product_grants` to one row per tenant, member and product regardless of mode. A staff test purchase of a product the staff account already holds live is a no-op: it records the test order (and subscription, if any) but skips the test grant, so the existing live grant is untouched. The reverse direction is handled the other way around because it involves real money: a live purchase, manual grant or subscription renewal for a member+product that a prior staff test purchase already granted reclaims the row from the stray test grant and writes the live one. The bulk member-grant importer does not: it still fails that one row as a conflict, so clear a stray test grant first if an import reports one. Testing a product the staff account does not already own live, in either mode, is unaffected. Lifting the underlying index constraint requires a follow-up, owner-reviewed migration that drops the old index once no previous release still relies on it.

Each endpoint verifies its own signing secret and checks Stripe's signed `livemode` value. Every correlated order and subscription must match the endpoint mode. Test checkout events additionally require a recorded test checkout session; unknown test events and all cross-mode correlations are acknowledged with `processed:false` and a logged reason. Staff test checkout stores a pending order for the signed-in staff account before returning the URL. A test event for one tenant cannot fulfill a checkout for another tenant.

The CLI offers the same configuration operations:

```sh
together stripe test-mode status
together stripe test-mode configure rk_test_example
together stripe test-mode remove
```

Keep credentials out of shared terminal history. Test records are retained as audit history; removal disconnects the integration and does not purge records. Stripe documents the separation between sandbox and live credentials in [API keys](https://docs.stripe.com/keys).

## Permission check

An owner can select **Check key permissions** in either Stripe card, or run
`together stripe probe-permissions --mode live` (or `--mode test`). The probe uses
that mode's stored restricted key and returns each resource's permission, status,
Stripe diagnostic, an `allOk` flag and the check timestamp. Results are not saved.

The checks run in order: Webhook Endpoints list (labelled write, following the
configuration requirement), Subscriptions list (read only), Coupons create,
Promotion Codes create and deactivate, then Checkout Sessions create and expire.
Subscription write access cannot be checked without a customer. The coupon is a
single-use 1% discount and is deleted in cleanup, including after a promotion-code
failure. If coupon creation fails, Promotion Codes reports `error` with
reason `coupon-probe-failed` and no detail; Studio translates the reason, and the
checkout probe still runs. The checkout is a PLN 1.00
payment session with return URLs on the tenant's canonical origin, a 30-minute
expiry and immediate expiration in cleanup. No purchase is completed.

Stripe cannot delete promotion codes. Each successful check leaves one deactivated
`TOGETHER-PROBE-<8 uppercase alphanumeric characters>` code. Probe objects carry
`togetherProbe=1` and `tenantId` metadata. A failed cleanup is reported as a failed
resource check; an object may remain if Stripe rejects its cleanup.

A Stripe status code of 403, `permission_denied` code, or message containing
`does not have the required permissions` is classified as `missing`. Other
failures are `error`, with Stripe's message. `allOk` is true only when every row is
`ok`. Listing Webhook Endpoints alone does not prove create/delete access.

## Adopting existing Stripe subscriptions

Adoption connects a live subscription in the tenant's existing Stripe account to
an existing Together member and product. Together does not create or modify a
Stripe subscription, price, customer, payment method or billing schedule during
adoption. Subsequent invoices, payment failures and cancellations use the native
subscription lifecycle and the tenant's configured Stripe customer portal.

1. Connect the tenant's existing Stripe account in Studio. The restricted key must
   permit reading subscriptions and customers. Configure the Together webhook for
   that account, including `invoice.paid`, `invoice.payment_failed`,
   `customer.subscription.updated` and `customer.subscription.deleted`. Configure
   the account's customer portal login URL in the tenant's Stripe settings.
2. Import or create the members and products first. Confirm member email addresses
   match the corresponding Stripe customers. Stop the old platform from changing
   subscription access after the migration cutover; adoption itself leaves Stripe
   billing untouched.
3. Select the tenant and inventory its subscriptions:

   ```sh
   together --tenant acme --json subscriptions list-stripe --status active --unadopted
   together --tenant acme --json subscriptions list-stripe --status past_due --unadopted
   ```

   Each page contains at most 100 Stripe subscriptions and a `nextCursor`. Continue
   with `--starting-after <nextCursor>` until the cursor is null, including when a
   filtered page is empty. Each result includes the Stripe ID, status, provider
   price ID and an `adopted` flag. Customer emails are omitted from the inventory.
4. Adopt each subscription, selecting the Together product it grants:

   ```sh
   together --tenant acme --json subscriptions adopt \
     --subscription sub_example --member member-example --product product-example
   ```

   `--member` accepts a member ID or email. `--price` optionally selects an existing
   recurring price on that product; it must be either unlinked or already linked to
   the same Stripe price, and its amount, currency and interval may differ from
   Stripe. Without it, adoption reuses the price whose provider price ID equals the
   Stripe price, or creates an inactive price marked `imported`, with
   `provider_price_id` and Stripe's amount, currency, interval and interval count.
   Imported prices cannot be activated or used for new checkout sessions. No
   historical order is invented.
5. Review the result: `subscriptionCreated`, `priceCreated`, `grantCreated` and
   `grantExtended` distinguish new records from reused ones. Repeating the same
   adoption is both safe and the supported recovery: it keeps the existing records,
   refreshes status, period end and cancellation flag from Stripe, recreates a
   deleted price or grant, and re-applies the extend-never-shorten access rule, so
   revoked access and a renewal missed during the cutover are restored. A different
   member, product or explicit price for an already owned Stripe subscription is
   refused.
6. Check the member's access and timeline in Studio. Adoption records an immutable
   `subscription-adopted` event whose payload contains only subscription and
   product/price IDs. Existing longer or lifetime access is preserved. A new or
   shorter grant reaches the Stripe period end. Future paid invoices apply the
   normal renewal and grace-period policy; failures and cancellations follow the
   existing subscription lifecycle.

Only `active` and `past_due` subscriptions are eligible. The subscription must be
retrievable with this tenant's restricted key. Adoption currently supports a
single fixed recurring price, including daily, weekly, monthly and yearly prices
and their interval counts. Multi-item or tiered subscriptions are refused rather
than represented with incomplete price information.

An absent or mismatched Stripe customer email is refused by default. After
independently verifying the customer/member mapping, an operator can explicitly
pass `--allow-email-mismatch`. The Studio member access action, **Adopt Stripe
subscription**, asks for the subscription ID and product and always checks email.
Erased members cannot receive an adopted subscription. The product must be published,
including when repeating adoption to reconcile existing access.

For automation, append `--api-key <secret>` to either CLI command, using a tenant
API key with `subscriptions:read` for listing or `subscriptions:adopt` for adoption.
These scopes are independent; use both when both operations are needed. Legacy
unscoped keys and enrollment-only keys cannot use either endpoint. Subscription
scopes cannot be combined with import scopes. The corresponding HTTP endpoints are
`POST /api/m2m/subscriptions/adopt` and `GET /api/m2m/subscriptions/stripe`, with
`x-api-key` and the normal tenant selection header or hostname. The POST body is:

```json
{
  "subscriptionId": "sub_example",
  "memberId": "member-example",
  "productId": "product-example"
}
```

Use exactly one of `memberId` or `email`; optional fields are `priceId` and
`allowEmailMismatch`. The listing query accepts `status`, `unadopted=true` and
`startingAfter`. Both M2M endpoints share a tenant limit of 60 requests per minute.
Studio and signed-in CLI sessions require the corresponding `subscriptions:read`
or `subscriptions:adopt` capability, granted only to owners and admins.

Adoption does not replay invoices received before the local subscription existed.
Schedule the cutover so webhook delivery and adoption overlap as little as
possible, then reconcile any invoices delivered during the transition. Keep
existing customer portal configuration on the same Stripe account; customers
continue using their existing subscription and payment method.
