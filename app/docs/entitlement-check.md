# Entitlement check

Together sells; another application checks. An application that keeps its own
users asks Together, with a key bound to one workspace, whether a person
currently has access to the workspace's products, and gets a small, versioned
answer. This page is written for the developer of that application and for the
workspace owner who issues the key. The security model is in
[security](security.md#entitlement-keys); the single sign-on estimate is in
[sign in with Together](sso-estimate.md).

## Status

| Surface | Status |
|---|---|
| `POST /api/m2m/entitlements/check` by verified e-mail or member id, up to 25 people per call | Available |
| Entitlement keys: owner-session creation, listing and revocation (`/api/api-keys/entitlement`, CLI `api-key entitlement`) | Available |
| Typed client `createEntitlementClient` and CLI `entitlement check` | Available |
| Product allow-list per key and the `entitlements:members:read` scope | Available |
| Change feed or signed webhook for access changes | Designed, not built (below) |
| An external identifier the other application sets per person | Designed, not built (below) |
| Studio screen for entitlement keys | Not built; use the CLI |

## 1. A workspace for the new application

The application's products live in a Together workspace. To start a new one,
use the existing operator provisioning; there is nothing new to build:

1. The person who will own the workspace creates a Together account and
   verifies the e-mail address (a magic-link sign-in does that).
2. The instance operator provisions the workspace with that owner, as in
   [operator tenant provisioning](tenant-provisioning.md):

   ```bash
   pnpm --silent run cli --api-url https://togethercommunity.app \
     --json operator tenant provision --slug acme --name 'Acme' --owner-email owner@example.test
   ```

   The CLI reads the operator secret from `OPERATOR_SECRET` in its process
   environment; it has no option for it.

3. The owner signs in to the new workspace and follows the owner setup in that
   guide: language and branding, terms and privacy URLs, payment account,
   storage when products carry files, then publishes the products the other
   application will check.
4. The operator confirms with `operator tenant readiness --slug acme`.

What the owner must do by hand: verify their account, connect the payment
account in their own session (the operator route never accepts payment
credentials) and create the products. Gaps are listed at the end of this page.

## 2. Issue an entitlement key (owner)

The owner, signed in to the workspace with the CLI, creates a key. The secret
is shown once; store it in the other application's secret store.

```bash
pnpm --silent run cli login --email owner@example.test
pnpm --silent run cli --tenant acme api-key entitlement create Companion app \
  --expires-at 2027-01-31T00:00:00Z --product prod-pro
```

- `--scope entitlements:check` is the default and is all most applications
  need. Add `--scope entitlements:check entitlements:members:read` to also get
  each matched person's member id, look people up by member id and see a
  lapsed subscription.
- `--product` (repeatable) limits the key to those products; without it the
  key covers every product of the workspace.
- The expiry is at most 90 days ahead. Rotate by creating a new key before the
  old one expires, then `api-key entitlement revoke <id>`.
- `api-key entitlement list` shows keys without secrets. The key history is in
  `api-key shop-management events --key <id>`.

The owner's emergency stop for every machine key of the workspace is
`api-key shop-management purge --yes`; the operator's stop for the whole
deployment is `SHOP_MANAGEMENT_KEYS=disabled`.

## 3. Check access (other application)

Call from your backend only. Send the key in `x-api-key` and choose the
workspace by its host (`acme.togethercommunity.app`) or with `x-tenant`.
Do not send cookies or an `Authorization` header; the request is refused.

```bash
curl -sS https://togethercommunity.app/api/m2m/entitlements/check \
  -H "x-tenant: acme" \
  -H "x-api-key: $TOGETHER_ENTITLEMENT_KEY" \
  -H "content-type: application/json" \
  --data @- <<'JSON'
{ "subjects": [{ "email": "ada@example.test" }], "productIds": ["prod-pro"] }
JSON
```

Locally, after `pnpm run db:seed`, use `http://localhost:48730` with
`-H "x-tenant: acme"` and a key created for the `acme` fixture workspace.

Answer (`200`, inside the usual `{ "ok": true, "data": … }` envelope):

```json
{
  "version": 1,
  "results": [
    {
      "subject": { "email": "ada@example.test" },
      "products": [
        {
          "productId": "prod-pro",
          "access": true,
          "source": "subscription",
          "subscription": { "status": "active", "currentPeriodEnd": "2026-12-20T00:00:00.000Z", "cancelAtPeriodEnd": false },
          "checkedAt": "2026-11-20T21:00:00.000Z"
        }
      ],
      "member": null
    }
  ]
}
```

Request rules:

| Field | Rule |
|---|---|
| `subjects` | 1 to 25, in the order you want the answers. Each is exactly one of `{ "email": … }` or `{ "memberId": … }` (member ids need `entitlements:members:read`). |
| `productIds` | Optional, 1 to 50. One answer per product, in your order. On a key with an allow-list every id must be on it, otherwise `403` and no answer at all. |

Answer rules:

- `access` is `true` exactly when the person has an active grant for the
  product now; that is the rule Together itself uses to open lessons.
- `source`: `purchase` (a one-time payment), `subscription` (a payment kept up
  by a subscription), `grant` (given by staff) or `import` (migrated from a
  previous platform); `null` without access.
- `subscription`: the newest subscription for that product, reported only with
  access (or, with `entitlements:members:read`, also when it lapsed).
- Without `productIds`: a key with an allow-list answers every allow-listed
  product; a key without one lists only the products the person has access
  to, so an empty list means no access.
- `member`: `{ "id": … }` for a matched person with `entitlements:members:read`,
  otherwise `null`. Store it to keep the link when the person changes e-mail
  address, and check by `memberId` afterwards.
- An unknown person, an unverified address and a known person without access
  give the same answer unless the key holds `entitlements:members:read`.
- Never in the answer: names, addresses, orders, amounts.

Which subscription statuses give access: none by themselves. Access is the
grant window that the payment webhook keeps in step with the subscription:

| Subscription | Access until |
|---|---|
| `active` | the end of the paid period plus 3 days grace |
| `active` with `cancelAtPeriodEnd` | the end of the paid period |
| `past_due` | the end of the last paid period plus 3 days grace |
| `canceled` | the date it was paid through |

An order cancelled and refunded because the goods sold out never gives access.

Errors use the usual envelope: `400 validation`, `401 unauthorized` (missing,
unknown, revoked, expired or other-workspace key), `403 forbidden` (a product
outside the key's list, a member id without the scope), `404` while the
deployment switch is off, `429 rate_limited` with `Retry-After`, `503
unavailable` with `Retry-After` when the key history cannot be written (nothing
was checked; retry).

Limits per key: 300 people a minute and 20,000 a day, counted per person in the
request, not per call.

With the CLI or the typed client:

The CLI reads the key from `TOGETHER_ENTITLEMENT_KEY` in its environment (or
the variable named by `--api-key-env`), never from an argument:

```bash
printf 'ada@example.test\nmember:3f6c…\n' | pnpm --silent run cli \
  --api-url https://togethercommunity.app --tenant acme \
  --json entitlement check --subjects-file - --product prod-pro
```

Inside this repository, the typed client:

```ts
import { createEntitlementClient } from '#core/client/index.js';

const together = createEntitlementClient({ baseUrl: 'https://togethercommunity.app', apiKey, tenant: 'acme' });
const answer = await together.check({ subjects: [{ email }], productIds: ['prod-pro'] });
```

`--email` exists for quick manual checks; addresses passed as arguments land in
shell history, so prefer `--subjects-file`.

## Freshness

The answer is read from the database at request time; nothing is cached. After
a payment, access appears when the payment provider's webhook arrives, normally
within seconds; when a delivery fails the provider retries for up to several
days, and the owner's reconciliation report lists paid orders without a grant.
A buyer whose account was created by the payment reads as no access until their
first sign-in verifies the address.

To learn about changes later without polling everyone (designed, not built): a
cursor-paginated feed `GET /api/m2m/entitlements/changes?cursor=…`, readable with
`entitlements:members:read`, listing `{ memberId, productId, changedAt }` for
grant window changes of the key's products, following the order change feed;
the application re-checks the listed people. A signed webhook to a URL stored
with the key is the later alternative.

## An identifier of your own (designed, not built)

So that an e-mail change does not break the link, each key could store one
identifier per person chosen by the other application: a table of
(workspace, key, external id, member id), unique per key on both the external
id and the member, set through `PUT /api/m2m/entitlements/links` with
`{ externalId, email }` (verified addresses only) under a new write scope
`entitlements:links:write`, and looked up with `{ "externalId": … }`. Links are
namespaced per key, so two applications never read or overwrite each other's.
Until then, the member id returned under `entitlements:members:read` is the
stable link.

## Gaps found for new applications

- Workspaces for new applications are created only by the operator; an owner
  cannot create one by themselves once public creation is closed.
- No Studio screen issues entitlement keys yet; the owner uses the CLI.
- A buyer created by a payment is unverified until their first sign-in, so the
  check answers no access for them until then.
- Organizations (one owner, several workspaces) cannot yet share one key across
  their workspaces; a key is bound to one workspace.
