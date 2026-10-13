# Sales links

A product remains one sellable item. A sales link combines an ordered set of
products into one offer at `/offer/<slug>` on the workspace host. The buyer cannot
remove a line or change its quantity. Each product appears once in Stripe Checkout, with quantity one. The total is
the sum of the gross amounts. The Together fallback page also shows each VAT
rate and the net, VAT and gross amounts, with sanitized Markdown descriptions.

Create and manage links in **Products → Sales links**. The internal title helps
staff distinguish offers; the heading and description address buyers. Copy the
public URL from the shared copy field. Links are unlisted by default. Listed,
active offers are discoverable from the public offer; unlisted offers require
the direct URL. Inactive, unknown, deleted, future and expired links return the
same not-found result. Validity starts inclusively and ends exclusively. Studio
uses Europe/Warsaw wall-clock time and stores UTC instants.

A common two-link pattern combines a digital item with an in-person physical
item in one offer, and sells only the digital item through another offer. Both
links use the same underlying products. Orders retain the originating sales-link
identifier, allowing staff to distinguish the two purchase paths.

Activation requires published products in one currency with active one-time
non-imported prices (exactly one per product) and resolved VAT rates. Recurring membership purchases remain on their
existing checkout path. Publication changes are checked again when an offer is
read or checkout begins. Delete is available only before the first paid order;
after payment, deactivate instead. Refunded orders still preserve that history.
Edits use a revision check so one editor cannot silently overwrite another.

## Product VAT and physical items

Products support 5%, 8%, 23%, or VAT exemption with a legal basis. New products
and imported products inherit the workspace's configured invoicing treatment
unless an explicit product rate is supplied. Products without an explicit rate continue following the current workspace
invoicing treatment. A workspace without an invoicing treatment can keep
drafts with unresolved VAT, but must configure VAT before activating a link.
Gross prices use integer cents. For a taxable line, net is
`round(gross × 100 / (100 + rate))`; VAT is the difference. Exempt lines have
zero VAT and net equal to gross.

Physical products use one-time prices and are collected in person. They have no shipping, course access,
download or grant. Their purchased record appears in My products with the
collection note. Each physical order line starts with `issuedCount = 0`.

## Checkout and accounting

One Stripe Checkout session contains one line item per product, quantity one.
The session identifies the sales link and product list and references a stored
checkout snapshot. The snapshot preserves the names, gross prices and VAT
breakdown even if staff later edit a product. Line gross amounts are list prices
before coupons; `amountCents` is the paid total after discounts. Legacy single-line
backfills and inserts from an older release reconstruct the list price as the
stored paid amount plus the stored discount, without consulting today's price. Fulfillment stores the snapshot
with one paid order and grants every nonphysical product through the existing
enrollment behavior. Refunds and reconciliation continue to count one payment.

Opening `/offer/<slug>` serves a live-only server-rendered handoff with the
sales-link heading and description in its title and Open Graph tags, plus the
tenant favicon. A centred card shows the tenant's checkout display name, HTTPS
logo when configured, accent colour, optional background colour and a CSS spinner.
It follows the system light or dark preference and uses system fonts.
Its script immediately posts to
`/api/public/sales-links/<slug>/checkout` and replaces the page with the Stripe
Checkout URL. The endpoint always creates live sessions and rejects a `mode`
field, including `mode: "test"` or `mode: "live"`, with a 400 validation error.
Without JavaScript, the page offers a POST form. The POST uses the
existing per-IP and per-tenant public-write limiter. A `/link/<key>` redirect to
an offer follows the same flow. GET requests never create a payment session.

The optional `cancelReturnUrl` sales-link field sets the return address for the
back arrow in direct Stripe Checkout. Studio shows it after the validity dates
as **Return address after cancelling**. The address must be an absolute HTTPS
URL of at most 2000 characters; surrounding whitespace is trimmed, and an empty
value clears it. Without a configured address, cancellation returns to the
platform offer page at `/offer/<slug>?status=cancelled`. Success still returns
to the platform offer page.

A sales page can send `/offer/<slug>?return=<encoded-https-url>` to return to a
specific section. The handoff forwards this value as `returnUrl` in the checkout
POST body, including in the form used without JavaScript. It is accepted only
when it is an absolute HTTPS URL of at most 2000 characters and its parsed
origin matches `cancelReturnUrl`, including the scheme, host and port. An absent
or rejected request uses the configured address, or the platform offer page
when none is configured. A `/link/<key>` redirect preserves this query parameter.
The Together checkout page at `?checkout=together` keeps its existing cancellation
behaviour, regardless of the configured address or query parameter.

User agents matching the edge crawler list receive the same metadata without
scripts or forms: facebookexternalhit, Twitterbot, LinkedInBot, Slackbot,
Discordbot, WhatsApp, TelegramBot, Googlebot, redditbot and Applebot. The checkout
POST also refuses these crawlers. The edge forwards crawler requests before
browser fallbacks, including `?checkout=together` and `status=success|cancelled`.

Staff test purchases use the Together checkout page at `/checkout/<productRef>`
or `/offer/<slug>?checkout=together` and its **Stripe test mode** switch.
These pages never hand off automatically. The switch uses the configured Stripe
test key and the existing server-side test session bound to the signed-in account
and tenant, with tenant staff membership checked again at checkout. An unreadable
stored test key or a live key in the test slot returns an error for an authorized
test checkout instead of switching to live credentials.
Cancelled staff test checkout returns to `?checkout=together`. Retry stays on the
Together page and requires a manual checkout action. The switch reflects the
staff test session; enable it again before starting another test purchase.

Staff test checkout stores a pending order before returning the Stripe URL.
Fulfillment keeps the member and test grants while suppressing purchase
confirmation email and magic links. Test payments keep the TEST indicator,
do not unlock real access and are excluded from revenue. A return query alone
does not enable the TEST indicator for anonymous visitors. A test event for
one tenant cannot fulfill a checkout for another tenant.

Stripe collects the buyer email, name, billing address when provided, and tax
IDs. A Polish `eu_vat` value prefixed with `PL` becomes the order's digits-only
NIP. Foreign and incomplete billing addresses are retained without a Polish NIP.
The All-orders invoice scope accepts consumer country-and-postcode-only billing
and preserves the other collected fields. A NIP is optional; the B2B-only scope
continues to skip orders without one. iFirma supports domestic addresses only.
Stripe requires terms acceptance; Together records that acceptance with the
exact terms and privacy URLs stored in session metadata. Set a valid account
terms URL once in the Stripe Dashboard. Together supplies a per-session agreement
linking the tenant's terms and privacy URLs. A tenant missing either legal URL
receives an error page without a checkout session, including on the Together
fallback; its checkout endpoint also enforces both URLs. Promotion codes are disabled
in direct checkout.

If any included product has purchase consent checkboxes configured, the offer
uses the existing Together checkout at `?checkout=together`. Attached marketing
consents are combined across all products. Its existing billing fields and
coupons remain available; a product-scoped coupon must cover every included
product. Success and cancellation return to the Together page without restarting
the automatic handoff.

Owners configure **Integrations → Stripe → Checkout appearance**: display name,
HTTPS logo and icon URLs, background and button hex colours, font and corners.
Empty overrides use the tenant branding in Settings (name, logo, accent colour
and favicon). Sales links, single-product checkout and subscriptions send these
resolved `branding_settings` to Stripe in both live and test mode. If all
overrides and branding defaults are empty, Stripe uses its account appearance.
See [Payments](payments.md).

Invoices contain one position per order line with its own treatment. Coupon
discounts are allocated deterministically across invoice positions so their
sum equals the amount paid. Every position is treated as delivered at the time
of sale. See [Invoicing](invoicing.md).

## Purchase confirmation and collection

The existing `welcome-sign-in` email also serves as the purchase confirmation;
its timing and number of messages do not change. With a purchase block, its
subject is "Purchase confirmation <order number> — <workspace name>" in English
or the equivalent in Polish. Without a purchase block, the account-ready subject
is unchanged. It lists the order number, then a table of purchased item names,
gross amounts formatted in the order currency, and VAT rates (5, 8 or 23 percent,
or a localized exemption label). The amounts use the same discount allocation
as invoice positions and sum to the paid total. VAT treatment uses explicit
line rates or exemptions. A line without a rate takes the first line's explicit
treatment when present, otherwise the tenant default, matching invoice positions.
An unresolved rate shows a dash in the VAT cell and no VAT parentheses
in the text version. A final bold total row shows the paid amount. The text
version lists each item with its amount and resolved VAT, followed by the total.
Legacy outbox rows with string lines or without currency and total retain the
item-name list. Both versions add the localized sentence: "This purchase
confirmation is not an invoice. If you need an invoice, contact us."
The purchase block is followed by the plain localized verification label
"Order verification code for the seller" above the QR image. The image has the
localized alt text "Order QR code", is unlinked and still encodes the staff
verification URL, `https://<workspace host>/panel/orders/verify/<token>`, for scanning. Neither
email version displays that URL. Social links remain after the verification block.
The stored token contains 244 random bits and is independent of the order number.
The mailer transports do not support inline attachments, so the image uses the public token-based PNG
endpoint `/api/public/orders/qr/<token>`. The URL uses the workspace's canonical
verified custom domain when present, otherwise its platform host. Opening the
verification link requires staff authentication; the QR image does not expose
the buyer or order details and is served without caching.

Staff with `order:read` can scan the QR, open verification from the order detail,
or enter an order number or token manually. Studio shows the payment status,
buyer name and email, and the purchased lines. Unknown tokens and tokens from
another workspace return not found.

Each physical line shows **issued N of 1**. Staff with `order:write` can select
**Mark as issued** on a paid order while the count is zero. Collection sets the
count to one and records the staff user and timestamp. Later scans show that
count and the first issue time, without another issue action. Concurrent or
repeated issue requests return a conflict once the line has been issued; they
do not change the counter or append another event. Scanning alone never changes
the count. Unpaid, refunded and partially refunded orders cannot be marked as issued. Physical collection changes neither
the order's financial amounts nor the invoice's sale-time tax point.

## CLI

The `sales-link` commands mirror Studio: `list`, `show`, `create`, `update`,
`activate`, `deactivate`, `delete --confirm`, and `offer <slug>`.
`sales-link checkout <slug>` starts the live-only direct Stripe handoff
and returns its URL using the same public endpoint as the server-rendered page.
`--mode live` remains supported; `--mode test` returns a validation error without
starting checkout. Staff test purchases use the Together checkout page switch.
Create and update accept `--input` JSON; update includes `id` and
`expectedRevision`. The JSON can include `cancelReturnUrl` as an HTTPS address
or `null` to clear it. Activate and deactivate preserve the configured address.
`checkout session` and the local `simulate-purchase` command
accept `--sales-link <id>` with `--product <first-product-id>`. Product commands and import records accept product VAT.
See [Import API](import-api.md).

The `orders verify <reference>` command accepts the same token or order number
as Studio. `orders issue <orderId> <productId>` records a physical collection
with the same workspace scope, capabilities and payment checks.

## Rollout

Keep sales links inactive until every server and webhook worker has finished
rolling out the bundle-aware release. An older release ignores the checkout
snapshot metadata and can grant only the first product, recording one line for
the full payment; reconciliation cannot recover the omitted product list from
that order. Activate sales links only after the rollout is complete.
