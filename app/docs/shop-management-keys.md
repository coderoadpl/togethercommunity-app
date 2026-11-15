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
| Key kind, scopes, issuer, expiry, key history | Available |
| Owner-session creation, listing and revocation (`/api/api-keys`, CLI `api-key`) | Available |
| Kill switch `SHOP_MANAGEMENT_KEYS` and owner-session purge | Available |
| Request authentication, issuer revalidation and rate limits | Available |
| Catalog routes: products, prices and stock (below) | Available |
| Typed client `createShopManagementClient` and CLI `shop` commands | Available |
| Image, sales-link, order, fulfilment, settings and integration routes | Not yet available |

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
   refused with `401` before the key is checked; the key is only looked up to
   attribute the refusal in telemetry (below). A shop route never falls back to
   a session, and a session never upgrades a key.
2. The key must exist in the selected workspace, be of kind `shop_management`,
   be unrevoked, carry only shop scopes and expire strictly after the current
   time. A missing key answers `401 Missing API key`; an unknown, revoked,
   expired, legacy or other-workspace key answers the same `401 Invalid API
   key`.
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
request for audit and diagnostics. The request never creates or edits a member
record.

Request telemetry records the route template, status and resolved identity.
For an accepted shop request that identity is the issuing owner
(`app.user.id`, `app.user.email`, `app.tenant.id`, `app.tenant.slug`).

Every request to a shop route, accepted or refused, also records which key it
presented in `app.api_key.match`:

| `app.api_key.match` | Meaning | Also recorded |
|---|---|---|
| `matched` | The secret matches a stored key row in the selected workspace, whatever its state: usable, revoked, expired, of kind `legacy`, or with an issuer that is no longer a verified owner | `app.api_key.id`, `app.api_key.kind` (`legacy` or `shop_management`), `app.api_key.issuer.id` when the row has an issuer, `app.tenant.id` |
| `none` | The secret matches no key row of the selected workspace, or no workspace was selected | `app.tenant.id` when a workspace was selected |
| `missing` | The request carried no key | `app.tenant.id` when a workspace was selected |
| `switch_off` | `SHOP_MANAGEMENT_KEYS=disabled` answered the request (see the kill switch below) | nothing else; the switch does not read the key |

So a `401` for an unusable key, a `401` for mixed credentials, a `403` for a
missing scope, a `429` and a failing handler each carry the id of the key that
was presented. The secret, its hash and any part of either are never recorded,
and telemetry never records request headers, so the key secret does not reach
traces or error reports.

## Key history

Every workspace keeps a durable history of its shop management keys in its own
table, separate from the workspace audit list. Each row carries the key id, the
kind of event, the acting account and the time:

| Kind | Written | Acting account |
|---|---|---|
| `created` | with the key, in the same transaction | the owner who created it |
| `revoked` | with the revocation, in the same transaction | the owner who revoked it |
| `purged` | one row per deleted key, in the purge transaction | the owner who purged |

A history row stores the key id as plain text and is never deleted with its
key, so the history of a revoked or purged key stays readable. It goes away only
with the workspace itself.

## Catalog routes

Each route reuses the request body, response envelope, validation and
use-case of its session counterpart under `/api/products`, including body field
names (`id` for update, publish and unpublish and for price deactivation;
`productId` for draft deletion, price creation and stock). The route checks the
scope, and the reused use-case checks the matching capability again. A product
or price id from another workspace answers `404 not_found`.

Request bodies on the shop routes are strict: a field the route does not know,
at the top level or inside a nested object such as `compliance` or an
`accessItems` entry, answers `400 validation` and nothing is written. A
misspelt field therefore fails instead of being dropped. The session routes
keep ignoring unknown fields.

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
`Authorization` header. It never follows a redirect, same-origin or not: a
`30x` answer fails the call with `internal` (CLI exit code 10) and the message
`Shop management request to <path> refused a redirect`, so the key never
reaches another URL. Use it only from a backend.

## Rate limits

Each key has its own durable buckets on the shop routes: **60 requests a
minute** and **10,000 requests a day**. A request over either limit answers
`429 rate_limited` with a `Retry-After` header in seconds until the current
window ends. The minute bucket is counted first: a request refused by the
minute limit does not count against the day, and a request refused by the day
limit gives its minute unit back. Requests refused before the rate limit
(missing, unknown or unusable key, mixed credentials) are not counted.

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

## Kill switch

The server environment variable `SHOP_MANAGEMENT_KEYS` takes `enabled` (the
default) or `disabled`; any other value stops the server from booting. With
`disabled`:

- Every request under `/api/m2m/shop`, to a listed route or an unknown path,
  with any method, answers `404 not_found` before the server looks at a session,
  a cookie or the key, so it never answers `401`. The request span records
  `app.api_key.match=switch_off` and no key id: the switch stays a pure kill
  path that never touches the database.
- Creating a shop management key answers `403 forbidden` with the message
  `Shop management keys are disabled on this deployment
  (SHOP_MANAGEMENT_KEYS=disabled)`.
- Existing keys stay listable (`GET /api/api-keys`), revocable
  (`DELETE /api/api-keys/:id`) and purgeable (below) through the owner session.
- Legacy keys behave exactly as with `enabled`.

The switch is read at boot: change it and redeploy (or restart) the server.

## Purge

`POST /api/api-keys/shop-management/purge` (CLI
`api-key purge-shop-management --yes`) deletes every shop management key of
the workspace, revoked or not, in one transaction with one `purged` key event
per deleted key, and answers `{"purged": <count>}`. It needs the same verified owner session as
creation, refuses an admin, an unverified owner, an owner viewing as a member
and any API key, and works with the switch in either state. Legacy keys and
other workspaces' keys are untouched, and the keys' rate-limit buckets go with
them. A workspace without shop management keys answers `{"purged": 0}` and gets
no event. The key history, including the creation and revocation events of the
deleted keys, stays.

## Rollback

The schema and migration `0155_shop_management_keys` stay in place: the
previous release ignores the `kind`, `issued_by_user_id` and
`actor_api_key_id` columns and inserts its keys with the `legacy` default. Its
`/api/health` reports `schemaFingerprintMatch: false`, which is expected while
the newer schema remains.

The previous release reads every key row through its own key schema, which
knows only the legacy scopes. While a workspace still holds a shop management
key, revoked or not, that release answers `500` on the workspace's key list
(`GET /api/api-keys`) and import-audit routes, and on every API-key request
made with the shop key itself; it never authenticates a shop management key.
Its revoke route revokes such a key but then answers `500` and writes no audit
event. So purge before rolling back:

1. Set `SHOP_MANAGEMENT_KEYS=disabled` and deploy. Shop backends now get `404`
   and nobody can create a new shop key.
2. In every workspace that has shop management keys, sign in as its owner and
   purge them: `pnpm --silent run cli --tenant <slug> api-key purge-shop-management --yes`
   (or `POST /api/api-keys/shop-management/purge`).
3. Verify each workspace: `GET /api/api-keys` (CLI `api-key list`) lists only
   keys of kind `legacy`.
4. Roll back the binary. Keep the schema and the migration.

One limitation remains after the purge. The previous release lists workspace
audit events through a schema that knows only its own event kinds, so
`GET /api/tenant/audit-events` answers `500` for any page that contains a
`api_key.shop_management_created`, `api_key.shop_management_revoked` or
`api_key.shop_management_purged` event. Keys, key authentication and every
other route work. The purge keeps the audit history instead of deleting it; a
workspace that never held a shop management key has none of these events and
keeps a working audit log.

See also the [CLI reference](cli.md) and [security notes](security.md).
