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
| Product cover, gallery image and sales-link routes (below) | Available |
| Download files of digital products: staging, server-side copy and live attach, replace and remove for a direct-mode key; staging and proposed attach, replace and remove for a propose-mode key ([below](#download-files)) | Available |
| Payment, storage, shipping and invoicing credential routes (below) | Available |
| Builder guide, error taxonomy and deployment checklist (below) | Available |
| End-to-end replay with three keys (`scripts/shop-machine-replay.test.ts`) | Available |
| Propose mode: catalogue, sales-link and settings writes become [change proposals](change-proposals.md) the owner approves or rejects, product cover and branding images and download files included | Available |
| What a product grants: proposed by a propose-mode key, refused to a direct-mode key ([below](#what-a-product-grants)) | Available |
| Invoices and refunds | Not offered with a shop key; staff session routes only. A shop key never refunds; a propose-mode key never refunds |

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
| `shop:catalog:write` | Create, edit, publish and delete product drafts; manage prices, stock, covers and sales links; stage download files and attach, replace and remove the files of digital products |
| `shop:orders:read` | Read and export orders |
| `shop:fulfilment:write` | Fulfil orders, including creating carrier shipments (a paid action at the carrier) |
| `shop:settings:read` | Read shop settings |
| `shop:settings:write` | Change the constrained shop settings |
| `shop:integrations:read` | Read the masked secret list and the masked ShipX settings |
| `shop:integrations:write` | Configure the payment account (including the live slot) and probe its key, the carrier credentials and sender, the object storage connection, and set or delete the invoicing credentials (iFirma and KSeF) |

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
and never runs a connection test; those stay with the owner's session. The
[integration routes](#integration-routes) below are the only way a key
reaches those use-cases.

> **Warning: a `shop:integrations:write` key can configure the live payment
> slot.** It may replace the restricted key of the **live** Stripe slot, the
> one anonymous buyers pay through, not only the test slot. Real payments then
> go to whichever Stripe account the new restricted key belongs to. This is
> deliberate, so that payments can be provisioned with a key, and no extra
> confirmation is asked. Treat such a key like the owner's own payment
> credentials: issue it only to a provisioning backend, with the shortest
> expiry, and revoke it as soon as provisioning ends. See
> [Integration routes](#integration-routes).

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

The issuer's owner role may come from the organization the workspace is linked
to: an owner of an active organization is an owner of every workspace linked
to it and can create
shop management keys there, although creating a tenant API key needs a direct
owner grant. Such a key stops on the next request when that derivation ends:
the issuer leaves the organization or loses its owner role, the workspace is
unlinked, or the organization is suspended.

Creation and revocation each write a key event (`created`, `revoked`) to the
dedicated shop management key history (below) in the same transaction as the
key change. A purge writes one `purged` event per deleted key in the same
transaction as the deletion. These events carry the key id and the owner's
account id, never the secret or its hash. They are not workspace audit events:
the workspace audit list (`GET /api/tenant/audit-events`) is unchanged by shop
management keys.

## Propose mode

A key is created in one of two modes, fixed for its lifetime:

- `direct` (the default): every write the scopes allow changes the live shop,
  as described in the rest of this guide.
- `propose`: the key's writes never change live state. A write to one of the
  eleven catalogue routes, the three sales-link write routes, the settings
  update or the three product file write routes is dry-run, stored as a
  [change proposal](change-proposals.md) with its field-level effect, and
  answered `202` with a receipt; the owner then approves or rejects it in
  their own session. An approval applies the change only when the live state
  still gives exactly the effect the owner saw. The four product cover and
  branding image upload and completion routes run for it too, but keep the
  image in a private quarantine until an approval publishes it (below), and so
  do the [download file](#download-files) upload, completion, copy and discard
  routes, which stage a private file that reaches buyers only through an
  approved proposal. Every other write route (order fulfilment, integrations)
  answers `403`. Reads behave as on a direct key.

```bash
pnpm --silent run cli api-key shop-management create Catalogue agent \
  --scope shop:catalog:read shop:catalog:write \
  --expires-at 2026-12-01T00:00:00.000Z --mode propose
```

Over HTTP the creation body carries `"mode": "propose"`. On a propose-mode key
`shop:catalog:write` and `shop:settings:write` grant only
`proposal:submit:catalog` and `proposal:submit:settings`, each with
`proposal:asset:upload` for [images awaiting approval](change-proposals.md#images)
and staged [download files](#download-files), instead of the live write capabilities, and each needs its read scope (`shop:catalog:read`,
`shop:settings:read`): creation without it answers `400` and the database
refuses such a row. `shop:fulfilment:write` and `shop:integrations:write` are
refused at creation with `400`. The key lists, reads and withdraws only its
own proposals under `/api/m2m/shop/proposals` (CLI `shop proposals
list|show|withdraw`); a direct-mode key is refused there with `403`. The key
list (`GET /api/api-keys/shop-management`, CLI `api-key shop-management list`
in its last column) shows each key's mode. Revoking or purging a propose-mode
key withdraws its pending, unexpired proposals, those in its open
[groups](change-proposals.md#groups) included, and deletes its empty groups,
in the same transaction. Revoking it then also releases its quarantined images
and its staged download files.

A propose-mode key uploads a product cover or a branding image through the same
image routes as a direct-mode key, but the image stays private: completion
answers `{ "url": "/api/public/assets/<kind>/<sha256>.<ext>", "quarantined": true }`,
the address the image takes once approved, and nothing is public until the
owner approves a proposal that sets that address (`product.update` or
`product.create` with `coverUrl`, `settings.update` with `logoUrl`,
`logoDarkUrl`, `faviconUrl` or `ogImageUrl`); the approval writes the public
copy just before it commits. A new `checkoutAppearance.logoUrl` or `iconUrl`
cannot be proposed yet and is refused with `400`. The upload start answers
`servePath: null` and `quarantined: true`; its presigned `PUT` accepts only a
body of the declared `sizeBytes`. A key holds at most 100 such images and
50 MiB of them at a time, counting released ones until their object is deleted, and starts at most 60 uploads in 15 minutes (`409`
beyond); see
[Images](change-proposals.md#images) for the checks, the owner preview,
publication and cleanup.

A propose-mode key can also put proposals that depend on each other in a
group the owner approves as one unit: it creates the group
(`POST /api/m2m/shop/proposals/groups`, CLI `shop proposals group create`)
and sends each proposal with the header `x-proposal-group: <group id>` (CLI
`--group <id>` on every proposing command). Only the key that created a group
can add to it, read it or withdraw it; for any other key the group answers
`404`. A direct-mode key's writes ignore the header and stay live.

A receipt carries the submitted input, the target id and the status, and after
an approval the id of the applied resource, which the key can already read with
its read scope; it never carries the effect, a before value or the deciding
account. Whether a proposal is accepted or refused depends on
live state, so a propose-mode key always holds the read scope of the family it
proposes in and learns nothing from a refused or accepted proposal that it
could not read with that read scope, except for product access lists: a
refusal tells it whether a course id it sent is an active course of the
workspace and whether a module or lesson belongs to the course it named
([What the key learns](change-proposals.md#product-access)). See [Change proposals](change-proposals.md) for the
route classes, statuses, limits and what is not available yet.

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
   hold the owner role in that workspace, directly or derived from the
   organization the workspace is linked to. Otherwise the request answers the
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
names (`id` for update, publish, unpublish and access and for price
deactivation; `productId` for draft deletion, price creation and stock); the
access route takes the session body without `checkoutConsentDefinitionIds`. The
route checks the scope, and the reused use-case checks the matching capability
again. A product or price id from another workspace answers `404 not_found`.

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
| `POST /api/m2m/shop/products/access` | `shop:catalog:write` | `POST /api/products/access-items` without `checkoutConsentDefinitionIds` ([below](#what-a-product-grants)) |
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

Product create and update accept `personalization` like the session routes
(see [Personalisation](shop.md#personalisation)): an update without the field
keeps the stored setting and `null` removes it.

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
pnpm --silent run cli --tenant acme shop products update <product-id> --personalization-file engraving.json
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

### What a product grants

`POST /api/m2m/shop/products/access` takes `{ id, accessItems }`, the whole new
list of the courses, modules and lessons a product grants, and nothing else.
Its live handler is the owner's access editor use-case, which needs
`product:access:write`; no scope grants a key that capability, so a direct-mode
key gets `403 forbidden` there and changes nothing. A propose-mode key with
`shop:catalog:write` gets `202` with a receipt: the request becomes a
`product.set-access` [change proposal](change-proposals.md#product-access) that
only the owner can approve. A direct-mode key still sets what a new product
grants through `accessItems` on `POST /api/m2m/shop/products`. Product
creation, the owner's editor and the approval of a `product.create` or
`product.set-access` proposal run the same check: each course exists in the
workspace and is not archived, each module belongs to its item's course, and
each lesson sits in a module of its item's course. The submission of such a
proposal does not run it, so a propose-mode key learns from a refusal nothing
about the courses, modules and lessons it named; a list that fails the check
ends its proposal `failed` at the approval. A direct-mode key that creates a
product gets one message for every reason the check refuses its list. The
content import, the legacy importer and lesson deletion write access items
without it ([Product access](change-proposals.md#product-access)). The access
list of a `product.create` or `product.set-access` proposal may not repeat an
item or an id. No shop route
serves a course, module or lesson; a key sees their ids in the access items of
the products it lists.

```bash
pnpm --silent run cli --tenant acme shop products access <product-id> --course <course-id>
pnpm --silent run cli --tenant acme shop products access <product-id> --course <course-id> --lesson <lesson-id> --lesson <lesson-id>
pnpm --silent run cli --tenant acme shop products access <product-id> --clear
```

### Typed client

`createShopManagementClient({ baseUrl, apiKey, tenant })` from `core/client`
exposes the fourteen calls with the same method names as the session client
(`listProducts`, `createProduct`, `updateProduct`, `publishProduct`,
`unpublishProduct`, `deleteProductDraft`, `setProductAccess`, `listProductPrices`,
`createProductPrice`, `deactivateProductPrice`, `getProductStock`,
`enableProductStock`, `adjustProductStock`, `setProductStockThreshold`). It
sends `x-api-key` and, when `tenant` is set, `x-tenant`; it never sends an
`Authorization` header. It never follows a redirect, same-origin or not: a
`30x` answer fails the call with `internal` (CLI exit code 10) and the message
`Shop management request to <path> refused a redirect`, so the key never
reaches another URL. Use it only from a backend.

The eleven catalogue writes, `createSalesLink`, `updateSalesLink`,
`deleteSalesLink`, `updateSettings`, `addProductDownload`,
`replaceProductDownload` and `removeProductDownload` resolve to
`{ outcome: 'proposed', proposal }` with the
[receipt](change-proposals.md#receipts) for a propose-mode key, and all of
them except `setProductAccess` to `{ outcome: 'applied', ... }` with the
resource for a direct-mode key; `isProposedChange(value)` narrows the result.
`setProductAccess` never applies for a key: its live handler needs
`product:access:write`, which no scope grants, so a direct-mode key gets
`forbidden` whatever its scopes. Change what an existing product grants with a
propose-mode key and an owner's approval, or in an owner's or admin's session. `listProposals`, `getProposal`
and `withdrawProposal` reach the key's own proposals. Each of these eighteen
writes takes an optional third argument `{ groupId }` that sends the
`x-proposal-group` header, and its proposed outcome then also carries the
`group` receipt; `createProposalGroup`, `getProposalGroup` and
`withdrawProposalGroup` reach the key's own groups.

## Product covers, gallery images and sales links

These routes reuse the session image-asset and sales-link schemas and use-cases.
Cover and gallery image upload and completion require `shop:catalog:write`.
Completion checks the candidate workspace, size and image signature before
publishing it; it returns a public asset URL without changing any product.
Attach a cover with product update and `coverUrl`; add gallery images with
product update and the ordered `images` list (at most 12 `{ url, alt }`
entries; see [Product gallery](shop-integration.md#product-gallery)). The
public asset URL retains its existing redirect to signed storage. For a
propose-mode key cover completion publishes nothing: it keeps the image private
and answers `quarantined: true` with the address an approval publishes it at
([Images](change-proposals.md#images)). Only the key that started a
propose-mode upload can complete it; any other key, and an owner session,
gets `404 not_found` for that candidate. Gallery image upload and completion
refuse a propose-mode key with `403`.

| Method and path | Scope | Session counterpart |
|---|---|---|
| `POST /api/m2m/shop/image-assets/product-cover/upload` | `shop:catalog:write` | `POST /api/image-assets/product-cover/upload` |
| `POST /api/m2m/shop/image-assets/product-cover/complete` | `shop:catalog:write` | `POST /api/image-assets/product-cover/complete` |
| `POST /api/m2m/shop/image-assets/product-image/upload` | `shop:catalog:write` | `POST /api/image-assets/product-image/upload` |
| `POST /api/m2m/shop/image-assets/product-image/complete` | `shop:catalog:write` | `POST /api/image-assets/product-image/complete` |
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

The typed client exposes `uploadProductCover`, `uploadProductImage`,
`listSalesLinks`, `getSalesLink`, `createSalesLink`, `updateSalesLink` and
`deleteSalesLink`. The two image helpers run upload → signed storage PUT →
completion; only the two API requests carry the shop key, never the storage
PUT. With a propose-mode key the completed cover also carries
`quarantined: true`. `shop cover upload` first reads the product's
prices to check that the product exists in the key's workspace, so its key needs
`shop:catalog:read` as well as `shop:catalog:write`; an unknown product fails
with `not_found` (exit code 5) before anything is uploaded. Only with
`--group <id>` does a `$proposal:` reference to a product an earlier item of
that group creates skip that check; without a group it is checked like any
other id. The CLI adds the product update after successful completion, and never
updates the product when upload or completion fails. With a propose-mode key
that update is a proposal: the command prints the receipt and the image address,
which stays private until the owner approves, and `--group <id>` adds the
proposal to a group. `shop images upload <file>` only uploads a gallery image
and prints its URL; `shop products update <product-id> --images-file <path>`
then sets the ordered gallery from a JSON array of `{ "url", "alt" }` objects
(`-` reads it from stdin, `[]` removes every image).

```bash
pnpm --silent run cli --tenant acme shop cover upload <product-id> ./cover.png
pnpm --silent run cli --tenant acme shop images upload ./front.png
pnpm --silent run cli --tenant acme shop products update <product-id> --images-file ./images.json
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

## Download files

A direct-mode key with `shop:catalog:write` puts files on a digital-download
product without an owner session, in two steps: it **stages** a file, by
uploading it or by copying a ready file of another product on the server, and
then **attaches** it live, as a new file of a product or as the next version of
one of its files. It also removes file versions. Buyers with access to the
product get an attached file on their next download, personalised like any
other file ([File versions](storage.md#file-versions)). No key reads a file's
bytes: no route answers a key a download link, a signed read address or any
other address of a staged or attached file, or file content, and duplicating
a file is a copy made by the storage itself. The only storage address a
download file route gives a key is the presigned `PUT` of its own upload, which
writes that upload object and reads nothing.

A propose-mode key with `shop:catalog:write` stages files through the same
routes and under the same limits, and the attach, replace and remove routes
store a [change proposal](change-proposals.md#download-files) of
`download.add`, `download.replace` or `download.remove` instead, alone or in a
group, answered `202` with the receipt. Its staged file stays private, is held
by at most one pending proposal, and reaches buyers only when the owner
approves a proposal that attaches it; the owner can download it before
deciding through a 60-second link.

| Method and path | Scope | What it does |
|---|---|---|
| `GET /api/m2m/shop/products/:productId/downloads` | `shop:catalog:read` | lists the product's files as `GET /api/products/:productId/downloads` lists them to the owner |
| `POST /api/m2m/shop/downloads/upload` | `shop:catalog:write` | starts an upload: `{ fileName, contentType, sizeBytes }` |
| `POST /api/m2m/shop/downloads/complete` | `shop:catalog:write` | completes it: `{ uploadId }` |
| `POST /api/m2m/shop/downloads/copy` | `shop:catalog:write`, and `shop:catalog:read` | stages a server-side copy of a ready file: `{ productId, assetId }` |
| `GET /api/m2m/shop/downloads/staged` | `shop:catalog:write` | lists the key's staged files, oldest first |
| `DELETE /api/m2m/shop/downloads/staged/:id` | `shop:catalog:write` | discards a staged file and deletes its object |
| `POST /api/m2m/shop/products/downloads` | `shop:catalog:write` | attaches a staged file as a new file: `{ productId, stagedFileId, versionNote? }` |
| `POST /api/m2m/shop/products/downloads/replace` | `shop:catalog:write` | attaches a staged file as the next version of a ready file: `{ productId, replacesAssetId, stagedFileId, versionNote? }` |
| `POST /api/m2m/shop/products/downloads/remove` | `shop:catalog:write` | removes one file version: `{ productId, assetId }` |

**Upload.** The start checks the name, the type and the size, reserves the
file's share of the limits (below) and answers
`{ "upload": { "id", "url", "headers", "expiresAt" } }`: a presigned `PUT`,
valid for 15 minutes and signed for exactly `sizeBytes`, to a private object
only this upload uses. Send the bytes there with exactly the given `headers`
(`content-type` and `content-length`) and without the key, then complete
within the same 15 minutes. Completion copies the object on the server to a
staged object that only the server writes, streams that copy through SHA-256,
checks that its size is the declared size and that its first bytes match the
declared type, records the staged file and deletes the upload object. It
answers `{ "file": … }`, the staged file: `id`, `fileName`, `contentType`,
`sizeBytes`, `sha256`, `copiedFrom` (`null`), `createdAt` and `expiresAt`
(7 days after staging). Bytes written to the upload URL after completion
change nothing staged.

Completing an upload whose completion already staged its file answers that
staged file again while it is staged and the minute sweep has not settled the
upload; once the file was attached or discarded completion answers
`409 conflict`, as it does once the sweep settled the upload (at the earliest
20 minutes after it started), and `404` once the sweep purged it, at the
earliest a day after it started. Completion also answers:

- `409 conflict` while another completion of the same upload runs, when the
  upload was not completed within its 15 minutes, and after a completion that
  failed for a definite reason (start a new upload);
- `400 validation` when nothing was uploaded, when the stored object does not
  have the declared size (the signed `PUT` accepts no other) or when its first
  bytes are not of the declared type, and the upload is closed (start a new
  upload);
- `503 unavailable` with `Retry-After` when the storage did not answer in time
  or gave no definite answer: nothing was staged, the upload keeps its upload
  object, and a completion sent after the time in the message, when the failed
  attempt's 10-minute lease has ended, completes it, while the upload's 15
  minutes have not passed. That completion copies to a destination of its own
  under a fresh file id, so whatever the failed attempt's copy still writes
  lands only on that attempt's destination; of two such completions at once,
  one copies and the other answers `409 conflict`, or that staged file once the
  first finished. Because the failed attempt's destination stays owed until its
  delete is confirmed, such a completion counts one more file and the declared
  bytes against the limits below and answers `409 conflict` with
  the cap in `error.details.changeProposalCap`, changing nothing, when they do
  not fit; discard a staged file and complete the upload again;
- `503 integration_unavailable` when that lease ends after the 15 minutes, and
  when the storage refused to copy the upload (start a new upload);
- `503 unavailable` with `Retry-After: 1` when the upload is held by another
  request beyond the bound of its lock wait (retry the request; when the wait
  ran out as a completion was finishing, the retry answers `409 conflict` until
  that completion's 10-minute lease has ended, and completes the upload after
  it while the upload's 15 minutes have not passed);
- `404` for an upload of another key.

A completion that fails for a definite reason deletes the upload object and its
staged copy when the storage confirms the deletes; what it cannot delete stays
owned by the upload, counts against the limits, and is deleted by the minute
sweep. A completion whose storage outcome is unknown deletes nothing, because a
copy the storage still runs may land later: the minute sweep deletes both
objects once the upload is 20 minutes old and 30 minutes have passed since the
attempt started, the time within which the storage finishes a copy it accepted.
When a later completion takes the upload over, the failed attempt's destination
becomes an owed deletion due 30 minutes after that attempt started; it counts
against the limits until the minute sweep's delete is confirmed, and the sweep
deletes it whether or not a late copy landed there.

**Types, names and size.** The type is one of `application/pdf` (`%PDF-`
within the first 1024 bytes), `application/epub+zip` (a ZIP whose first entry
is the stored, uncompressed `mimetype` whose header declares the 20 bytes of
`application/epub+zip` and which holds them),
`application/zip` (a ZIP local file header first), `audio/mpeg` (first an
ID3v2.2, 2.3 or 2.4 tag with a synchsafe size, or an MPEG audio frame header
with a valid version, layer, bitrate and sampling rate), `audio/mp4` (an `ftyp`
box at offset 4 whose major brand is `M4A `, `M4B `, `isom`, `iso2`, `mp41`,
`mp42` or `dash`), `video/mp4` (the same, with `M4V ` and `avc1` in place of
`M4A ` and `M4B `), `image/png` and `image/jpeg`; any other type is refused
with `400`. The check reads the first 4096 bytes. Refused on purpose, although
some readers and players open them: an EPUB whose `mimetype` entry is
compressed or not first, or whose header leaves its sizes to a data descriptor,
an empty or spanned ZIP, an MP3 with padding or
another tag before its first frame, a PDF whose `%PDF-` does not lie within the
first 1024 bytes, and ISO media of any other brand (QuickTime, 3GP, HEIC,
AVIF). A file name has 1 to 255 characters after trimming and no control
or bidirectional formatting characters, and its last extension, in any letter
case, must be one the CLI maps to the declared type (below), or `.mp4` for
`audio/mp4`, the name an audio-only MP4 often has: `400 validation`
on `fileName` otherwise, so a buyer never saves a checked PDF as `.html` or
`.exe`. The CLI still declares `video/mp4` for a `.mp4` file; an audio-only one
is uploaded as `.m4a` or `.m4b`, or through the API with `audio/mp4`. A key's file is at most 256 MiB (the
product editor keeps its 1 GiB), so that one completion can copy and hash it
within a single request.

**Copy.** `downloads/copy` stages a copy of a ready file of a product of the
same workspace, made by the storage; the server then streams the copy through
SHA-256 to check its size and first bytes, and the bytes never pass through
the key. Before the copy is sent, the server asks the storage for the source's
size and entity tag: a source whose size is not the one its file row records
is refused without a copy. When the answer carries a strong entity tag (a
quoted string without the `W/` prefix), the copy is sent on the condition that
the source still has that tag, so on a storage that honours the condition a
source written again after the check is never copied. A storage that answers
no entity tag, only a weak one or a malformed value gets the copy without that
condition: only the size check before the copy and the size and first-bytes
check after it protect it, so a source replaced meanwhile by bytes of the same
size and a valid type is copied. A completion checks its upload object
the same way against the declared size. A file of another product or workspace, or one that is not ready,
answers `404`; a source above 256 MiB, or with a type or name a key could not
upload (a name whose extension is not of its type included), answers `400`; nothing is staged then. The copy counts against the
same limits as an upload. Before the copy is reserved, a limit answers `409
conflict` with its cap and a busy workspace `503 unavailable`. Once the copy was
reserved, every failure answers the same `400 validation` `This file cannot be
copied by a key; nothing was staged`, without details, whether the stored
object is missing, larger or smaller than its file row says, of another type,
or the storage did not answer, and one line naming the cause is logged for the
operator. Its staged file shows the key the name, type, size and `copiedFrom`
(`productId`, `assetId`, `versionNumber`), and `sha256` is `null`: a key never
receives a fingerprint of an existing file. The answer tells a key whether the
copy was staged; how long a refusal takes can tell it more
([Security](security.md#shop-management-keys)).

**Attach.** The new product file's id is the staged file's id and its object
is the staged object; nothing is copied again. The product must be a digital
download (`400` otherwise) of the key's workspace (`404`), the staged file must
be one this key staged (`404` for another key's), and the product holds at
most 100 file rows (`409`, cap `product_files`). With `replacesAssetId`, which
must be a ready file of the product, the file joins that file's lineage as its
next version and supersedes the previous latest version. An attached file is no
longer listed as staged. The answer is `{ "asset": … }`, the same file
metadata as the product file list. Attaching again a staged file this key
already attached to the same product answers that file the same way when the
retry asks for what was applied: no `replacesAssetId` for a file added as a new
file, or a `replacesAssetId` of an older version in the same lineage for a file
that replaced one (once the version it named was removed, exactly that
`replacesAssetId`), and the same `versionNote`. A retry after a lost answer
therefore adds nothing; a retry that asks for anything else answers `409
conflict` and changes nothing, and any other staged file that is gone answers
`404`.

**Remove.** Removing deletes one version of any file of the product, a file the
owner uploaded included, also one still uploading, and promotes the newest
remaining ready version of its lineage. Buyers get no new link to the removed
version, but a signed link issued before the removal keeps working until it
expires or the storage deletes the object. A propose-mode key's removal proposes only the removal of a
ready file: a file still uploading answers `400 validation` and nothing is
stored ([Download files](change-proposals.md#download-files)). The answer is
`{ "deleted": true }`. When the file's object was staged by a key, its deletion
is recorded in the same transaction and the minute sweep retries a storage
delete that failed ([Download file prefixes](storage.md#download-file-prefixes)).
A removal is never refused for the limits below: what a failed delete owes
counts against the key that staged the file until the storage confirms the
delete, and a new upload or copy of that key is refused only when its own
share does not fit beside that debt (see Limits).

**Staged files.** A staged file that is not attached becomes due for the minute
sweep 7 days after it was staged, and once its key is revoked, expires or is
purged, unless a pending, unexpired proposal holds it; a rejection, a
withdrawal or a recorded expiry of that proposal discards it right after the
decision commits, or leaves it to the minute sweep when that release cannot
run; until then the key cannot propose it again
([Release on decisions](change-proposals.md#download-files)). The sweep
first moves such a file to the owed deletions and only then deletes its
object, so from then on the file can no longer be attached or proposed, also
when the storage does not confirm the delete. After a
propose-mode upload or copy, the CLI prints such a file as `kept while the
proposal is pending` instead of its 7-day expiry. The key may discard a file
a pending proposal holds; an approval of that proposal then ends `stale`.
Discarding it removes it from the staged list at once and deletes its
object, or, when that delete fails, owes the deletion, which the sweep
retries; the discard answers success either way. An upload or copy record
that is not settled becomes due for the same sweep 20 minutes after it
started; one whose completion or copy is still running or was interrupted
(its outcome unknown) only once its last attempt also started 30 minutes ago,
while a completed attempt or one that failed definitely needs only the 20
minutes. The destination of a completion attempt that a later
completion took over becomes due 30 minutes after that attempt started. The
sweep serves the longest-waiting rows first within its own
time budget, so a due row may wait for a later run
([Download file prefixes](storage.md#download-file-prefixes)).

**Limits.** Checked when an upload or a copy starts, under a workspace-wide
lock taken before the key's own, so two keys cannot both take the last share.
A refusal answers `409 conflict` with the cap in
`error.details.changeProposalCap`:

| Limit | Value | Cap |
|---|---|---|
| Objects a key's rows still own: staged files, owed deletions, and uploads and copies not completed that still own an object, per key | 20 | `key_staged_files` |
| Staged bytes per key | 2 GiB | `key_staged_bytes` |
| Staged bytes per workspace, all keys together | 10 GiB | `workspace_staged_bytes` |
| Uploads and copies started per key in 15 minutes | 20 | `key_file_uploads` |
| Bytes of uploads and copies started per key in 24 hours | 10 GiB | `key_file_bytes_daily` |
| File rows per product, checked when a file is attached | 100 | `product_files` |

The limits are counted from rows in one database statement, so an object
whose ownership moves from an upload to a staged file while a start is
checked is counted once. The byte limits count staged files, objects whose
deletion is still owed, and each object an upload or a copy still owns at its
declared size: the upload object of an upload until the minute sweep settles
it, at the earliest 20 minutes after it started (a still valid upload URL can
write it again until then), and again from a day after its upload URL expired
(a day and 15 minutes after it started) while the sweep's second delete of it
is not confirmed, and the staged copy of an upload or a copy until a
completion hands it to a staged file or a delete of it is confirmed (by the
failed attempt, or by the minute sweep when the attempt's outcome was
unknown); the destination of an attempt that a later completion took over
counts as an owed deletion. A completed upload's file counts once, as its
staged file or its owed deletion; a file attached to a product has left the
staging budget and counts again only if its removal owes a delete. The file count adds owed
deletions and the uploads and copies, failed ones included, that still own an
object, without counting a completed upload again. Removing an attached file
is never refused: when its delete fails, what it owes counts against the key
that staged it until the storage confirms the delete, so the key's counted
usage can exceed a limit by what it attached before; a new upload or copy is
refused only when its own share does not fit beside that debt, so a small debt
does not block a start that still fits. The limits count rows, not the bucket:
an upload object that a still valid URL writes again after the sweep's first
delete is not counted until a day after its upload URL expired, when the owed
second delete of it counts again, so the objects in the bucket can exceed a
limit meanwhile and the counted usage can rise above a limit then without any
new start or attach. The 24-hour limit counts every upload and copy
started in the window, whatever became of it. When the workspace's staging lock
is not free within its bound, the start answers `503 unavailable` with
`Retry-After: 1` and reserves nothing.

```bash
curl -s -H "$KEY" -H "$JSON" -d '{"fileName":"workbook.pdf","contentType":"application/pdf","sizeBytes":<bytes>}' "$SHOP/downloads/upload" > file-upload.json
curl -s -X PUT -H 'content-type: application/pdf' --data-binary @workbook.pdf "<upload url from file-upload.json>"
curl -s -H "$KEY" -H "$JSON" -d '{"uploadId":"<upload id>"}' "$SHOP/downloads/complete"
curl -s -H "$KEY" -H "$JSON" -d '{"productId":"<product-id>","stagedFileId":"<staged file id>"}' "$SHOP/products/downloads"
curl -s -H "$KEY" "$SHOP/products/<product-id>/downloads"
```

The CLI runs the same steps:

```bash
pnpm --silent run cli --tenant acme shop files list <product-id>
pnpm --silent run cli --tenant acme shop files upload <product-id> ./workbook.pdf
pnpm --silent run cli --tenant acme shop files upload <product-id> ./workbook.pdf --replaces <asset-id> --note 'Second edition'
pnpm --silent run cli --tenant acme shop files copy <source-product-id> <asset-id> <product-id>
pnpm --silent run cli --tenant acme shop files remove <product-id> <asset-id>
pnpm --silent run cli --tenant acme shop files staged
pnpm --silent run cli --tenant acme shop files discard <staged-file-id>
```

`shop files upload` reads the product's file list first, so its key needs
`shop:catalog:read` as well; an unknown product or one that is not a digital
download fails before anything is uploaded, and so do a `--note` longer than
500 characters after trimming and a `--replaces` that is not a file of the
product (`not_found`) or not ready (`validation`). It takes the type from the file
extension (`.pdf`, `.epub`, `.zip`, `.mp3`, `.m4a`, `.m4b`, `.mp4`, `.m4v`,
`.png`, `.jpg`, `.jpeg`), streams the file from disk, completes the upload and
attaches it; a failed upload or completion attaches nothing. When the attach
fails, refused by the server or with its answer lost, the error message names
the staged file and the commands that show whether it was attached, proposed
or is still staged (the product's files, the key's staged files and its
proposals), since a refusal does not prove that the file is still staged; it
adds that the sweep may remove a file still staged and held by no pending
proposal from 7 days after it was staged, and the command that discards it at
once. `shop files copy` checks the target product the
same way, copies on the server and attaches the copy to the target; both
commands take `--note`. A cap refusal adds what to do next: discard staged
files, wait for the window, or remove a file of the product. With a
propose-mode key `upload` and `copy` stage the file the same way and propose
its attachment, and `remove` proposes the removal: each prints the receipt,
and `upload` and `copy` also the staged file and that it stays private until
the owner approves. `upload`, `copy` and `remove` take `--group <id>`; with
it, a product id written as `'$proposal:<id>'` is not checked first, since an
earlier item of the group creates it.

The typed client exposes `listProductDownloads`, `stageProductDownload` (start,
the storage `PUT` with the signed headers, completion; only the two API
requests carry the key, and a `Blob` body such as one from `fs.openAsBlob` is
streamed, not read into memory), `copyProductDownload`, `listStagedDownloads`,
`discardStagedDownload`, `addProductDownload`, `replaceProductDownload` and
`removeProductDownload`. The last three resolve to
`{ outcome: 'applied', asset }` (`{ outcome: 'applied', deleted: true }` for a
removal) for a direct-mode key and to `{ outcome: 'proposed', proposal }` for a
propose-mode key, and take `{ groupId }` as their third argument; the others
resolve to the answers of their routes.

## Order and fulfilment routes

Each route reuses the query or body, response, validation and use-case of its
session counterpart under `/api/orders`. Reads need `shop:orders:read`; every
action that changes an order needs `shop:fulfilment:write`, and a warehouse
integration usually carries both. An order id from another workspace answers
`404 not_found`. Shipments, line issues and ShipX events are recorded under the
issuing owner's account. Invoices and refunds are not available with a shop
management key; they stay on the staff session routes. A shop key never
refunds; a propose-mode key never refunds: no scope grants `order:refund`, and
the [staff refund routes](shop.md#staff-refunds) answer a key `401`.

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
`cache-control: private, no-store` headers. The export carries the session
export's columns, including the trailing `refunded_amount` (CSV, minor units)
and `refundedCents` (JSON): the platform-recorded staff and sold-out refunds,
or the paid amount for a `refunded` order (see
[Staff refunds](shop.md#staff-refunds)).

Each order line in the list, detail and verify responses carries `quantity`
(1 for lines stored without one) and `issuedCount`, as on the session routes;
the packing list ends with the session's `quantity` column. Issuing a line takes
the session issue body: no body issues one unit, and an optional JSON body
`{ "count": 2 }` hands over several units of a line at once (`validation` for
any other body, as described in the
[shop integration guide](shop-integration.md#8-poll-live-orders-and-record-fulfilment)).

Fulfilment keeps the session rules. Shipping an order that has already been
shipped answers `409 fulfilment_conflict`; issuing more units of a line than
are left to issue answers `409 conflict`. A manual shipment (`carrier` `other` or
`inpost` with a tracking number) needs no ShipX configuration and e-mails the
buyer the tracking number for a live order. `POST .../shipx` creates and pays
a real InPost shipment for a live order when the workspace's `production`
ShipX connection is saved, so automate it only with explicit operational
approval; a test-mode order uses the `sandbox` connection. Its body
may carry the optional `parcelTemplate` (`small`, `medium` or `large`) for this
shipment; without it the parcel takes the largest product size, and any other
value or an unknown field answers `400 validation` before anything is sent to
ShipX. A request that finds another request working on the same shipment answers
`409 fulfilment_conflict` and should be retried later. Every such call that
reaches its handler has its key history `request` row, written before the
handler runs, including a call the handler refuses: a validation error, a
lease conflict or a second shipment of a shipped order. A call refused before
the handler (an invalid key, an issuer who no longer qualifies, the rate
limit, a missing scope, mixed credentials, the off switch or the body size
limit) has no row and is recorded in request telemetry only (see
[Key history](#key-history)). `POST .../shipx/discard`
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
curl -s -H "$KEY" -H "$JSON" -d '{"count":2}' "$SHOP/orders/<order-id>/lines/<product-id>/issue"
curl -s -H "$KEY" "$SHOP/orders/<order-id>/shipx"
curl -s -H "$KEY" -X POST "$SHOP/orders/<order-id>/shipx"
curl -s -H "$KEY" -H "$JSON" -d '{"parcelTemplate":"large"}' "$SHOP/orders/<order-id>/shipx"
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
pnpm --silent run cli --tenant acme shop orders issue <order-id> <product-id> [--count 2]
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
`404 not_found`, and so does a candidate key a propose-mode key started, unless
the completing key is that key. For a propose-mode key `complete` publishes nothing and adds
`quarantined: true`; the settings write with that URL is a proposal, and the
image becomes public when the owner approves it.

```bash
curl -s -H "$KEY" "$SHOP/settings"
curl -s -H "$KEY" -H "$JSON" -d '{"termsUrl":"https://brand.example.test/terms","invoiceSellerName":"Example Press","shippingRates":[{"id":"courier","label":"Courier","amountCents":1500,"vatRatePercent":23,"carrier":"other","pickupPoint":"none","active":true}]}' "$SHOP/settings"
curl -s -H "$KEY" -H "$JSON" -d '{"supportUrl":null}' "$SHOP/settings"
```

### Settings CLI

`shop settings set` reads the JSON object from `--json-file <path>`, or from
stdin with `--json-file -`, and checks it against the allow-list before the
request. `shop branding upload <kind> <file>` runs upload, the signed `PUT`
and complete, and prints the URL; the file extension selects the content type.
With a propose-mode key the URL is the address the image takes once approved,
and the command also prints the `shop settings set` command that proposes it.
`--attach` sets the image as the settings field of its kind (`logoUrl`,
`logoDarkUrl`, `faviconUrl` or `ogImageUrl`) in the same command: live with a
direct-mode key, as a proposal with a propose-mode key (`--group <id>` adds it
to a group).

```bash
pnpm --silent run cli --tenant acme shop settings show
pnpm --silent run cli --tenant acme shop settings set --json-file shop-settings.json
echo '{"privacyUrl":"https://brand.example.test/privacy"}' | pnpm --silent run cli --tenant acme shop settings set --json-file -
pnpm --silent run cli --tenant acme shop branding upload logo ./logo.png
pnpm --silent run cli --tenant acme shop branding upload logo ./logo.png --attach
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

The generic secret routes accept only the secret names of the allow-list in
`core/domain/shop-management-key.ts`, the same list the use-case guard checks:
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
- **ShipX** keeps two connections: `production` serves live orders and
  `sandbox` serves test-mode orders. `configure` changes only the parts it is
  given: the shared optional `sender` (or `null` to remove it, so InPost uses
  the organization data), and per connection `production` or `sandbox` with
  `organizationId`, `token` or `"clearCredentials": true` (not together with
  new credentials). A connection left out keeps its credentials; the earlier
  top-level `environment`, `organizationId`, `token` and `clearCredentials`
  answer `400 validation`. The view answers the sender and, per connection, the
  masked organization id, the masked token and `configured`. This route is the
  only way a key reaches the four ShipX secret names
  (`shipx.production.organizationId`, `shipx.production.token`,
  `shipx.sandbox.organizationId`, `shipx.sandbox.token`); they are not on the
  generic allow-list above, and the route writes no other secret.

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
pnpm --silent run cli --tenant acme shop integrations shipx configure --slot sandbox \
  --sender-json-file sender.json --organization-id 12345 --token-env SHIPX_TOKEN
pnpm --silent run cli --tenant acme shop integrations shipx configure --slot production \
  --organization-id 67890 --token-env SHIPX_PRODUCTION_TOKEN
```

`--slot` names the connection that `--organization-id`, `--token-env`,
`--token-stdin` and `--clear-credentials` change, and is required with them;
`--sender-json-file` and `--clear-sender` need no slot. The typed client exposes `listIntegrationSecrets`,
`setIntegrationSecret`, `deleteIntegrationSecret`, `configureStripe`,
`probeStripe`, `configureStorage`, `getShipxSettings` and `configureShipx`.

## Responses and errors

Every JSON route answers the same envelope. A success is
`{ "ok": true, "data": { ... } }` with status `200` (`201` for sales-link
creation); a failure is `{ "ok": false, "error": { "code", "message",
"details"? } }` with the status of its code. Parse `data` with the contract
schemas in `core/contract` (`shopCatalogContracts`, `shopOrderContracts`,
`shopSettingsContracts`, `shopAssetsContracts`, `shopDownloadContracts`,
`shopIntegrationContracts`),
or use `createShopManagementClient`, which does that and returns a
`Result`. Every JSON response carries `cache-control: no-store`.

| Status | `error.code` | When | CLI exit code | What the backend does |
|---|---|---|---|---|
| 400 | `validation` | Malformed body or query, unknown settings field, disallowed secret key, Stripe key of the other mode; a download file whose stored bytes do not have the declared size or type, or a file a key cannot copy | 2 | Fix the request; never retry unchanged |
| 401 | `unauthorized` | Missing, unknown, revoked, expired, legacy or other-workspace key; a key whose issuer is no longer a verified owner; a cookie or `Authorization` header on the request | 3 | Stop and alert; ask a current owner for a new key |
| 403 | `forbidden` | The key lacks the route's scope, a propose-mode key calls a route its mode refuses, or a direct-mode key calls `POST /api/m2m/shop/products/access`, whose capability no scope grants | 4 | Stop and alert; issue a key with the needed scope or mode; for a product's access list, use a propose-mode key or an owner's session |
| 404 | `not_found` | The product, price, order, sales link, candidate upload, download file, file upload or staged file does not exist in this workspace or for this key | 5 | Treat as gone |
| 404 | `tenant_not_found` | The host or `x-tenant` selects no workspace | 7 | Fix the base URL or workspace slug |
| 409 | `conflict` | Stale sales-link revision, order line already issued, a download file limit (`error.details.changeProposalCap`), a file upload that is being completed, expired, failed or settled by the sweep, or completed and no longer staged | 6 | Re-read, then decide |
| 409 | `fulfilment_conflict` | Order already shipped, or another request is creating its InPost shipment | 27 | Re-read the order; shipped means done |
| 409 | `sold_out` | Public checkout of a product without available stock | 26 | Show the product as sold out |
| 412 | `integration_not_configured` | A provider the route needs is not set up | 8 | Run provisioning first |
| 422 | `invoice_exemption_basis_missing` | VAT `exempt` without a legal basis | 22 | Send the basis with the mode |
| 422 | `shipx_rejected` | InPost refused the shipment data | 29 | Correct the sender or order data |
| 429 | `rate_limited` | Per-key minute or day limit reached | 12 | Wait `Retry-After` seconds |
| 502 | `integration_auth` | A provider rejected the stored credentials | 9 | Reconfigure the provider |
| 503 | `integration_unavailable`, `shipx_unavailable` | A provider could not be reached, or a storage probe failed; for a download file completion, the upload can no longer be completed (the message says to start a new upload) | 11, 28 | Retry later with backoff; for a file completion, start a new upload instead |
| 503 | `unavailable` | The key history row of an accepted `POST`, `PUT`, `PATCH` or `DELETE` could not be written, the workspace's download file staging or an upload is busy, or the storage did not confirm a download file completion; the handler did not run or nothing changed | 20 | Wait `Retry-After` seconds, then retry the same request |
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
settings routes). Accepted types are PNG, JPEG, WebP and SVG, at most 5 MiB
(4 MiB for a propose-mode key, whose image the owner previews in one response);
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

Completion answers `{ "url": "/api/public/assets/product-cover/<file>" }`. A
propose-mode key gets `"servePath": null` from the upload start, with
`content-length` (the declared `sizeBytes`, which the signature covers) in
`upload.headers` beside `content-type`, and
`{ "url": "/api/public/assets/product-cover/<sha256>.png", "quarantined": true }`
from completion; the product update with that address then answers `202` with
a receipt, and the image becomes public only when the owner approves.
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
- ShipX `POST .../orders/<order-id>/shipx` on a live order with a saved
  `production` connection creates and pays a real InPost shipment.
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
   (test and live slots), storage and the ShipX sandbox connection, and reads
   the masked secret list without any secret value; it cannot read the catalog.
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

`scripts/key-download-replay.test.ts` replays the [download file](#download-files)
flow of a direct-mode key the same way, through the typed client: it uploads a
file, attaches it, lists it, uploads and attaches a second version, removes
that version, and copies the first file to a second product. Each upload body
is an in-memory `Blob` that the fake storage reads whole and accepts only at
the signed length, so the replay does not show a body streamed from disk. At
five checkpoints (after the first upload, the attach, the replacement, the
removal, and the copy with its attach) it reads back the file rows each time
and, at some of them, the staged files, the upload records, the owed deletions
or the stored objects.

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
pnpm --silent run cli --tenant acme shop integrations shipx configure --slot sandbox \
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
`0159_shop_management_keys` only adds the tables `shop_management_keys`,
`shop_management_key_rate_limit_buckets` and `shop_management_key_events`; it
does not change `tenant_api_keys` or any other existing table. The previous
release reads `tenant_api_keys` exactly as before, and nothing in it reads the
three new tables, so its key list, import audit and API-key authentication
answer as they did before this release, whatever shop management keys exist.
After the retreat, the previous release's `/api/health` answer reports
`schemaFingerprintMatch: false`: the live schema, which keeps the three tables
of the kept migration, no longer matches the schema fingerprint that release
was built with. This is expected while the newer schema remains. The order,
settings, asset and integration routes add no migration, so a retreat from
them to the release with only the catalog routes needs no data step either.

A retreat to a release that predates migration `0169_change_proposal_images`
needs no data step either. The migration only adds `change_proposal_images`,
`change_proposal_image_uploads` and `change_proposal_image_publications` with
their indexes; it changes no existing table. The release on production when
proposed images were added, `8141fd15`, is such a release.
`scripts/change-proposal-image-rollback-8141fd15.test.ts` holds literal copies
of its schemas and parsing steps and proves what it does with what this
release stores and answers. It ignores the three tables, and its shop image
routes refuse a propose-mode key (`403`). It lists, shows and rejects a pending
proposal that attaches a quarantined image like any other, but it publishes
nothing, so approving such a proposal there sets the field to an address that
has no public copy on either release: keep such proposals unapproved until
rolling forward. Its public asset route accepts only random-id file names and
answers `404` for a `<sha256>.<ext>` address, so a product cover or branding
image an approval published is missing on that release until rolling forward;
nothing is deleted. It serves a random-id image as this release does, with a
`302` to a presigned link that asks the storage for `image/svg+xml` and
`attachment` for an SVG, so an SVG this release stored with
`content-disposition: attachment` still loads in an `img` element and
downloads when opened directly; an SVG uploaded there during the retreat is
stored without that header. It reads the `stale` event note `image_unavailable: …` like
any other note, and names the key and the group of a `change-proposal`
notification from its community fields, which this release still fills. A
panel tab or CLI of that release refuses the begin answer of a propose-mode
key's image upload (`servePath: null`) and shows a pending proposal's
content-addressed image as not shown; reload open panel tabs and update the
CLI after deploying this release or rolling back. A lesson-question or
thread-reply notification this release stored can name a course other than
the lesson's first, the one through which the recipient reaches the lesson;
that release links it there, and for a member whose access it no longer opens
there ([Rolling back](change-proposals.md#product-access) under Product
access) the link opens a page they cannot see. Before the retreat, count the pending
proposals that attach a content-addressed image and the live image fields that
show one and, before retreating further than `8141fd15`, delete its
`change-proposal` notifications, as Rolling back under
[Images](change-proposals.md#images) and at the end of
[Download files](change-proposals.md#download-files) shows.

A retreat to a release that predates migration `0170_key_download_files` needs
no data step either. The migration adds
`change_proposal_download_files`, `change_proposal_download_uploads`,
`change_proposal_download_deletions` and
`change_proposal_download_upload_events` with their indexes, and the nullable
column `sha256`, without a check, on `product_download_assets`. On the three
tables of `0169` it adds the nullable column `sweep_attempted_at` without a
check to each, and nullable columns with checks: `delete_unresolved_at` on
`change_proposal_images` and `change_proposal_image_publications`,
`pending_since` on `change_proposal_images`, and `first_deleted_at`,
`completed_digest` and `completed_extension` on
`change_proposal_image_uploads`, with a check that the last two are set
together. Each new table's foreign key to `tenants` takes a `SHARE ROW EXCLUSIVE` lock
on `tenants`, which blocks writes to `tenants` (not reads) until the migration
transaction commits; each `CREATE INDEX` locks only its new, empty table; each
`ADD COLUMN` takes an `ACCESS EXCLUSIVE` lock on its table until the migration
commits, so file lists, buyer downloads and quarantined image work wait until
then. A column without a check is a change of the catalog only (no default, no
rewrite, no scan); each check reads its image table once under that lock, a
table that holds only rows of unreleased proposals
([Rolling back](change-proposals.md#images) under Images). No backfill touches
an existing table. A release without this code has no shop
key download file routes (`404`); the owner's file routes and buyer downloads
answer as before. It ignores the four tables and the columns, never sweeps the
staging rows and never deletes a staged or upload object, which stays under the
private download prefix while its row stays. After rolling forward, the minute
sweep of this release removes them, as far as the rows that own them still
exist, but never a staged file a pending, unexpired proposal holds. A file a key attached is an ordinary product file row there, served and
deleted by its stored object key like any other file; that release neither
selects nor parses the `sha256` column.

The release on production when download file proposals were added,
`8141fd15`, is such a release (it ends at `0167`; there is no `0168`).
It has no schema, statement or query that names the three tables of `0169`
or `change_proposal_download_deletions`, so the nullable columns and their
checks, and the object key check of the owed deletions, which allows both the
`key-files/` and the `key-uploads/` prefix, make no difference to it. Its
storage orphan report lists the key's staged files and upload objects under
`<workspace>/product-downloads/` as unreferenced, since it has no inventory of
the staging tables; it is a report only and deletes nothing.
`scripts/change-proposal-download-rollback-8141fd15.test.ts` holds literal
copies of its schemas and parsing steps and proves what it does with what this
release stores. It lists and shows a pending `download.add`,
`download.replace` or `download.remove` proposal, alone or in a group, to the
owner and to its key, lets the key withdraw it and the owner reject it, and
ends its approval `stale` with the unknown-operation note before any target
lock, applying nothing (a group with such an item applies none of its items).
It reads the `stale` event note `file_unavailable: …` like any other note, and
the storage probe's new `signedResponseOverrides` is never stored. It never
releases a staged file, so a file of a proposal it rejected or withdrew stays
staged and private until the minute sweep of this release removes it after
rolling forward. A panel tab or CLI of that release that talks to this
release's server fails to parse an owner answer carrying `proposedFiles`
until it is reloaded or updated. Before the retreat, count the pending
download file proposals and, before retreating further than `8141fd15`,
delete its `change-proposal` notifications, as
[Rolling back](change-proposals.md#download-files) under Download files
shows.

That release also applies a pending `product.create` without the course,
module and lesson checks this release runs at approval, as it always did for
the creates submitted to it: its creation refuses only a course that does not
exist in the workspace or is archived. A pending create, alone or in a group,
whose access list would end `failed` here can therefore be applied there and
stays live after rolling forward. Keep the pending `product.create` proposals
with access items, and their groups, unapproved during the retreat; the
candidate count is under Rolling back in
[Product access](change-proposals.md#product-access). This is read from that
release's source, not tested.

A retreat to a release that predates migration `0163_change_proposals` needs
no purge either, although that release reads `shop_management_keys` and
ignores its `mode` column. A propose-mode key is stored under the hash of its
secret in a separate propose-mode hash domain, so a release that looks keys up
by the plain hash of the presented secret finds no row and answers
`401 Invalid API key`: a propose-mode key never gains live write access there.
Direct-mode keys are stored under the plain hash as before and keep working.
Pending [change proposals](change-proposals.md) stay in their tables
untouched and are visible again after rolling forward. A propose-mode key that
is revoked or purged during the retreat leaves its proposals pending, for the
owner to reject after rolling forward.

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

## Purchase smoke purpose

An owner of the synthetic `tenant-acme` workspace can create an exclusive
purchase key through the same owner-session endpoint, using
`{name, purpose: "purchase-smoke", scopes: [], mode: "direct", expiresAt}`.
It keeps the 30-day maximum expiry and normal owner-only revoke/purge controls.
The secret is returned once. Mixed scopes and propose mode are refused.
From the CLI, signed in as that owner:
`together --tenant acme api-key shop-management create Purchase smoke --purpose purchase-smoke --expires-at <ISO datetime>`.

This purpose authorizes exactly two routes:

- `POST /api/m2m/shop/purchase-smoke/checkouts` accepts only `{runId, scenario}`.
  Scenarios are `digital-course`, `parcel-courier`, `parcel-locker`, and
  `bundle-locker`; the locker code is fixed at `WAW01M`.
- `GET /api/m2m/shop/purchase-smoke/checkouts/:reference/result` reads only a
  checkout created by the same key, including paid/refund state, the largest
  cumulative refunded amount among applied refund events, and receipts from
  successfully applied provider webhooks.

Checkouts always use the fixed synthetic member, fixture products and TEST
payments from the workspace's own stored test slot, never an inherited
organization slot. The live slot must be empty. A workspace-wide 40-checkout daily cap
includes pending sessions, and key/run/scenario retries are idempotent. Existing
purpose keys, expiry, revocation, audit, rate limits and bindings survive the
operator reseed; orders do not. A result whose order was removed is unavailable,
and a fresh run id is needed after reseeding. The runner's separate Stripe key
must come from a sandbox dedicated to this fixture workspace. See
[smoke fixture setup](observability.md#purchase-smoke-fixtures-and-machine-key)
and [the security boundary](security.md#purchase-smoke-machine-purpose).
