# Sales links

A product remains one sellable item. A sales link combines an ordered set of
products into one offer at `/offer/<slug>` on the workspace host. The buyer cannot
remove a line or change its quantity. Each product appears once, with its name,
VAT rate, net amount, VAT amount and gross amount. The total is the sum of the
gross amounts. Descriptions use the shared sanitized Markdown renderer.

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

Coupons apply to the total. A product-scoped coupon must cover every included
product; unsupported coupons use the existing rejection message. Billing fields,
terms acceptance and optional marketing consents retain their existing behavior;
attached marketing consents are combined across included products.

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
The collection link and QR follow this purchase block. Its linked QR image encodes
`https://<workspace host>/panel/orders/verify/<token>`. The stored token contains
244 random bits and is independent of the order number. The mailer transports
do not support inline attachments, so the image uses the public token-based PNG
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
Create and update accept `--input` JSON; update includes `id` and
`expectedRevision`. `checkout session` and the local `simulate-purchase` command
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
