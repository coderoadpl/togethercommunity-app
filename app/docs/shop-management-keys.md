# Shop management keys

A shop management key is a short-lived, revocable tenant API key for a shop
backend that administers one workspace's catalog, orders, settings and
integrations without a human session. It is a separate key kind
(`shop_management`) next to the existing keys (kind `legacy`): it uses the same
random secret, stores only its SHA-256 hash, travels in the `x-api-key` header
and is bound to exactly one workspace.

A shop management key is accepted only by the dedicated routes under
`/api/m2m/shop`. Every existing API-key route (reports, enrollment,
subscriptions, transactional e-mail, imports, marketing) answers `401 Invalid
API key` for it, and no session route accepts it.

## Status

| Surface | Status |
|---|---|
| Key kind, scopes, issuer, expiry, lifecycle audit | Available |
| Owner-session creation, listing and revocation (`/api/api-keys`, CLI `api-key`) | Available |
| Request authentication, issuer revalidation and rate limits | Available |
| Catalog routes: products, prices and stock (below) | Available |
| Order and fulfilment routes, including InPost ShipX (below) | Available |
| Shop settings and branding image routes (below) | Available |
| Typed client `createShopManagementClient` and CLI `shop` commands | Available |
| Product image, sales-link, invoice, refund and integration routes | Not yet available |

## Scopes

A shop management key carries one or more of these scopes and nothing else.
Shop scopes cannot be combined with `report:read`, `enrollment`, `marketing`,
`transactional`, `subscriptions:*` or `import:*` on one key, and a legacy key
cannot carry a shop scope. An existing unscoped legacy key never gains shop
access.

| Scope | Grants on the shop routes |
|---|---|
| `shop:catalog:read` | Read products, prices and stock |
| `shop:catalog:write` | Create, edit, publish and delete product drafts; manage prices and stock |
| `shop:orders:read` | Read and export orders |
| `shop:fulfilment:write` | Fulfil orders, including configured paid shipment creation |
| `shop:settings:read` | Read shop settings |
| `shop:settings:write` | Change the constrained shop settings |
| `shop:integrations:read` | Read masked integration configuration |
| `shop:integrations:write` | Configure and probe integrations |

Write scopes do not include the matching read scope. A key with
`shop:integrations:write` carries financial and configuration power: keep it
short-lived and separate from catalog or warehouse keys.

## Who can create one

Only the workspace owner, signed in with a verified e-mail address, in their
own session — not while viewing as a member and never with another API key.
The key records the issuing owner. Every request made with it will act with at
most the issuer's current authority, so a key stops working when its issuer is
no longer a verified owner of the workspace.

Creation and revocation each write a workspace audit event
(`api_key.shop_management_created`, `api_key.shop_management_revoked`) in the
same transaction as the key change. The event carries the owner's account and
e-mail and the key name and id, never the secret or its hash.

## Authenticating a request

A request to a shop route carries the key in `x-api-key` and selects the
workspace exactly like the other API-key routes: by the workspace host
(subdomain or verified custom domain) or, on the platform host, by the
`x-tenant` header. Every request is checked from scratch; nothing is cached
between requests:

1. A request that also carries a `Cookie` or an `Authorization` header is
   refused with `401` before the key is read. A shop route never falls back to
   a session, and a session never upgrades a key.
2. The key must exist in the selected workspace, be of kind `shop_management`,
   be unrevoked, carry only shop scopes and expire strictly after the current
   time. A missing key answers `401 Missing API key`; an unknown, revoked,
   expired, legacy or other-workspace key answers the same `401 Invalid API
   key`.
3. The issuing account must still exist, have a verified e-mail address and
   hold the owner role in that workspace. Otherwise the request answers `403`;
   demoting or removing the issuer, or deleting the account, takes effect on
   the next request.
4. The request is counted against the key's rate limits (below).
5. The key must carry the route's scope, otherwise `403 <scope> is not
   permitted`.

The request then acts as the issuing owner's real account, never as a
synthetic API-key user, so product versions, stock and fulfilment changes are
attributed to that account. Its permissions are the capabilities of the key's
scopes intersected with the owner's, never more; the key id travels with the
request for audit and diagnostics. The request never creates or edits a member
record.

Request telemetry records the route template, status and resolved identity;
it never records request headers, so the key secret does not reach traces or
error reports.

## Catalog routes

Each route reuses the request body, response envelope, validation and
use-case of its session counterpart under `/api/products`, including body field
names (`id` for update, publish and unpublish and for price deactivation;
`productId` for draft deletion, price creation and stock). The route checks the
scope, and the reused use-case checks the matching capability again. A product
or price id from another workspace answers `404 not_found`.

| Method and path | Scope | Session counterpart |
|---|---|---|
| `GET /api/m2m/shop/products` | `shop:catalog:read` | `GET /api/products` |
| `POST /api/m2m/shop/products` | `shop:catalog:write` | `POST /api/products` |
| `POST /api/m2m/shop/products/update` | `shop:catalog:write` | `POST /api/products/update` |
| `POST /api/m2m/shop/products/publish` | `shop:catalog:write` | `POST /api/products/publish` |
| `POST /api/m2m/shop/products/unpublish` | `shop:catalog:write` | `POST /api/products/unpublish` |
| `POST /api/m2m/shop/products/delete` | `shop:catalog:write` | `POST /api/products/delete` (existing draft-only policy) |
| `GET /api/m2m/shop/products/:productId/prices` | `shop:catalog:read` | `GET /api/products/:productId/prices` |
| `POST /api/m2m/shop/products/prices` | `shop:catalog:write` | `POST /api/products/prices` |
| `POST /api/m2m/shop/products/prices/deactivate` | `shop:catalog:write` | `POST /api/products/prices/deactivate` |
| `GET /api/m2m/shop/products/:productId/stock` | `shop:catalog:read` | `GET /api/products/:productId/stock` |
| `POST /api/m2m/shop/products/stock/enable` | `shop:catalog:write` | `POST /api/products/stock/enable` |
| `POST /api/m2m/shop/products/stock/adjust` | `shop:catalog:write` | `POST /api/products/stock/adjust` |
| `POST /api/m2m/shop/products/stock/threshold` | `shop:catalog:write` | `POST /api/products/stock/threshold` |

The examples below use the workspace host and read the key from the
environment; `<product-id>` and `<price-id>` are placeholders. On the platform
host, add `-H 'x-tenant: <workspace-slug>'`. Never send a cookie or an
`Authorization` header with the key.

```bash
SHOP=https://<workspace-host>/api/m2m/shop
KEY="x-api-key: $TOGETHER_SHOP_KEY"
JSON='content-type: application/json'

curl -s -H "$KEY" "$SHOP/products"
curl -s -H "$KEY" -H "$JSON" -d '{"title":"Printed handbook","type":"physical","priceCents":4900,"currency":"PLN"}' "$SHOP/products"
curl -s -H "$KEY" -H "$JSON" -d '{"id":"<product-id>","description":"Second edition"}' "$SHOP/products/update"
curl -s -H "$KEY" -H "$JSON" -d '{"productId":"<product-id>","kind":"one_time","amountCents":4900,"currency":"PLN"}' "$SHOP/products/prices"
curl -s -H "$KEY" "$SHOP/products/<product-id>/prices"
curl -s -H "$KEY" -H "$JSON" -d '{"id":"<price-id>"}' "$SHOP/products/prices/deactivate"
curl -s -H "$KEY" -H "$JSON" -d '{"productId":"<product-id>","onHand":20,"lowStockThreshold":5}' "$SHOP/products/stock/enable"
curl -s -H "$KEY" -H "$JSON" -d '{"productId":"<product-id>","delta":-2,"reason":"damaged"}' "$SHOP/products/stock/adjust"
curl -s -H "$KEY" -H "$JSON" -d '{"productId":"<product-id>","lowStockThreshold":3}' "$SHOP/products/stock/threshold"
curl -s -H "$KEY" "$SHOP/products/<product-id>/stock"
curl -s -H "$KEY" -H "$JSON" -d '{"id":"<product-id>"}' "$SHOP/products/publish"
curl -s -H "$KEY" -H "$JSON" -d '{"id":"<product-id>"}' "$SHOP/products/unpublish"
curl -s -H "$KEY" -H "$JSON" -d '{"productId":"<product-id>"}' "$SHOP/products/delete"
```

A physical product publishes once it has an active one-time price; the
anonymous `GET /api/public/offer` then lists it.

### CLI

The `shop` command group reads the key from the environment variable named by
`--api-key-env` (default `TOGETHER_SHOP_KEY`), never from the command line, and
answers with a validation error (exit code of `validation`) when the variable is
empty. It sends the key and the selected workspace (`--tenant`) only, never the
signed-in session. Options mirror `product`, `price` and `product stock`.

```bash
export TOGETHER_SHOP_KEY=<secret from api-key create>
pnpm --silent run cli --tenant acme shop products list
pnpm --silent run cli --tenant acme shop products create --title 'Printed handbook' --type physical --price 49
pnpm --silent run cli --tenant acme shop products update <product-id> --description 'Second edition'
pnpm --silent run cli --tenant acme shop prices add --product <product-id> --kind one_time --price 49
pnpm --silent run cli --tenant acme shop prices list --product <product-id>
pnpm --silent run cli --tenant acme shop prices deactivate <price-id>
pnpm --silent run cli --tenant acme shop stock enable <product-id> --on-hand 20 --threshold 5
pnpm --silent run cli --tenant acme shop stock adjust <product-id> --delta -2 --reason damaged
pnpm --silent run cli --tenant acme shop stock threshold <product-id> --value none
pnpm --silent run cli --tenant acme shop stock show <product-id>
pnpm --silent run cli --tenant acme shop products publish <product-id>
pnpm --silent run cli --tenant acme shop products unpublish <product-id>
pnpm --silent run cli --tenant acme shop products delete <product-id> --confirm
```

### Typed client

`createShopManagementClient({ baseUrl, apiKey, tenant })` from `core/client`
exposes the thirteen calls with the same method names as the session client
(`listProducts`, `createProduct`, `updateProduct`, `publishProduct`,
`unpublishProduct`, `deleteProductDraft`, `listProductPrices`,
`createProductPrice`, `deactivateProductPrice`, `getProductStock`,
`enableProductStock`, `adjustProductStock`, `setProductStockThreshold`). It
sends `x-api-key` and, when `tenant` is set, `x-tenant`; it never sends an
`Authorization` header. Use it only from a backend.

## Order and fulfilment routes

Each route reuses the query or body, response, validation and use-case of its
session counterpart under `/api/orders`. Reads need `shop:orders:read`; every
action that changes an order needs `shop:fulfilment:write`, and a warehouse
integration usually carries both. An order id from another workspace answers
`404 not_found`. Shipments, line issues and ShipX events are recorded under the
issuing owner's account. Invoices and refunds are not available with a shop
management key; they stay on the staff session routes.

| Method and path | Scope | Session counterpart |
|---|---|---|
| `GET /api/m2m/shop/orders` | `shop:orders:read` | `GET /api/orders`, plus the `mode` filter |
| `GET /api/m2m/shop/orders/export` | `shop:orders:read` | `GET /api/orders/export` (live orders only) |
| `GET /api/m2m/shop/orders/packing-list` | `shop:orders:read` | `GET /api/orders/packing-list` |
| `GET /api/m2m/shop/orders/verify/:reference` | `shop:orders:read` | `GET /api/orders/verify/:reference` |
| `GET /api/m2m/shop/orders/:orderId` | `shop:orders:read` | `GET /api/orders/:orderId` |
| `POST /api/m2m/shop/orders/:orderId/ship` | `shop:fulfilment:write` | `POST /api/orders/:orderId/ship` |
| `POST /api/m2m/shop/orders/:orderId/lines/:productId/issue` | `shop:fulfilment:write` | `POST /api/orders/:orderId/lines/:productId/issue` |
| `GET /api/m2m/shop/orders/:orderId/shipx` | `shop:orders:read` | `GET /api/orders/:orderId/shipx` |
| `POST /api/m2m/shop/orders/:orderId/shipx` | `shop:fulfilment:write` | `POST /api/orders/:orderId/shipx` (buys the shipment) |
| `POST /api/m2m/shop/orders/:orderId/shipx/refresh` | `shop:fulfilment:write` | `POST /api/orders/:orderId/shipx/refresh` |
| `POST /api/m2m/shop/orders/:orderId/shipx/discard` | `shop:fulfilment:write` | `POST /api/orders/:orderId/shipx/discard` |
| `POST /api/m2m/shop/orders/:orderId/shipx/label` | `shop:fulfilment:write` | `POST /api/orders/:orderId/shipx/label` |

The order list accepts the session filters (`status`, `productId`, `kind`,
`couponId`, `fulfilmentStatus`, `source`, `sourceMatch`, `search`) and paging
(`page` from 1, `pageSize` up to 100, default 20), and additionally `mode=live`
or `mode=test`; any other mode answers `400 validation`. Without `mode` the
list returns both live and test orders, as the session list does. The export
and the packing list answer the session JSON envelope with `filename`,
`mimeType` and `content`; the label answers the PDF bytes with the session
route's `content-type`, `content-disposition: attachment` and
`cache-control: private, no-store` headers.

Fulfilment keeps the session rules. Shipping an order that has already been
shipped answers `409 fulfilment_conflict`; issuing a line that has already been
issued answers `409 conflict`. A manual shipment (`carrier` `other` or
`inpost` with a tracking number) needs no ShipX configuration and e-mails the
buyer the tracking number for a live order. `POST .../shipx` creates and pays
a real InPost shipment when the workspace's ShipX integration is configured for
production, so automate it only with explicit operational approval; a request
that finds another request working on the same shipment answers
`409 fulfilment_conflict` and should be retried later. `POST .../shipx/discard`
only forgets an attempt that ShipX did not confirm; it never cancels a shipment
in ShipX.

### Polling for orders to fulfil

There is no delivery webhook for orders. A fulfilment backend polls the list
with `mode=live`, so test checkouts never reach the warehouse, and
`fulfilmentStatus=to_pack`:

1. Request every page of
   `GET /api/m2m/shop/orders?mode=live&fulfilmentStatus=to_pack&pageSize=100`
   until `page * pageSize >= total`.
2. Overlap consecutive polls (for example, poll every five minutes and always
   re-read the whole to-pack list) instead of keeping a cursor; orders can move
   between pages while you read them.
3. De-duplicate by order `id`: keep a record of the ids you have already handed
   to the warehouse and skip them, and treat `409 fulfilment_conflict` on
   `ship` as "already shipped".
4. Ship or issue each order exactly once with the routes above; a shipped order
   leaves the `to_pack` list.

Stay within the key's rate limits below when sizing the poll interval.

```bash
SHOP=https://<workspace-host>/api/m2m/shop
KEY="x-api-key: $TOGETHER_SHOP_KEY"
JSON='content-type: application/json'

curl -s -H "$KEY" "$SHOP/orders?mode=live&fulfilmentStatus=to_pack&page=1&pageSize=100"
curl -s -H "$KEY" "$SHOP/orders/<order-id>"
curl -s -H "$KEY" "$SHOP/orders/verify/<qr-token-or-order-id>"
curl -s -H "$KEY" "$SHOP/orders/export?format=csv&fulfilmentStatus=to_pack"
curl -s -H "$KEY" "$SHOP/orders/packing-list?format=csv&mode=live"
curl -s -H "$KEY" -H "$JSON" -d '{"carrier":"other","trackingNumber":"<tracking-number>"}' "$SHOP/orders/<order-id>/ship"
curl -s -H "$KEY" -X POST "$SHOP/orders/<order-id>/lines/<product-id>/issue"
curl -s -H "$KEY" "$SHOP/orders/<order-id>/shipx"
curl -s -H "$KEY" -X POST "$SHOP/orders/<order-id>/shipx"
curl -s -H "$KEY" -X POST "$SHOP/orders/<order-id>/shipx/refresh"
curl -s -H "$KEY" -X POST -o label.pdf "$SHOP/orders/<order-id>/shipx/label"
curl -s -H "$KEY" -X POST "$SHOP/orders/<order-id>/shipx/discard"
```

### Order CLI

The `shop orders` commands take the key exactly like the catalog commands and
mirror the session `orders` commands; `list` additionally accepts `--mode`,
and `export`, `packing-list` and `shipx label` write to the `--out` path.

```bash
pnpm --silent run cli --tenant acme shop orders list --mode live --fulfilment to_pack --page-size 100
pnpm --silent run cli --tenant acme shop orders show <order-id>
pnpm --silent run cli --tenant acme shop orders verify <qr-token-or-order-id>
pnpm --silent run cli --tenant acme shop orders export --format csv --out orders.csv
pnpm --silent run cli --tenant acme shop orders packing-list --format csv --out packing.csv
pnpm --silent run cli --tenant acme shop orders ship <order-id> --carrier other --tracking <tracking-number>
pnpm --silent run cli --tenant acme shop orders issue <order-id> <product-id>
pnpm --silent run cli --tenant acme shop orders shipx show <order-id>
pnpm --silent run cli --tenant acme shop orders shipx create <order-id>
pnpm --silent run cli --tenant acme shop orders shipx refresh <order-id>
pnpm --silent run cli --tenant acme shop orders shipx label <order-id> --out label.pdf
pnpm --silent run cli --tenant acme shop orders shipx discard <order-id>
```

The typed client exposes the twelve calls with the session client's names:
`listOrders`, `exportOrders`, `ordersPackingList`, `verifyOrder`, `getOrder`,
`shipOrder`, `issueOrderLine`, `shipxShipment`, `shipxCreate`, `shipxRefresh`,
`shipxDiscard` and `shipxLabel`.

## Shop settings and branding routes

A settings key changes only the shop-facing part of the workspace settings
through a fixed allow-list. It never reaches the session settings route
`POST /api/tenant/settings`, which keeps answering `401` for a shop key.

| Method and path | Scope | Session counterpart |
|---|---|---|
| `GET /api/m2m/shop/settings` | `shop:settings:read` | `GET /api/tenant/settings`, allow-listed fields only |
| `POST /api/m2m/shop/settings` | `shop:settings:write` | `POST /api/tenant/settings`, allow-listed fields only |
| `POST /api/m2m/shop/image-assets/branding/upload` | `shop:settings:write` | `POST /api/image-assets/branding/upload` |
| `POST /api/m2m/shop/image-assets/branding/complete` | `shop:settings:write` | `POST /api/image-assets/branding/complete` |

Both settings routes answer `{ "settings": { ... } }` with exactly these
fields, which are also the only fields the write accepts:

| Area | Fields |
|---|---|
| Name and language | `name`, `defaultLanguage` |
| Brand | `logoUrl`, `logoDarkUrl`, `faviconUrl`, `accentColor`, `accentLight`, `ogImageUrl`, `socialLinks` |
| Checkout | `checkoutAppearance` |
| Support and legal | `supportEmail`, `supportUrl`, `termsUrl`, `privacyUrl` |
| Seller and invoicing | `invoiceSellerName`, `invoiceSellerAddress`, `invoiceVatMode`, `invoiceVatRatePercent`, `invoiceExemptionBasisKind`, `invoiceExemptionBasis`, `invoicingProvider`, `autoIssueInvoices`, `autoIssueInvoiceScope`, `ksefSubmissionMode` |
| Shipping | `shippingRates`, `inpostGeowidgetToken` |

Team and permissions, workspace lifecycle and plan, the public home, course and
video settings, the sign-in notice, direct messages, analytics and the Meta
Conversions API stay on the owner session. A write that names any other field,
including a misspelt one, answers `400 validation` and changes nothing; unknown
fields are never silently dropped. Each field keeps the validation of the
session settings route.

Merge and clear semantics:

- A field left out of the body keeps its stored value; `{}` changes nothing.
- `null` clears a field where the session route allows clearing: the brand
  image URLs, `accentColor`, `accentLight`, `supportEmail`, `supportUrl`,
  `termsUrl`, `privacyUrl`, `checkoutAppearance`, `invoiceSellerName`,
  `invoiceSellerAddress`, `invoiceVatRatePercent`, `invoiceExemptionBasisKind`,
  `invoiceExemptionBasis` and `inpostGeowidgetToken`. An empty string clears
  the same URL, e-mail, colour, exemption basis and Geowidget token fields.
- `name`, `defaultLanguage`, `invoiceVatMode`, `invoicingProvider`,
  `autoIssueInvoices`, `autoIssueInvoiceScope` and `ksefSubmissionMode` cannot
  be cleared; `null` answers `400 validation`. Send `[]` to remove every social
  link or shipping rate.
- `socialLinks`, `shippingRates` and `checkoutAppearance` are replaced as a
  whole, never merged entry by entry.
- VAT stays coherent after the merge, as in the session route: `exempt` clears
  the rate, `rate` clears the exemption basis, and `exempt` without a usable
  legal basis answers `422 invoice_exemption_basis_missing`.

A branding image upload works like the session flow. `upload` takes
`{"kind":"logo","fileName":"logo.png","contentType":"image/png","sizeBytes":1234}`
with kind `logo`, `logo-dark`, `favicon` or `share-image` and answers a
private candidate `key` and a signed `upload.url`; `PUT` the bytes there with
the returned headers and send `{"key":"<candidate-key>"}` to `complete`, which
checks the workspace, size and image signature and answers the published
`url`. Set that URL as `logoUrl`, `logoDarkUrl`, `faviconUrl` or `ogImageUrl`
with a settings write. A candidate key of another workspace answers
`404 not_found`.

```bash
curl -s -H "$KEY" "$SHOP/settings"
curl -s -H "$KEY" -H "$JSON" -d '{"termsUrl":"https://brand.example.test/terms","invoiceSellerName":"Example Press","shippingRates":[{"id":"courier","label":"Courier","amountCents":1500,"vatRatePercent":23,"carrier":"other","pickupPoint":"none","active":true}]}' "$SHOP/settings"
curl -s -H "$KEY" -H "$JSON" -d '{"supportUrl":null}' "$SHOP/settings"
```

### Settings CLI

`shop settings set` reads the JSON object from `--json-file <path>`, or from
stdin with `--json-file -`, and checks it against the allow-list before the
request. `shop branding upload <kind> <file>` runs upload, the signed `PUT`
and complete, and prints the published URL; the file extension selects the
content type.

```bash
pnpm --silent run cli --tenant acme shop settings show
pnpm --silent run cli --tenant acme shop settings set --json-file shop-settings.json
echo '{"privacyUrl":"https://brand.example.test/privacy"}' | pnpm --silent run cli --tenant acme shop settings set --json-file -
pnpm --silent run cli --tenant acme shop branding upload logo ./logo.png
```

The typed client exposes `getSettings`, `updateSettings` and
`uploadBrandingAsset`.

## Rate limits

Each key has its own durable buckets on the shop routes: **60 requests a
minute** and **10,000 requests a day**. A request over either limit answers
`429 rate_limited` with a `Retry-After` header in seconds until the current
window ends.

## Lifetime

An expiry is mandatory and may be at most **30 days** after creation. Seven
days is the suggested lifetime; the server applies no default. There is no
renewal: rotate instead.

## Bootstrap

```bash
pnpm --silent run cli --tenant acme api-key create 'Shop backend' \
  --kind shop_management \
  --scope shop:catalog:read shop:catalog:write \
  --expires-at 2026-11-21T00:00:00.000Z
```

The secret is printed once. Store it in the shop backend's secret store; it
cannot be shown again. `api-key list` shows each key's kind and state without
the secret. The same operations are available over HTTP with the owner session:
`POST /api/api-keys` with `{"name", "kind": "shop_management", "scopes",
"expiresAt"}`, `GET /api/api-keys`, `DELETE /api/api-keys/:id`.

## Rotate and revoke

1. Create a replacement key with the same scopes.
2. Deploy it to the shop backend and verify a request succeeds with it.
3. Revoke the old key: `api-key revoke <old-id>`.

Revocation takes effect on the next request; keys are not cached between
requests.

## Rollback

Retain the schema on rollback. After shop management scopes have been
persisted, do not roll back to a binary whose key schema cannot parse them.
If a retreat is needed, disable only the new route registration and revoke the
shop management keys.

See also the [CLI reference](cli.md) and [security notes](security.md).
