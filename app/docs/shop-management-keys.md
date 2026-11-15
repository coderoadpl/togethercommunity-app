# Shop management keys

A shop management key is a short-lived, revocable tenant API key for a shop
backend that administers one workspace's catalog, orders, settings and
integrations without a human session. It lives in its own table,
`shop_management_keys`, apart from the existing tenant API keys
(`tenant_api_keys`, called legacy keys below), which it never reads or changes.
It uses the same kind of random secret, stores only its SHA-256 hash, travels in
the `x-api-key` header and is bound to exactly one workspace.

A shop management key is accepted only by the dedicated routes under
`/api/m2m/shop`. Every existing API-key route (reports, enrollment,
subscriptions, transactional e-mail, imports, marketing) answers `401 Invalid
API key` for it, because those routes look keys up only in `tenant_api_keys`,
and no session route accepts it. The shop routes look keys up only in
`shop_management_keys`, so a legacy key never reaches them.

## Status

| Surface | Status |
|---|---|
| Key table, scopes, issuer, expiry, key history | Available |
| Owner-session creation, listing and revocation (`/api/api-keys/shop-management`, CLI `api-key shop-management`) | Available |
| Kill switch `SHOP_MANAGEMENT_KEYS` and owner-session purge | Available |
| Request authentication, issuer revalidation and rate limits | Available |
| Catalog routes: products, prices and stock (below) | Available |
| Order and fulfilment routes, including InPost ShipX (below) | Available |
| Shop settings and branding image routes (below) | Available |
| Typed client `createShopManagementClient` and CLI `shop` commands | Available |
| Product cover image and sales-link routes (below) | Available |
| Payment, storage, shipping and invoicing credential routes (below) | Available |
| Builder guide, error taxonomy and deployment checklist (below) | Available |
| End-to-end replay with three keys (`scripts/shop-machine-replay.test.ts`) | Available |
| Invoices and refunds | Not offered with a shop key; staff session routes only |

## Backend only

A shop management key is a server-side credential. Keep it in the shop
backend's secret store and send it only from that backend:

- Never put a key in a browser, a mobile app, a storefront bundle, a static
  site or a URL. The shop routes send no CORS headers, so a browser on another
  origin cannot read their answers, and a request that carries a cookie or an
  `Authorization` header is refused before the key is checked.
- Never log the key and never put it in a command-line argument. The curl
  examples below read the key header from a file only the current user can
  read; the CLI reads the key from an environment variable and never from its
  arguments.
- Use one key per job and the narrowest scopes: a provisioning key for settings
  and integrations, a catalog key, and a warehouse key. Revoking one never
  disturbs the others.

The storefront itself needs no key: the anonymous public offer and the
checkout handoff (see [Selling](#selling-public-offer-checkout-and-return))
are open to any origin.

## Scopes

A shop management key carries one or more of these scopes and nothing else.
Shop scopes cannot be combined with `report:read`, `enrollment`, `marketing`,
`transactional`, `subscriptions:*` or `import:*` on one key, and a legacy key
cannot carry a shop scope. An existing unscoped legacy key never gains shop
access.

| Scope | Grants on the shop routes |
|---|---|
| `shop:catalog:read` | Read products, prices, stock and sales links |
| `shop:catalog:write` | Create, edit, publish and delete product drafts; manage prices, stock, covers and sales links |
| `shop:orders:read` | Read and export orders |
| `shop:fulfilment:write` | Fulfil orders, including creating carrier shipments (a paid action at the carrier) |
| `shop:settings:read` | Read shop settings |
| `shop:settings:write` | Change the constrained shop settings |
| `shop:integrations:read` | Read the masked secret list and the masked ShipX settings |
| `shop:integrations:write` | Configure Stripe, storage and ShipX, probe Stripe, set and delete the iFirma and KSeF credentials |

Write scopes do not include the matching read scope. A key with
`shop:integrations:write` carries financial and configuration power: keep it
short-lived and separate from catalog or warehouse keys. A key with
`shop:fulfilment:write` can create carrier shipments, a paid action at the
carrier: the scope grants `order:write`, which the InPost ShipX shipment
creation requires.

> **Warning: a `shop:integrations:write` key can configure the live payment
> slot.** It may replace the restricted key of the **live** Stripe slot, the
> one anonymous buyers pay through, not only the test slot. Real payments then
> go to whichever Stripe account the new restricted key belongs to. This is
> deliberate, so that payments can be provisioned with a key, and no extra
> confirmation is asked. Treat such a key like the owner's own payment
> credentials: issue it only to a provisioning backend, with the shortest
> expiry, and revoke it as soon as provisioning ends. See
> [Integration routes](#integration-routes).

## Who can create one

Only the workspace owner, signed in with a verified e-mail address, in their
own session — not while viewing as a member and never with another API key.
The key records the issuing owner. Every request made with it will act with at
most the issuer's current authority, so a key stops working when its issuer is
no longer a verified owner of the workspace.

Creation and revocation each write a key event (`created`, `revoked`) to the
dedicated shop management key history (below) in the same transaction as the
key change. A purge writes one `purged` event per deleted key in the same
transaction as the deletion. These events carry the key id and the owner's
account id, never the secret or its hash. They are not workspace audit events:
the workspace audit list (`GET /api/tenant/audit-events`) is unchanged by shop
management keys.

## Authenticating a request

A request to a shop route carries the key in `x-api-key` and selects the
workspace exactly like the other API-key routes: by the workspace host
(subdomain or verified custom domain) or, on the platform host, by the
`x-tenant` header. Every request is checked from scratch; nothing is cached
between requests:

1. A request that also carries a `Cookie` or an `Authorization` header is
   refused with `401` before the workspace is resolved or the key is looked up;
   telemetry records only the refusal reason (below). A shop route never falls
   back to a session, and a session never upgrades a key.
2. The key must exist in `shop_management_keys` for the selected workspace, be
   unrevoked and expire strictly after the current time; the database admits
   only shop scopes, an issuer and an expiry on such a row. A missing key
   answers `401 Missing API key`; an unknown, revoked, expired, legacy or
   other-workspace key answers the same `401 Invalid API key`.
3. The issuing account must still exist, have a verified e-mail address and
   hold the owner role in that workspace. Otherwise the request answers the
   same `401 Invalid API key` as every other unusable key, so a caller cannot
   tell an issuer change from a revoked or unknown key; demoting or removing
   the issuer, or deleting the account, takes effect on the next request.
4. The request is counted against the key's rate limits (below).
5. The key must carry the route's scope, otherwise `403 <scope> is not
   permitted`.

The request then acts as the issuing owner's real account, never as a
synthetic API-key user, so product versions, stock and fulfilment changes are
attributed to that account. Its permissions are the capabilities of the key's
scopes intersected with the owner's, never more; the key id travels with the
request for its key history and diagnostics. The request never creates or edits a member
record.

Request telemetry records the route template, status and resolved identity.
For an accepted shop request that identity is the issuing owner
(`app.user.id`, `app.user.email`, `app.tenant.id`, `app.tenant.slug`).

Every request to a shop route, accepted or refused, also records which key it
presented in `app.api_key.match`:

| `app.api_key.match` | Meaning | Also recorded |
|---|---|---|
| `matched` | The secret matches a shop management key row in the selected workspace, whatever its state: usable, revoked, expired, or with an issuer that is no longer a verified owner | `app.api_key.id`, `app.api_key.issuer.id`, `app.tenant.id` |
| `none` | The secret matches no shop management key of the selected workspace (a legacy key included), or no workspace was selected | `app.tenant.id` when a workspace was selected |
| `missing` | The request carried no key | `app.tenant.id` when a workspace was selected |
| `mixed_credentials` | The request also carried a `Cookie` or an `Authorization` header and was refused with `401` | nothing else: the refusal performs no key lookup |
| `switch_off` | `SHOP_MANAGEMENT_KEYS=disabled` answered the request (see the kill switch below) | nothing else: the switch records only its state and performs no key lookup |

A request refused by the body size limit (`400 validation`, checked before the
shop route runs) is not attributed to a key: its span carries no
`app.api_key.*` attribute, the key is not looked up and no key history row is
written.

So a `401` for an unusable key, a `403` for a missing scope, a `429` and a
failing handler each carry the id of the key that was presented; a `401` for
mixed credentials carries none. The secret, its hash and any part of either are never recorded,
and telemetry never records request headers, so the key secret does not reach
traces or error reports. A database failure while looking a shop management
key up by its hash or while storing a new one answers `500 internal` and is
reported as `API key lookup failed` or `API key write failed` without the query
or its parameters, so the hash never reaches a trace, a log or a response. The
legacy key routes keep their own error handling unchanged.

## Key history

Every workspace keeps a durable history of its shop management keys in its own
table, separate from the workspace audit list. Each row carries the key id, the
kind of event, the acting account and the time:

| Kind | Written | Acting account |
|---|---|---|
| `created` | with the key, in the same transaction | the owner who created it |
| `revoked` | with the revocation, in the same transaction | the owner who revoked it |
| `purged` | one row per deleted key, in the purge transaction | the owner who purged |
| `request` | before the handler of every keyed `POST`, `PUT`, `PATCH` or `DELETE` to a shop route that passed the key, issuer, rate-limit and scope checks | the key's issuer |

A `request` row means the key surface accepted the request and handed it to the
route's handler. It records the method, the route template (for example
`/api/m2m/shop/products/update`) and the id of the resource the request names
(the first path parameter, else the body's `id` or `productId`; for
`POST /api/m2m/shop/integrations/secrets` the body's `key`, the name of the
secret and never its value, and only when it is an allow-listed name; none when
the request names no existing resource, such as a product or sales-link
creation, a settings change or a payment, storage or carrier configure call).
It records no status or outcome: what the handler then did, a change, a
validation error or a failure, is in request telemetry only. The resource id is
kept only when it looks like an identifier: at most 200 characters, starting
with a letter or digit and continuing with letters, digits, `.`, `_`, `:` or
`-` (ASCII only). Anything else is stored as no resource id, and the database
enforces both rules with its own checks: a length check of at most 200
characters and the pattern `^[A-Za-z0-9][A-Za-z0-9._:-]*$`. The shared shop
route helper writes the row, so every shop route inherits it.

The row is written before the handler runs, so no keyed change commits without
its history row, and nothing is written after the handler, so a committed
change is never answered with an error because of its history. When the row
cannot be written, the request is refused with `503 unavailable` and a
`Retry-After` header, the handler does not run and nothing is changed; the
request still counts against the rate limits, and the failure is recorded in
request telemetry. Retrying is safe.

A request refused before the handler writes no row: the off switch, the body
size limit, mixed credentials, a missing, unknown, revoked, expired, legacy or
other-workspace key, an issuer who no longer qualifies, a rate-limit refusal
(`429`) and a missing scope (`403`) are recorded in request telemetry only
(above). A refusal returned by the handler itself, such as a validation error,
a product or price id of another workspace (`404`) or a conflict, does have a
`request` row, because the row is written before the handler runs; the row does
not say that the handler refused. Reads (`GET`) write no row; they are
attributed in request telemetry only.

A history row stores the key id as plain text and is never deleted with its
key, so the history of a revoked or purged key stays readable. It goes away only
with the workspace itself: a retention job for `shop_management_key_events` is a
follow-up and does not exist yet. The rate limits bound its growth per key: a
key makes at most 10,000 requests a day, so it adds at most 10,000 `request`
rows a day. The bound multiplies by the number of keys, and the number of shop
management keys per workspace is not capped.

The owner reads the history with the same verified owner session as creation
(an admin, an unverified owner, an owner viewing as a member and any API key
are refused), newest first, 50 rows a page by default and at most 100:

```bash
pnpm --silent run cli --tenant acme api-key shop-management events
pnpm --silent run cli --tenant acme api-key shop-management events --key <key-id> --limit 20
pnpm --silent run cli --tenant acme api-key shop-management events --cursor <event-id>
```

Over HTTP: `GET /api/api-keys/shop-management/events?keyId=<key-id>&cursor=<event-id>&limit=<n>`
answers `{"events": [...], "nextCursor": <event-id or null>}`; pass
`nextCursor` back as `cursor` for the next page. A key id from another
workspace lists nothing.

## Catalog routes

Each route reuses the request body, response envelope, validation and
use-case of its session counterpart under `/api/products`, including body field
names (`id` for update, publish and unpublish and for price deactivation;
`productId` for draft deletion, price creation and stock). The route checks the
scope, and the reused use-case checks the matching capability again. A product
or price id from another workspace answers `404 not_found`.

Request bodies on every shop route are strict: a field the route does not
know, at the top level or inside a nested object such as `compliance`, an
`accessItems` entry, `checkoutAppearance`, a `socialLinks` or `shippingRates`
entry, or the ShipX `sender`, answers `400 validation` and nothing is written.
The order list, export and packing-list routes reject an unknown query
parameter the same way. A misspelt field therefore fails instead of being
dropped. The session routes keep ignoring unknown fields.

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

The examples below use the workspace host; `<product-id>` and `<price-id>`
are placeholders. On the platform host, add `-H 'x-tenant: <workspace-slug>'`.
Never send a cookie or an `Authorization` header with the key.

Never put the key, or any other secret, into a command-line argument: other
users and process listings on the host can read the arguments of a running
process. The examples write the key header once into a file only the current
user can read and let curl read it with `-H @file` (curl 7.55 or newer);
`printf` and `read` are shell builtins and start no process. A body that
carries a secret goes through stdin the same way (see
[Integration routes](#integration-routes)). Delete the header file when the job
ends.

```bash
SHOP=https://<workspace-host>/api/m2m/shop
umask 077
printf 'x-api-key: %s\n' "$TOGETHER_SHOP_KEY" > shop-key.header
KEY=@shop-key.header
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
read -r TOGETHER_SHOP_KEY < shop-catalog.key && export TOGETHER_SHOP_KEY
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
`Authorization` header. It never follows a redirect, same-origin or not: a
`30x` answer fails the call with `internal` (CLI exit code 10) and the message
`Shop management request to <path> refused a redirect`, so the key never
reaches another URL. Use it only from a backend.

## Product covers and sales links

These routes reuse the session image-asset and sales-link schemas and use-cases.
Cover upload and completion require `shop:catalog:write`. Completion checks the
candidate workspace, size and image signature before publishing it; it returns a
public asset URL without changing any product. Attach it with product update.
The public asset URL retains its existing redirect to signed storage.

| Method and path | Scope | Session counterpart |
|---|---|---|
| `POST /api/m2m/shop/image-assets/product-cover/upload` | `shop:catalog:write` | `POST /api/image-assets/product-cover/upload` |
| `POST /api/m2m/shop/image-assets/product-cover/complete` | `shop:catalog:write` | `POST /api/image-assets/product-cover/complete` |
| `GET /api/m2m/shop/sales-links` | `shop:catalog:read` | `GET /api/sales-links` |
| `POST /api/m2m/shop/sales-links` | `shop:catalog:write` | `POST /api/sales-links` |
| `GET /api/m2m/shop/sales-links/:id` | `shop:catalog:read` | `GET /api/sales-links/:id` |
| `POST /api/m2m/shop/sales-links/:id` | `shop:catalog:write` | `POST /api/sales-links/:id` |
| `DELETE /api/m2m/shop/sales-links/:id` | `shop:catalog:write` | `DELETE /api/sales-links/:id` |

Sales-link creation returns `201`. Updates require the full editable fields,
`id` matching the path, and `expectedRevision` from the latest read; a stale
revision returns the existing `409 conflict`. Foreign sales-link ids return
`404 not_found`. The same publication, product ownership, subscription and VAT
checks apply as on session routes. Write scope does not grant read access.

The typed client exposes `uploadProductCover`, `listSalesLinks`, `getSalesLink`,
`createSalesLink`, `updateSalesLink` and `deleteSalesLink`. The cover helper runs
upload → signed storage PUT → completion; only the two API requests carry the
shop key, never the storage PUT. `shop cover upload` first reads the product's
prices to check that the product exists in the key's workspace, so its key needs
`shop:catalog:read` as well as `shop:catalog:write`; an unknown product fails
with `not_found` (exit code 5) before anything is uploaded. The CLI adds the
product update after successful completion, and never updates the product when
upload or completion fails.

```bash
pnpm --silent run cli --tenant acme shop cover upload <product-id> ./cover.png
pnpm --silent run cli --tenant acme shop sales-links list
pnpm --silent run cli --tenant acme shop sales-links show <sales-link-id>
pnpm --silent run cli --tenant acme shop sales-links create --json-file ./sales-link.json
pnpm --silent run cli --tenant acme shop sales-links update <sales-link-id> --json-file ./sales-link-update.json
pnpm --silent run cli --tenant acme shop sales-links delete <sales-link-id>
```

Creation file example (replace the product id with a product of the workspace):

```json
{
  "slug": "handbook-bundle",
  "title": "Handbook bundle",
  "heading": "Buy the printed handbook",
  "productIds": ["<product-id>"],
  "active": false
}
```

For updates, include all editable fields and `expectedRevision` (for example,
`1` after creation). The CLI inserts `id` from its argument; if the file also
contains `id`, it must match. It never fetches or invents a revision. Both JSON
commands accept `--json-file -` for stdin. As with the other shop commands,
`--api-key-env <name>` selects the environment variable holding the key; a
stored session is never used.

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
   `ship` as "already shipped". A `503 unavailable` on `ship` means its key
   history row could not be written and the order was not shipped: retry the
   same call after `Retry-After` seconds.
4. Ship or issue each order exactly once with the routes above; a shipped order
   leaves the `to_pack` list.

Stay within the key's rate limits below when sizing the poll interval.

```bash
SHOP=https://<workspace-host>/api/m2m/shop
umask 077
printf 'x-api-key: %s\n' "$TOGETHER_SHOP_KEY" > shop-key.header
KEY=@shop-key.header
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
| Brand | `logoUrl`, `logoDarkUrl`, `faviconUrl`, `accentColor`, `accentLight`, `socialLinks` |
| Link previews (Open Graph) | `ogTitle` (at most 70 characters), `ogDescription` (at most 200 characters), `ogImageUrl` |
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
  image URLs, `accentColor`, `accentLight`, `ogTitle`, `ogDescription`,
  `supportEmail`, `supportUrl`, `termsUrl`, `privacyUrl`, `checkoutAppearance`,
  `invoiceSellerName`, `invoiceSellerAddress`, `invoiceVatRatePercent`,
  `invoiceExemptionBasisKind`, `invoiceExemptionBasis` and
  `inpostGeowidgetToken`. An empty string clears the same URL, e-mail, colour,
  Open Graph text, exemption basis and Geowidget token fields.
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

## Integration routes

> **An integrations key carries financial power.** A key with
> `shop:integrations:write` can replace the workspace's Stripe account in the
> **live** slot as well as the test slot, so real payments go to whoever
> controls the new restricted key, and it can point file
> storage, InPost shipping and invoicing at other accounts. Create it only for a
> provisioning backend, with the shortest expiry that covers the setup, never
> in a browser, a storefront or a warehouse tool, and never together with
> catalog, order or settings scopes on one key. Revoke it when provisioning is
> done.

| Method and path | Scope | Session counterpart |
|---|---|---|
| `GET /api/m2m/shop/integrations/secrets` | `shop:integrations:read` | `GET /api/tenant-secrets` |
| `POST /api/m2m/shop/integrations/secrets` | `shop:integrations:write` | `POST /api/tenant-secrets`, allow-listed keys only |
| `DELETE /api/m2m/shop/integrations/secrets/:key` | `shop:integrations:write` | `DELETE /api/tenant-secrets/:key`, allow-listed keys only |
| `POST /api/m2m/shop/integrations/stripe/configure` | `shop:integrations:write` | `POST /api/integrations/stripe/configure` |
| `POST /api/m2m/shop/integrations/stripe/probe` | `shop:integrations:write` | `POST /api/integrations/stripe/probe` |
| `POST /api/m2m/shop/integrations/storage/configure` | `shop:integrations:write` | `POST /api/integrations/storage/configure` |
| `GET /api/m2m/shop/integrations/shipx` | `shop:integrations:read` | `GET /api/integrations/shipx` |
| `POST /api/m2m/shop/integrations/shipx/configure` | `shop:integrations:write` | `POST /api/integrations/shipx/configure` |

Every route reuses the request body, validation, use-case and response of its
session counterpart; the session routes keep answering `401` for a shop key.
No secret value is ever returned: the secret list answers the same masked
previews, Stripe mode and webhook URL as the session route.

The generic secret routes accept only this fixed list of keys:
`ifirma.invoiceApiKey`, `ifirma.username`, `ksef.token`, `ksef.contextNip`,
`ksef.test.token` and `ksef.test.contextNip`. The value is trimmed and must not
be empty, and a KSeF context NIP must have ten digits and a valid checksum.
Any other key, including every `stripe.*`, `s3.*` and `shipx.*` key, the
telemetry, video, e-mail and Meta Conversions API secrets and unknown names,
answers `400 validation` on both set and delete and changes nothing. Stripe,
storage and ShipX credentials go through their dedicated routes, which validate
and probe before storing; e-mail provider setup stays on the owner session.
Storing KSeF credentials changes no invoicing setting: whether invoices are
sent to KSeF automatically still follows `invoicingProvider`,
`autoIssueInvoices` and `ksefSubmissionMode` (which defaults to `automatic`).
Automatic KSeF submission for several workspaces that share one seller is not
supported; set `ksefSubmissionMode` to `manual` on such workspaces before
storing their KSeF credentials.

- **Stripe** `configure` takes `{"mode":"test","restrictedKey":"rk_test_..."}`,
  or `{"mode":"live","restrictedKey":"rk_live_..."}` for the live slot that
  takes real payments (see the warning above); the key prefix must match the
  mode or the call answers `400 validation`
  before Stripe is contacted. It registers this workspace's webhook endpoint
  with the new key, stores the key, a fresh signing secret and the endpoint id
  in the slot of that mode, and answers `{ "mode", "webhookUrl" }`. The other
  mode's slot and every other workspace's endpoints stay untouched. `probe`
  takes `{"mode":"test"}` and reports which permissions the stored key has.
- **Storage** `configure` takes the S3-compatible configuration
  (`provider`, `endpoint`, `region`, `bucket`, `accessKeyId`,
  `secretAccessKey`), probes the bucket and the workspace origins for CORS and
  stores it only when the probe succeeds.
- **ShipX** `configure` changes only the parts it is given: `environment`,
  `sender` (or `null` to remove it), `organizationId`, `token`, or
  `"clearCredentials": true`. The view answers the environment, the sender and
  masked credentials.

A body that carries a secret (an iFirma or KSeF value, the Stripe restricted
key, the storage `secretAccessKey`, the ShipX `token`) is built by `jq` from a
file only the current user can read and piped to curl on stdin with
`--data-binary @-`; never expand a secret inside `-d`. `SHOP`, `KEY` and `JSON`
are the shell variables from [Catalog routes](#catalog-routes).

```bash
curl -s -H "$KEY" "$SHOP/integrations/secrets"
jq -Rs '{key: "ksef.token", value: rtrimstr("\n")}' < ksef-token.txt \
  | curl -s -H "$KEY" -H "$JSON" --data-binary @- "$SHOP/integrations/secrets"
curl -s -H "$KEY" -X DELETE "$SHOP/integrations/secrets/ksef.test.token"
jq -Rs '{mode: "test", restrictedKey: rtrimstr("\n")}' < stripe-test-restricted-key.txt \
  | curl -s -H "$KEY" -H "$JSON" --data-binary @- "$SHOP/integrations/stripe/configure"
curl -s -H "$KEY" -H "$JSON" -d '{"mode":"test"}' "$SHOP/integrations/stripe/probe"
```

### Integrations CLI

Secret values never travel on the command line: each command reads them from
the environment variable named by its option, or from stdin when the option is
left out.

```bash
export TOGETHER_SHOP_KEY="$PROVISIONING_KEY"
pnpm --silent run cli --tenant acme shop integrations secrets list
pnpm --silent run cli --tenant acme shop integrations secrets set ksef.token --value-env KSEF_TOKEN
pnpm --silent run cli --tenant acme shop integrations secrets set ifirma.invoiceApiKey < ifirma-invoice-api-key.txt
pnpm --silent run cli --tenant acme shop integrations secrets delete ksef.test.token
pnpm --silent run cli --tenant acme shop integrations stripe configure --mode test --restricted-key-env STRIPE_RESTRICTED_KEY
pnpm --silent run cli --tenant acme shop integrations stripe probe --mode test
pnpm --silent run cli --tenant acme shop integrations storage configure --provider cloudflare_r2 \
  --endpoint https://storage.example.test --region auto --bucket shop-assets \
  --access-key-id "$STORAGE_KEY_ID" --secret-access-key-env STORAGE_SECRET
pnpm --silent run cli --tenant acme shop integrations shipx show
pnpm --silent run cli --tenant acme shop integrations shipx configure --environment sandbox \
  --sender-json-file sender.json --organization-id 12345 --token-env SHIPX_TOKEN
```

`shipx configure` also takes `--clear-sender`, `--clear-credentials` and
`--token-stdin`. The typed client exposes `listIntegrationSecrets`,
`setIntegrationSecret`, `deleteIntegrationSecret`, `configureStripe`,
`probeStripe`, `configureStorage`, `getShipxSettings` and `configureShipx`.

## Responses and errors

Every JSON route answers the same envelope. A success is
`{ "ok": true, "data": { ... } }` with status `200` (`201` for sales-link
creation); a failure is `{ "ok": false, "error": { "code", "message",
"details"? } }` with the status of its code. Parse `data` with the contract
schemas in `core/contract` (`shopCatalogContracts`, `shopOrderContracts`,
`shopSettingsContracts`, `shopAssetsContracts`, `shopIntegrationContracts`),
or use `createShopManagementClient`, which does that and returns a
`Result`. Every JSON response carries `cache-control: no-store`.

| Status | `error.code` | When | CLI exit code | What the backend does |
|---|---|---|---|---|
| 400 | `validation` | Malformed body or query, unknown settings field, disallowed secret key, Stripe key of the other mode | 2 | Fix the request; never retry unchanged |
| 401 | `unauthorized` | Missing, unknown, revoked, expired, legacy or other-workspace key; a key whose issuer is no longer a verified owner; a cookie or `Authorization` header on the request | 3 | Stop and alert; ask a current owner for a new key |
| 403 | `forbidden` | The key lacks the route's scope | 4 | Stop and alert; issue a key with the needed scope |
| 404 | `not_found` | The product, price, order, sales link or candidate upload does not exist in this workspace | 5 | Treat as gone |
| 404 | `tenant_not_found` | The host or `x-tenant` selects no workspace | 7 | Fix the base URL or workspace slug |
| 409 | `conflict` | Stale sales-link revision, order line already issued | 6 | Re-read, then decide |
| 409 | `fulfilment_conflict` | Order already shipped, or another request is creating its InPost shipment | 27 | Re-read the order; shipped means done |
| 409 | `sold_out` | Public checkout of a product without available stock | 26 | Show the product as sold out |
| 412 | `integration_not_configured` | A provider the route needs is not set up | 8 | Run provisioning first |
| 422 | `invoice_exemption_basis_missing` | VAT `exempt` without a legal basis | 22 | Send the basis with the mode |
| 422 | `shipx_rejected` | InPost refused the shipment data | 29 | Correct the sender or order data |
| 429 | `rate_limited` | Per-key minute or day limit reached | 12 | Wait `Retry-After` seconds |
| 502 | `integration_auth` | A provider rejected the stored credentials | 9 | Reconfigure the provider |
| 503 | `integration_unavailable`, `shipx_unavailable` | A provider could not be reached, or a storage probe failed | 11, 28 | Retry later with backoff |
| 503 | `unavailable` | The key history row of an accepted `POST`, `PUT`, `PATCH` or `DELETE` could not be written; the handler did not run and nothing changed | 20 | Wait `Retry-After` seconds, then retry the same request |
| 500 | `internal` | Unexpected server failure | 10 | Retry later with backoff; report if it persists |

The CLI exit codes come from `EXIT_CODE_BY_ERROR_CODE` in
`core/contract/http-status.ts`; with `--json` the CLI prints exactly one
envelope on stdout, and without it prints `error(<code>): <message>` on stderr.
An empty key variable is a `validation` error (exit code 2) before any request.

Error examples (the `details` of a validation error are the field errors of the
rejected body):

```json
{ "ok": false, "error": { "code": "unauthorized", "message": "Invalid API key" } }
{ "ok": false, "error": { "code": "unauthorized", "message": "Missing API key" } }
{ "ok": false, "error": { "code": "unauthorized", "message": "Shop management requests must not carry a cookie or an Authorization header" } }
{ "ok": false, "error": { "code": "forbidden", "message": "shop:orders:read is not permitted" } }
{ "ok": false, "error": { "code": "validation", "message": "Invalid product payload", "details": { "formErrors": [], "fieldErrors": { "priceCents": ["Price must not be negative"] } } } }
{ "ok": false, "error": { "code": "fulfilment_conflict", "message": "Order has already been shipped" } }
{ "ok": false, "error": { "code": "rate_limited", "message": "API key rate limit exceeded", "details": { "period": "minute", "retryAfterSeconds": 17 } } }
```

## Rate limits

Each key has its own durable buckets on the shop routes: **60 requests a
minute** and **10,000 requests a day**. The windows are fixed (calendar minute
and UTC day), shared by every route and counted after the key and its issuer
are accepted. A request over either limit answers `429 rate_limited` with a
`Retry-After` header in whole seconds until the current window ends, and the
same number in `error.details.retryAfterSeconds`. Wait at least that long
before the next request with that key; do not spread the retry over other
keys. Polling every five minutes with a few pages uses a small fraction of the
budget.

The minute bucket is counted first: a request refused by the minute limit does
not count against the day, and a request refused by the day limit gives its
minute unit back. Requests refused before the rate limit (missing, unknown or
unusable key, mixed credentials) are not counted.

## Lifetime

An expiry is mandatory and may be at most **30 days** after creation. Seven
days is the suggested lifetime; the server applies no default. There is no
renewal: rotate instead.

## Bootstrap

The owner, signed in with a verified e-mail address in their own session,
creates one key per job. Keep the provisioning key only as long as the setup
takes.

```bash
pnpm --silent run cli login --email <owner-email>
pnpm --silent run cli --tenant acme api-key shop-management create 'Shop provisioning' \
  --scope shop:settings:read shop:settings:write shop:integrations:read shop:integrations:write \
  --expires-at <ISO time at most 30 days ahead>
pnpm --silent run cli --tenant acme api-key shop-management create 'Shop catalog' \
  --scope shop:catalog:read shop:catalog:write \
  --expires-at <ISO time at most 30 days ahead>
pnpm --silent run cli --tenant acme api-key shop-management create 'Shop warehouse' \
  --scope shop:orders:read shop:fulfilment:write \
  --expires-at <ISO time at most 30 days ahead>
```

The secret is printed once. Store it in the shop backend's secret store; it
cannot be shown again. `api-key shop-management list` shows each key's name,
state, expiry, scopes and id without the secret. Every shop management key
operation needs the verified owner session described above, listing included.
The same operations are available over HTTP with that session, all under
`/api/api-keys/shop-management`:

```http
POST https://<workspace-host>/api/api-keys/shop-management
Authorization: Bearer <owner-session-token>
Content-Type: application/json

{"name":"Shop catalog","scopes":["shop:catalog:read","shop:catalog:write"],"expiresAt":"<ISO time at most 30 days ahead>"}
```

```json
{
  "ok": true,
  "data": {
    "apiKey": {
      "id": "<key-id>", "tenantId": "acme", "name": "Shop catalog",
      "scopes": ["shop:catalog:read", "shop:catalog:write"], "issuedByUserId": "<owner-user-id>",
      "createdAt": "<ISO time>", "expiresAt": "<ISO time>", "revokedAt": null
    },
    "secret": "<shown once>"
  }
}
```

`GET /api/api-keys/shop-management` lists the keys in the same shape without
secrets, `DELETE /api/api-keys/shop-management/<key-id>` revokes one and
answers `{ "apiKey": { ... } }` with `revokedAt` set,
`POST /api/api-keys/shop-management/purge` purges and
`GET /api/api-keys/shop-management/events` reads the history. The legacy key
routes (`/api/api-keys`, `api-key create|list|revoke`) neither list nor create
nor revoke shop management keys. A key, a member session or an owner viewing
as a member cannot create a shop management key.

## Rotate and revoke

1. Create a replacement key with the same scopes (Bootstrap above).
2. Deploy it to the shop backend and verify one read succeeds with it, for
   example `GET /api/m2m/shop/products` for a catalog key or
   `GET /api/m2m/shop/orders?mode=live&pageSize=1` for a warehouse key.
3. Revoke the old key: `api-key shop-management revoke <old-key-id>` or
   `DELETE /api/api-keys/shop-management/<old-key-id>`.
4. Verify the old key now answers `401 Invalid API key`.

Revocation takes effect on the next request; keys are not cached between
requests. Revoke a key at once when it may have leaked, when its job ends or
when its backend is retired. Demoting or removing the issuing owner also stops
every key that owner issued; issue replacements from a current owner.

## Examples by route family

The examples use placeholders only. `SHOP`, `KEY` and `JSON` are the shell
variables from [Catalog routes](#catalog-routes). Responses are abbreviated
to the fields a backend usually reads; the contract schemas list them all.

Catalog: create a physical product, then price, stock and publish it.

```bash
curl -s -H "$KEY" -H "$JSON" -d '{"title":"Printed handbook","slug":"printed-handbook","type":"physical","deliveryMethod":"shipping","priceCents":4900,"currency":"PLN","vatRate":5}' "$SHOP/products"
```

```json
{ "ok": true, "data": { "product": { "id": "<product-id>", "tenantId": "acme", "type": "physical", "slug": "printed-handbook", "title": "Printed handbook", "coverUrl": null, "priceCents": 4900, "currency": "PLN", "published": false, "deliveryMethod": "shipping" } } }
```

`vatRate` 5 is a schema example, not tax advice. The product's `priceCents`
is its base price; buyers pay the active price created next.

```json
{ "ok": true, "data": { "price": { "id": "<price-id>", "productId": "<product-id>", "kind": "one_time", "interval": null, "amountCents": 4900, "currency": "PLN", "active": true } } }
{ "ok": true, "data": { "stock": { "productId": "<product-id>", "onHand": 20, "reserved": 0, "available": 20, "lowStockThreshold": null, "low": false, "soldOut": false } } }
{ "ok": true, "data": { "product": { "id": "<product-id>", "published": true } } }
```

File upload (product cover; branding images work the same through the
settings routes). Accepted types are PNG, JPEG, WebP and SVG, at most 5 MiB;
the bytes must match the declared type.

```bash
umask 077
curl -s -H "$KEY" -H "$JSON" -d '{"kind":"product-cover","fileName":"cover.png","contentType":"image/png","sizeBytes":<bytes>}' "$SHOP/image-assets/product-cover/upload" > cover-upload.json
```

```json
{ "ok": true, "data": { "key": "<candidate-key>", "servePath": "/api/public/assets/product-cover/<file>", "upload": { "url": "<signed-storage-url>", "headers": { "content-type": "image/png" }, "expiresAt": "<ISO time>" } } }
```

`PUT` the file to `upload.url` with exactly the returned `upload.headers` and
without the shop key, before `expiresAt` (fifteen minutes). The signed URL
authorizes the upload on its own, so keep it out of command-line arguments like
the key: the example keeps the answer in a file only the current user can read
and hands curl the URL as a `url = "..."` config line on stdin (`-K -`).
Delete `cover-upload.json` after the upload. Then complete and attach:

```bash
jq -r '"url = \"\(.data.upload.url)\""' cover-upload.json | curl -s -K - -X PUT -H 'content-type: image/png' --data-binary @cover.png
curl -s -H "$KEY" -H "$JSON" -d '{"key":"<candidate-key>"}' "$SHOP/image-assets/product-cover/complete"
curl -s -H "$KEY" -H "$JSON" -d '{"id":"<product-id>","coverUrl":"/api/public/assets/product-cover/<file>"}' "$SHOP/products/update"
```

Completion answers `{ "url": "/api/public/assets/product-cover/<file>" }`.
Asset URLs are relative to the workspace origin; prefix them with
`https://<workspace-host>` before using them on another site. The public URL
redirects to a short-lived signed storage URL, so do not cache the redirect
target.

Orders: list the live orders to pack, then ship one manually.

```bash
curl -s -H "$KEY" "$SHOP/orders?mode=live&fulfilmentStatus=to_pack&page=1&pageSize=100"
```

```json
{ "ok": true, "data": { "orders": [ { "id": "<order-id>", "mode": "live", "status": "paid", "fulfilmentStatus": "to_pack", "amountCents": 6400, "currency": "PLN", "memberEmail": "<buyer-email>", "productTitle": "Printed handbook", "shipping": { "rateId": "courier", "label": "Courier", "address": { "name": "<buyer-name>", "line1": "<street>", "postalCode": "<postal-code>", "city": "<city>", "country": "PL" }, "phone": "<phone>" } } ], "total": 1, "page": 1, "pageSize": 100 } }
```

```bash
curl -s -H "$KEY" -H "$JSON" -d '{"carrier":"other","trackingNumber":"<tracking-number>"}' "$SHOP/orders/<order-id>/ship"
```

```json
{ "ok": true, "data": { "order": { "id": "<order-id>", "fulfilmentStatus": "shipped", "shipment": { "carrier": "other", "trackingNumber": "<tracking-number>", "shippedBy": "<owner-user-id>" } } } }
```

Settings answer `{ "settings": { ... } }` with the allow-listed fields;
integrations answer masked previews such as
`{ "key": "ksef.token", "maskedPreview": "••••abcd", "updatedAt": "<ISO time>" }`
and never a secret value.

## Provider setup

Configure only the providers the shop uses, in this order, with the
provisioning key. Each step is optional unless the next one needs it.

1. **Seller, legal and shipping settings** (`POST .../settings`): `termsUrl`
   and `privacyUrl` (checkout then requires `termsAccepted: true`),
   `supportEmail`, `invoiceSellerName`, `invoiceSellerAddress` and at least
   one active entry in `shippingRates` for physical products.
2. **Storage** (`POST .../integrations/storage/configure`): needed for cover and
   branding uploads. The probe contacts the bucket and checks its CORS rules
   for the workspace origins before anything is stored.
3. **Stripe** (`POST .../integrations/stripe/configure`): the live slot is what
   anonymous buyers pay through; the test slot serves only staff test
   purchases (below).
4. **ShipX** (`POST .../integrations/shipx/configure`): needed only for
   `POST .../orders/<order-id>/shipx`; manual shipping needs nothing.
5. **iFirma or KSeF credentials** (`POST .../integrations/secrets`): needed
   only for invoicing.

Real external effects need the workspace owner's explicit approval before any
automation runs them on a production deployment, and are never part of a test
run:

- Stripe `configure` registers a webhook endpoint in the Stripe account behind
  the restricted key, for either mode, and the live slot takes real payments.
- ShipX `POST .../orders/<order-id>/shipx` on a live order with a `production`
  ShipX environment creates and pays a real InPost shipment.
- Stored KSeF credentials together with `autoIssueInvoices` and
  `ksefSubmissionMode` `automatic` submit real invoices to KSeF; keep
  `ksefSubmissionMode` `manual` until that is approved.
- Order e-mail (the purchase confirmation and the tracking message) reaches
  real buyers on a deployment with a real e-mail provider.

Deployments that run the fake payment provider (local development and tests)
never contact Stripe, and use the simulated ShipX client; no test in this
repository calls a real provider.

## Selling: public offer, checkout and return

The storefront calls two anonymous routes on the workspace origin. Both answer
any origin (`access-control-allow-origin: *`), need no key and must be called
with credentials omitted.

```ts
const base = 'https://<workspace-host>';
const offer = await fetch(`${base}/api/public/offer`, { credentials: 'omit' });
const handoff = await fetch(`${base}/api/public/checkout/session`, {
  method: 'POST',
  credentials: 'omit',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    productId: '<product-id>',
    priceId: '<active-price-id>',
    termsAccepted: true,
    language: 'en',
    shipping: { rateId: 'courier' },
  }),
});
const payload = await handoff.json();
if (!handoff.ok || payload.ok !== true) throw new Error('Checkout could not start');
window.location.assign(payload.data.url);
```

- `GET /api/public/offer` lists the published products with their active
  prices, cover URL and public stock state (`tracked`, `soldOut`, `low`). It
  answers a weak `ETag`; send it back in `If-None-Match` to receive `304` with
  no body when nothing changed.
- `POST /api/public/checkout/session` validates the product, price, delivery
  option (`shipping.rateId` must name an active rate; physical products need
  one) and terms acceptance, reserves one piece of tracked stock and answers
  `{ "url": "<hosted-checkout-url>" }`. Send the buyer there. A sold-out
  product answers `409 sold_out`; too many attempts answer `429` with
  `Retry-After`.
- An anonymous checkout is always a live checkout. Test purchases are
  available only to a signed-in staff member of the workspace who has switched
  on test purchases for their own session; test orders never reserve or reduce
  stock, send no buyer e-mail and are excluded by `mode=live`.

The return is fixed: after payment the buyer lands on
`https://<workspace-host>/checkout/<product-id>?status=success&...` (or
`/offer/<slug>?status=success&...` for a sales link), and a cancelled payment
returns to the same page with `status=cancelled`. The request cannot choose
another return URL. Never fulfil on `status=success` or on any value the
browser sends: an order exists only after the payment provider's signed
webhook has been processed, and the warehouse finds it by polling (below).
`GET /api/public/checkout/session-status?session_id=<session-id>` answers
`pending` or `paid` for a confirmation page.

The signed webhook creates exactly one paid order per payment. A repeated
delivery of the same provider event is recognised and neither creates a
second order nor reduces stock a second time; payment turns the reservation
into a sale (one piece leaves `onHand` and `reserved`), and an expired checkout
releases it.

## Polling with overlap and de-duplication

See [Polling for orders to fulfil](#polling-for-orders-to-fulfil). In short:
re-read the whole `mode=live&fulfilmentStatus=to_pack` list on every poll,
remember the order ids already handed to the warehouse, and treat
`409 fulfilment_conflict` on `ship` as already shipped. A missed poll loses
nothing, because an order stays `to_pack` until it is shipped.

## End-to-end replay

`scripts/shop-machine-replay.test.ts` runs the whole flow against the
real server routes and a database, with the fake payment provider and fake
storage, and no network:

1. A clean workspace; its owner session issues a provisioning key
   (`shop:settings:*`, `shop:integrations:*`), a catalog key
   (`shop:catalog:*`) and a warehouse key (`shop:orders:read`,
   `shop:fulfilment:write`).
2. Provisioning sets legal URLs, seller and a courier rate, configures Stripe
   (test and live slots), storage and a ShipX sandbox, and reads the masked
   secret list without any secret value; it cannot read the catalog.
3. Catalog uploads a cover through the signed-upload protocol, creates the
   physical book, attaches the cover, prices it, enables stock of 20 and
   publishes it; it cannot read orders. A browser-origin request to a shop
   route receives no CORS header.
4. The anonymous offer lists the book for another origin, and a
   cross-origin checkout request (preflight and `POST`) starts a live checkout
   whose fixed success URL points at the workspace and reserves one piece.
5. A forged signature is refused without an order; the signed
   `checkout.session.completed` fixture creates exactly one paid order and
   leaves 19 on hand; its replay creates nothing and leaves stock unchanged.
6. The warehouse key lists the live order to pack and ships it manually; a
   second ship answers `409 fulfilment_conflict`.
7. The e-mail outbox holds one purchase confirmation and one tracking message
   for the buyer.
8. The owner revokes the warehouse key; its next call answers
   `401 Invalid API key`.
9. The key history holds one `request` row per keyed mutation that reached its
   handler: two for the warehouse key's ship calls, the refused second one
   included, each with the order id, and one for each provisioning settings
   and configure call, with no resource id and no credential. Reads, refused
   or not, write no row.

Run it with `pnpm exec vitest run scripts/shop-machine-replay.test.ts`.

## CLI-first evidence

The same flow through the CLI, in replay order, against a local server
(`pnpm run dev:server`) or a deployment. Add `--json` to any command for the
exact envelope; exit codes follow the table above. Each `shop` command reads
the key from `TOGETHER_SHOP_KEY` unless `--api-key-env` names another
variable.

```bash
# 1. Owner session: issue the three keys (Bootstrap) and note their ids
pnpm --silent run cli login --email <owner-email>
pnpm --silent run cli --tenant acme api-key shop-management list

# 2. Provisioning key
export TOGETHER_SHOP_KEY="$PROVISIONING_KEY"
pnpm --silent run cli --tenant acme shop settings set --json-file shop-settings.json
pnpm --silent run cli --tenant acme shop settings show
pnpm --silent run cli --tenant acme shop integrations storage configure --provider cloudflare_r2 \
  --endpoint https://storage.example.test --region auto --bucket shop-assets \
  --access-key-id "$STORAGE_KEY_ID" --secret-access-key-env STORAGE_SECRET
pnpm --silent run cli --tenant acme shop integrations stripe configure --mode test --restricted-key-env STRIPE_TEST_RESTRICTED_KEY
pnpm --silent run cli --tenant acme shop integrations shipx configure --environment sandbox \
  --sender-json-file sender.json --organization-id <organization-id> --token-env SHIPX_TOKEN
pnpm --silent run cli --tenant acme shop integrations secrets list

# 3. Catalog key
export TOGETHER_SHOP_KEY="$CATALOG_KEY"
pnpm --silent run cli --tenant acme shop products create --title 'Printed handbook' --slug printed-handbook \
  --type physical --delivery-method shipping --price 49 --currency PLN
pnpm --silent run cli --tenant acme shop cover upload <product-id> ./cover.png
pnpm --silent run cli --tenant acme shop prices add --product <product-id> --kind one_time --price 49
pnpm --silent run cli --tenant acme shop stock enable <product-id> --on-hand 20
pnpm --silent run cli --tenant acme shop products publish <product-id>
pnpm --silent run cli --tenant acme public offer

# 4. Buyer: start the anonymous checkout and accept the terms, then pay at the printed URL
pnpm --silent run cli --tenant acme checkout session --product <product-id> --email <buyer-email> \
  --shipping-rate courier --accept-terms

# 5. Warehouse key
export TOGETHER_SHOP_KEY="$WAREHOUSE_KEY"
pnpm --silent run cli --tenant acme shop orders list --mode live --fulfilment to_pack --page-size 100
pnpm --silent run cli --tenant acme shop orders ship <order-id> --carrier other --tracking <tracking-number>
pnpm --silent run cli --tenant acme shop orders show <order-id>
pnpm --silent run cli --tenant acme shop stock show <product-id> --api-key-env CATALOG_KEY

# 6. Owner session: revoke the warehouse key; the next warehouse call exits with 3
pnpm --silent run cli --tenant acme api-key shop-management revoke <warehouse-key-id>
pnpm --silent run cli --tenant acme shop orders list --mode live
```

`shop-settings.json` holds the settings object, for example
`{"termsUrl":"https://brand.example.test/terms","privacyUrl":"https://brand.example.test/privacy","invoiceSellerName":"Example Press","invoiceSellerAddress":"<street, postal code, city>","shippingRates":[{"id":"courier","label":"Courier","amountCents":1500,"vatRatePercent":23,"carrier":"other","pickupPoint":"none","active":true}]}`.
A workspace with legal URLs refuses a checkout without terms acceptance, so
`checkout session` and `simulate-purchase` take `--accept-terms` to send
`termsAccepted: true`; without the flag they send no terms field.

## Deployment read-back checklist

Before handing keys to a shop backend, read each item back on the deployed
workspace and keep the output:

1. `GET https://<workspace-host>/api/health` answers `status` `ok`,
   `database` `up`, `schemaCurrent` `true` and the expected `commit`.
2. A route under `/api/m2m/shop` without a key answers `401 Missing API key`,
   and the same route with a cookie or `Authorization` header answers `401`.
3. `api-key shop-management list` shows exactly the intended shop keys, each
   with the intended scopes and an expiry within 30 days, and `api-key list`
   shows no shop key.
4. Each key reads its own family (`shop settings show`, `shop products list`,
   `shop orders list --mode live --page-size 1`) and gets `403` on another.
5. `shop settings show` answers the intended legal URLs, seller and active
   shipping rates; `shop integrations secrets list` shows masked previews only.
6. `shop integrations stripe probe --mode live` reports every required
   permission as `ok` (only after the owner approved the live key).
7. `GET https://<workspace-host>/api/public/offer` lists the published book
   with its active price, and, requested with an `Origin` header, carries
   `access-control-allow-origin: *`.
8. After the first real order, `shop orders list --mode live --fulfilment
   to_pack` shows it once, and `shop stock show <product-id>` shows one piece
   fewer on hand.
9. The provisioning key is revoked once setup is done;
   `api-key shop-management list` shows it as `revoked`.

## Kill switch

The server environment variable `SHOP_MANAGEMENT_KEYS` takes `enabled` (the
default) or `disabled`; any other value stops the server from booting. With
`disabled`:

- Every request under `/api/m2m/shop`, to a listed route or an unknown path,
  with any method, answers `404 not_found` before the server looks at a session,
  a cookie or the key, so it never answers `401`. The request span records
  only the switch state, `app.api_key.match=switch_off`, and no key id: the
  switch performs no key lookup and stays a pure kill path that never touches
  the database.
- Creating a shop management key answers `403 forbidden` with the message
  `Shop management keys are disabled on this deployment
  (SHOP_MANAGEMENT_KEYS=disabled)`.
- Existing keys stay listable (`GET /api/api-keys/shop-management`), revocable
  (`DELETE /api/api-keys/shop-management/:id`) and purgeable (below) through the
  owner session.
- Legacy keys behave exactly as with `enabled`.

The switch is read at boot: change it and redeploy (or restart) the server.

## Purge

`POST /api/api-keys/shop-management/purge` (CLI
`api-key shop-management purge --yes`) is the owner's kill switch for one
workspace: it deletes every shop management key of the workspace, revoked or
not, in one transaction with one `purged` key event per deleted key, and answers
`{"purged": <count>}`. It needs the same verified owner session as
creation, refuses an admin, an unverified owner, an owner viewing as a member
and any API key, and works with the switch in either state. Legacy keys and
other workspaces' keys are untouched, and the keys' rate-limit buckets go with
them. A workspace without shop management keys answers `{"purged": 0}` and gets
no event. The key history, including the creation and revocation events of the
deleted keys, stays.

## Rollback

A retreat to the previous release needs no purge and no data step. Migration
`0155_shop_management_keys` only adds the tables `shop_management_keys`,
`shop_management_key_rate_limit_buckets` and `shop_management_key_events`; it
does not change `tenant_api_keys` or any other existing table. The previous
release reads `tenant_api_keys` exactly as before, and nothing in it reads the
three new tables, so its key list, import audit and API-key authentication
answer as they did before this release, whatever shop management keys exist.
Its `/api/health` reports `schemaFingerprintMatch: false`, which is expected
while the newer schema remains.

Keep the schema and the migration when rolling back the binary. The shop
management keys, their buckets and their history stay in place, unused by the
previous release, for a later return to this release; a key that has not
expired by then works again.

The off switch (`SHOP_MANAGEMENT_KEYS=disabled`) and the purge remain owner
controls, not rollback steps: the switch stops every shop route on a
deployment, and the purge deletes a workspace's shop management keys, for
example when a key may have leaked.

See also the [CLI reference](cli.md) and [security notes](security.md).
