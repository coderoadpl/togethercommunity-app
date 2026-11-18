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
| `shop:fulfilment:write` | Fulfil orders, including creating carrier shipments (a paid action at the carrier) |
| `shop:settings:read` | Read shop settings |
| `shop:settings:write` | Change the constrained shop settings |
| `shop:integrations:read` | Read masked integration configuration |
| `shop:integrations:write` | Configure the payment account (including the live slot), the carrier credentials and sender, the invoicing credentials and the object storage connection |

Write scopes do not include the matching read scope. A key with
`shop:integrations:write` carries financial and configuration power: keep it
short-lived and separate from catalog or warehouse keys. A key with
`shop:fulfilment:write` can create carrier shipments, a paid action at the
carrier: the scope grants `order:write`, which the InPost ShipX shipment
creation requires.

`shop:integrations:write` reaches only an allow-list kept in
`core/domain/shop-management-key.ts` and checked in the use-cases, below every
route: Stripe configure and permission probe, ShipX configure, storage
configure (the object storage connection) and the iFirma and KSeF credentials
(`ifirma.invoiceApiKey`, `ifirma.username`, `ksef.token`, `ksef.contextNip`,
`ksef.test.token`, `ksef.test.contextNip`). A key never writes a webhook
signing secret or endpoint id directly, the Meta Conversions API token,
video-hosting, marketing, mail or telemetry credentials or any other secret,
and never runs a connection test; those stay with the owner's session.

`shop:settings:write` reaches only the shop settings fields on the allow-list
`SHOP_MANAGEMENT_KEY_SETTINGS_FIELDS` in `core/domain/shop-management-key.ts`,
checked in `core/server/authorize.ts` below every route: a key ctx holds
`tenant:settings:write` only when the use-case names the shop settings update
or the branding asset upload with fields from that list, and the settings
update refuses a change to any field its grant does not name. The list is the
workspace name and default language, the logo, dark logo, favicon, accent
colours and share image, the share title and description, the social links,
the checkout appearance, the support e-mail and URL, the terms and privacy
URLs, the invoice seller, VAT treatment, invoicing provider, automatic
invoicing and KSeF submission settings, the shipping rates and the InPost
Geowidget token. A key never changes analytics, the Meta Conversions API
settings, video hosting, the billing portal, the home space, member messaging
or autoplay settings, the sign-in notice, the team, domains, redirects or the
telemetry store; those stay with the owner's session, which keeps every
settings write it has.

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
(a path parameter, else the body's `id`, else the first body field ending in
`Id`; none when the request names no existing resource, such as a product
creation). It records no status or outcome: what the handler then did, a
change, a validation error or a failure, is in request telemetry only. The
resource id is kept only when it looks like an identifier: at most 200
characters, starting with a letter or digit and continuing with letters,
digits, `.`, `_`, `:` or `-` (ASCII only). Anything else is stored as no
resource id, and the database enforces both rules with its own checks: a length
check of at most 200 characters and the pattern `^[A-Za-z0-9][A-Za-z0-9._:-]*$`.
The shared shop route helper writes the row, so every shop route inherits it.

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

The examples below use the workspace host; `<product-id>` and `<price-id>`
are placeholders. On the platform host, add `-H 'x-tenant: <workspace-slug>'`.
Never send a cookie or an `Authorization` header with the key.

Never put the key, or any other secret, into a command-line argument: other
users and process listings on the host can read the arguments of a running
process. The examples write the key header once into a file only the current
user can read and let curl read it with `-H @file` (curl 7.55 or newer);
`printf` is a shell builtin and starts no process. Delete the header file when
the job ends.

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
export TOGETHER_SHOP_KEY=<secret from api-key shop-management create>
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
pnpm --silent run cli --tenant acme api-key shop-management create 'Shop backend' \
  --scope shop:catalog:read shop:catalog:write \
  --expires-at 2026-11-21T00:00:00.000Z
```

The secret is printed once. Store it in the shop backend's secret store; it
cannot be shown again. `api-key shop-management list` shows each key's state,
expiry and scopes without the secret. Every shop management key operation needs
the verified owner session described above, listing included. The same
operations are available over HTTP with that session, all under
`/api/api-keys/shop-management`: `POST` with `{"name", "scopes", "expiresAt"}`
creates, `GET` lists, `DELETE /api/api-keys/shop-management/:id` revokes,
`POST .../purge` purges and `GET .../events` reads the history. The legacy key
routes (`/api/api-keys`, `api-key create|list|revoke`) neither list nor create
nor revoke shop management keys.

## Rotate and revoke

1. Create a replacement key with the same scopes.
2. Deploy it to the shop backend and verify a request succeeds with it.
3. Revoke the old key: `api-key shop-management revoke <old-id>`.

Revocation takes effect on the next request; keys are not cached between
requests.

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
`0159_shop_management_keys` only adds the tables `shop_management_keys`,
`shop_management_key_rate_limit_buckets` and `shop_management_key_events`; it
does not change `tenant_api_keys` or any other existing table. The previous
release reads `tenant_api_keys` exactly as before, and nothing in it reads the
three new tables, so its key list, import audit and API-key authentication
answer as they did before this release, whatever shop management keys exist.
After the retreat, the previous release's `/api/health` answer reports
`schemaFingerprintMatch: false`: the live schema, which keeps the three tables
of the kept migration, no longer matches the schema fingerprint that release
was built with. This is expected while the newer schema remains.

The hourly production health monitor (`.github/workflows/prod-health.yml`)
treats `schemaFingerprintMatch: false` as a failed `health` check: every run
during the retreat fails, and its deep health probe is skipped. It pages
through the alert gate (`.github/actions/alert-gate`), which sends an SMS only
on a state change, so it alerts once: the first run after the retreat sends one
SMS when the previous run was green, and every following run fails with the
same failing set and sends none. Expect that one alert and do not treat it as a
new incident. When this release returns and the fingerprint matches again, the
next green run sends one `RECOVERED` SMS.

Keep the schema and the migration when rolling back the binary. The shop
management keys, their buckets and their history stay in place, unused by the
previous release, for a later return to this release; a key that has not
expired by then works again.

The off switch (`SHOP_MANAGEMENT_KEYS=disabled`) and the purge remain owner
controls, not rollback steps: the switch stops every shop route on a
deployment, and the purge deletes a workspace's shop management keys, for
example when a key may have leaked.

See also the [CLI reference](cli.md) and [security notes](security.md).
