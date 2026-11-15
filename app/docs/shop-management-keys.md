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
| Shop resource routes under `/api/m2m/shop` | Not yet available |

Until the resource routes ship, a newly created shop management key reaches no
endpoint.

## Scopes

A shop management key carries one or more of these scopes and nothing else.
Shop scopes cannot be combined with `report:read`, `enrollment`, `marketing`,
`transactional`, `subscriptions:*` or `import:*` on one key, and a legacy key
cannot carry a shop scope. An existing unscoped legacy key never gains shop
access.

| Scope | Grants on the shop routes |
|---|---|
| `shop:catalog:read` | Read products and prices |
| `shop:catalog:write` | Create and edit products and prices, publish |
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
