# Entitlement check

Together sells; another application checks. An application that keeps its own
users asks Together, with a key bound to one workspace, whether a person
currently has access to the workspace's products, and gets a small, versioned
answer. This page is written for the developer of that application and for the
workspace owner who issues the key. The security model is in
[security](security.md#application-keys).

## Status

| Surface | Status |
|---|---|
| `POST /api/m2m/entitlements/check` by verified e-mail or member id, up to 25 people per call | Available |
| Application keys: owner-session creation, listing and revocation (`/api/api-keys/application`, CLI `api-key application`) | Available |
| Typed client `createApplicationClient` and CLI `entitlement check` | Available |
| Product allow-list per key and the `entitlements:members:read` scope | Available |
| Studio screen for application keys | Not built; use the CLI |

A change feed and identifiers chosen by the application are not available in
this release.

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

## 2. Issue an application key (owner)

The owner signs in with the CLI and creates a key. The secret is shown once;
store it in the other application's secret store. The CLI keeps sessions per
API origin, so both commands name the same `--api-url`. The password comes
from a shell variable the owner fills from their password manager
(`TOGETHER_OWNER_PASSWORD` here; the CLI reads no password variable of its
own), never from a literal in the command.

```bash
pnpm --silent run cli --api-url https://togethercommunity.app \
  login --email owner@example.test --password "$TOGETHER_OWNER_PASSWORD"
pnpm --silent run cli --api-url https://togethercommunity.app --tenant acme \
  api-key application create Companion app \
  --expires-at 2027-01-31T00:00:00Z --product prod-pro
```

- `--scope entitlements:check` is the default and is all most applications
  need. Add `--scope entitlements:check entitlements:members:read` to also get
  each matched person's member id, look people up by member id and see a
  lapsed subscription.
- `--product` (repeatable) limits the key to those products; without it the
  key covers every product of the workspace.
- The expiry is at most 90 days ahead. Rotate by creating a new key before the
  old one expires, then `api-key application revoke <id>`.
- `api-key application list` shows keys without secrets. The key history is in
  `api-key shop-management events --key <id>`.

`api-key shop-management purge --yes` is the owner's emergency stop for the
workspace's shop management keys and application keys: it deletes all of them,
revoked or not. It does not touch the legacy tenant API keys (`api-key list`),
which the owner revokes one by one with `api-key revoke <id>`. The operator's
stop for the whole deployment is `SHOP_MANAGEMENT_KEYS=disabled`, which covers
the shop management routes and the entitlement check route only.

## 3. Check access (other application)

Call from your backend only. Send the key in `x-api-key` and choose the
workspace by its host (`acme.togethercommunity.app`) or with `x-tenant`.
Do not send cookies or an `Authorization` header; the request is refused.

```bash
curl -sS https://togethercommunity.app/api/m2m/entitlements/check \
  -H "x-tenant: acme" \
  -H "x-api-key: $TOGETHER_APPLICATION_KEY" \
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
      "identity": "verified",
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
  product now: the grant rule Together uses for members. Lesson access in
  Together also lets staff and free previews through; the check ignores both.
- `source`: the origin recorded on the grant when it was created: `purchase`
  (a payment), `grant` (given by staff) or `import` (migrated from a previous
  platform). A payment is reported as `subscription` while a current
  subscription keeps the window moving (see `subscription`). A later renewal
  of the same grant through another route keeps the recorded origin, so
  `source` is informational and is not proof of what paid for the current
  window; rely on `access`. `null` without access.
- `subscription`: the newest subscription for that product. It is reported
  only when the access has an end date and that subscription is `active` or
  `past_due` or paid through the check time, and an access whose recorded
  origin is a payment is then reported with `source` `subscription`; with
  `entitlements:members:read` the subscription is reported in every case, a
  lapsed one included.
- Without `productIds`: a key with an allow-list answers every allow-listed
  product; a key without one lists only the products the person has access
  to, so an empty list means no access.
- `identity`: `"verified"` when the person was matched through a verified
  account whose member in this workspace has a recorded sign-in and the
  answer reveals the match (access to at least one answered product, or a key
  with `entitlements:members:read`); otherwise `null`. Treat any other value
  as `null`: later versions may add ways to match without changing `version`.
- `member`: `{ "id": … }` for a matched person with `entitlements:members:read`,
  otherwise `null`. The id names the person's member row in this workspace.
  You may store it next to your own user and check by `memberId` afterwards,
  so the address is not sent again. It identifies the row, not the person:
  after the operator's bulk import moves a member to another account (the
  limitation in [security](security.md#application-keys)), the row answers
  for that account. So re-confirm a stored id by your user's verified e-mail
  address whenever you re-verify the user (for example at sign-in), and drop
  a stored id that the e-mail check no longer returns.
- A `memberId` matches only when that member's current account exists and has
  a verified e-mail address and the member has a recorded sign-in in this
  workspace: the same rule as for an e-mail address. Otherwise the answer is
  the one for a person who matches nobody.
- With `entitlements:members:read` a matched person is named with the member
  id even without access to any product. A `null` member does not prove that
  the person is not a member: a member whose account is unverified or who has
  no recorded sign-in answers like an unknown person. The answer echoes the
  selector you sent and returns no other address.
- An unknown person, an unverified address, a member with no recorded sign-in
  in this workspace and a known person without access give the same answer
  unless the key holds `entitlements:members:read`.
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

The CLI reads the key from `TOGETHER_APPLICATION_KEY` in its environment (or
the variable named by `--api-key-env`), never from an argument:

```bash
printf 'ada@example.test\nmember:3f6c…\n' | pnpm --silent run cli \
  --api-url https://togethercommunity.app --tenant acme \
  --json entitlement check --subjects-file - --product prod-pro
```

Inside this repository, the typed client:

```ts
import { createApplicationClient } from '#core/client/index.js';

const together = createApplicationClient({ baseUrl: 'https://togethercommunity.app', apiKey, tenant: 'acme' });
const answer = await together.checkEntitlements({ subjects: [{ email }], productIds: ['prod-pro'] });
```

`--email` exists for quick manual checks; addresses passed as arguments land in
shell history, so prefer `--subjects-file`.

## What your application must do itself

The check answers for the selector it is given; it does not know who is using
your application. Your application must:

- take the e-mail address only from its own authenticated user whose mailbox
  it has verified, never from a form field;
- if it stores a returned member id, bind it to that same user on its server
  and re-confirm it by that user's verified e-mail address whenever it
  re-verifies the user, dropping an id the e-mail check no longer returns;
- never treat a selector typed by a visitor (an address or a member id) as
  proof of who they are.

## Freshness

The answer is read from the database at request time; nothing is cached. After
a payment, access appears when the payment provider's webhook arrives, normally
within seconds; when a delivery fails the provider retries for up to several
days, and the owner's reconciliation report lists paid orders without a grant.

### When does a new buyer start to match

A person matches only when their account has a verified e-mail address and
their member in this workspace has a recorded sign-in. For a buyer new to
the platform, neither happens on the checkout itself:

1. For a buyer who has no account yet, the payment webhook creates one,
   unverified; an existing account is kept as it is (`ensureUser` in
   `app/adapters/auth/create-auth.ts`). The webhook queues the purchase
   e-mail. That e-mail carries a one-time sign-in link (`queueEnrollmentWelcome` in
   `app/core/server/usecases/fulfill-enrollment.ts`), valid for one hour
   (`MAGIC_LINK_TOKEN_EXPIRES_IN_SECONDS` in `app/core/domain/identity.ts`).
2. The success page only polls the payment status (the `paymentStatus` query
   in `app/apps/web/src/features/checkout/CheckoutPage.tsx`, served by
   `getCheckoutSessionStatus` in
   `app/core/server/usecases/checkout-session-status.ts`). It creates no
   session and writes no `sign-in` event.
3. When the buyer opens that link (or asks for a new one on the sign-in page),
   the account is verified, a session is created and a `sign-in` event is
   written for the buyer's member in this workspace (the sign-in hook in
   `app/adapters/auth/create-auth.ts` calls `recordSignIn`, which
   `app/apps/server/src/composition.ts` provides). That event is written on a
   best-effort basis: a failed write is logged, and the next sign-in writes
   its own event.

Once both hold the person matches, and `access` is `true` when a live grant
exists. So a buyer who is new to the platform reads as no access until they
open the purchase e-mail, while a person who already has a verified account
and a recorded sign-in in this workspace matches as soon as the grant exists.
Recommended handling in the other application:
- After a purchase, show "Confirm your purchase with the link in the e-mail we
  sent you", then re-check when the person comes back or presses "I have
  confirmed".
- Re-check on a short back-off, for example after 30 s, 2 min and 10 min,
  within the rate limit.
- Never grant access on your side because of the payment alone.

## Gaps found for new applications

- Workspaces for new applications are created only by the operator; an owner
  cannot create one by themselves once public creation is closed.
- No Studio screen issues application keys yet; the owner uses the CLI.
- A buyer new to the platform matches only once a sign-in to the workspace is
  recorded for their member, normally through the link in the purchase e-mail
  (see "When does a new buyer start to match").
- Organizations (one owner, several workspaces) cannot yet share one key across
  their workspaces; a key is bound to one workspace.
