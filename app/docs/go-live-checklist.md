# Go-live checklist

This checklist is for the owner performing the production launch. Complete every
owner action and pre-launch verification against the production configuration or
the named staging environment.

### 1. Magic-link exposure

**STATUS:** done

Magic-link exposure fails closed at boot. `AUTH_DEV_EXPOSE_MAGIC_LINKS` defaults
to `false` (`apps/server/src/env.ts:44-47`), and production rejects `true`
(`apps/server/src/env.ts:121-127`, `apps/server/src/env.ts:174-181`). When
enabled outside production, the auth adapter writes links to `dev_magic_links`
(`adapters/auth/create-auth.ts:206-212`) and the sign-in response exposes them
(`apps/server/src/internal-app.ts:680`).

Verify the deployed environment has `AUTH_DEV_EXPOSE_MAGIC_LINKS` unset or set
to `false`.

### 2. Dev and simulation endpoints

**STATUS:** done

Simulation endpoints fail closed at boot. `SIMULATED_PAYMENTS` defaults to
`false` (`apps/server/src/env.ts:40-43`), and production rejects `true`
(`apps/server/src/env.ts:114-120`). The flag gates the complete `/api/dev/*`
block, including purchase, grant, magic-link, e-mail, and subscription-cycle
simulation endpoints (`apps/server/src/internal-app.ts:474-731`).

Verify the deployed environment has `SIMULATED_PAYMENTS` unset or set to
`false`.

### 3. Tenant self-signup

**STATUS:** done

Production requires `TENANT_CREATION=closed`. The default and production guard
are in `apps/server/src/env.ts:28` and `apps/server/src/env.ts:93-99`.

Verify the deployed environment explicitly sets `TENANT_CREATION=closed`.

### 4. Secrets that must not stay at development defaults

**STATUS:** owner-action

Production boot rejects development defaults for `BETTER_AUTH_SECRET`
(`apps/server/src/env.ts:29`, `apps/server/src/env.ts:100-106`),
`SECRETS_MASTER_KEY` (`apps/server/src/env.ts:31`,
`apps/server/src/env.ts:107-113`), `EMAIL_DISPATCH_SECRET`
(`apps/server/src/env.ts:58`, `apps/server/src/env.ts:142-147`),
`MARKETING_TICK_SECRET` (`apps/server/src/env.ts:59`,
`apps/server/src/env.ts:149-154`), and `CRON_SECRET`
(`apps/server/src/env.ts:60`, `apps/server/src/env.ts:156-162`).

Generate and set every secret before deployment. Generate the master key with:

```sh
openssl rand -base64 32
```

Set `SECRETS_MASTER_KEY` before storing any Stripe, SES, Bunny, or S3 tenant
secret. Rotating it later requires re-encrypting `tenant_secrets`, and the
repository has no rotation tool.

### 5. Stripe payment provider

**STATUS:** owner-action

`PAYMENT_PROVIDER` defaults to `fake` (`apps/server/src/env.ts:32`), and the
production validation branch does not check it
(`apps/server/src/env.ts:91-168`). The fake adapter returns
`https://fake.checkout.local/...` checkout URLs
(`adapters/payment/fake.ts:41`).

Set `PAYMENT_PROVIDER=stripe`, store the tenant credentials, and run:

```sh
pnpm --silent run cli --tenant <slug> stripe test-connection
```

Complete item 11 before accepting payments.

### 6. Production e-mail provider

**STATUS:** owner-action

`EMAIL_PROVIDER` defaults to `dev` (`apps/server/src/env.ts:48`). The dev
provider writes every message to `dev_emails`
(`adapters/email/dev.ts:14-25`) and is selected in
`apps/server/src/composition.ts:402-414`. Production validation does not reject
it. `EMAIL_FROM` becomes required only for `ses` or `smtp`
(`apps/server/src/env.ts:84-90`, `apps/server/src/env.ts:135-140`).

Set `EMAIL_PROVIDER=ses` or `EMAIL_PROVIDER=smtp`, set `EMAIL_FROM`, and send a
transactional test message from the production deployment.

### 7. Secure cookies

**STATUS:** owner-action

`SECURE_COOKIES` defaults to `false` (`apps/server/src/env.ts:36-39`) and has no
production guard. The production security contract requires the `Secure` cookie
flag (`docs/security.md:1-7`).

Set `SECURE_COOKIES=true`. Sign in on the production origin, open the browser
developer tools, and confirm the session cookie has `Secure`, `HttpOnly`, and
`SameSite=Lax`.

### 8. Secrets rotation, including the legacy AWS key

**STATUS:** owner-action

The legacy platform's read-capable AWS key was stored in the development
database for `akademia-samouka` as `s3.accessKeyId` and `s3.secretAccessKey`
(`tasks/import-rehearsal-audit.md:46`). The SigV4 presigner consumes those
secrets through `core/server/usecases/lesson-media.ts` and
`adapters/storage/s3.ts`.

Create a fresh least-privilege IAM user limited to `s3:GetObject` on the media
prefix. Store it on the production tenant:

```sh
pnpm --silent run cli --tenant <slug> tenant-secret set s3.accessKeyId <id>
pnpm --silent run cli --tenant <slug> tenant-secret set s3.secretAccessKey <secret>
```

A tenant configured through the integrations panel wizard stores endpoint,
region, bucket and both keys in the single encrypted `s3.configuration` secret
instead; the presigner reads the keys from whichever of the two shapes exists.

The commands are implemented in `apps/cli/src/main.ts:2368-2381`. Deactivate and
then delete the legacy key in IAM. Delete the development copy with:

```sh
pnpm --silent run cli --tenant akademia-samouka tenant-secret delete s3.accessKeyId
pnpm --silent run cli --tenant akademia-samouka tenant-secret delete s3.secretAccessKey
```

Deletion is implemented in `apps/cli/src/main.ts:2383-2390`. Open an imported
PDF lesson as a member to verify the replacement. Rotate
`stripe.restrictedKey`, `stripe.webhookSecret`, `ses.*`, and `bunny.*` in the
same pass if they were ever copied into development.

### 9. Tokenized e-mail unsubscribe

**STATUS:** done

Every send mints an opaque token from 24 random bytes
(`apps/server/src/composition.ts:471`). Tokens are stored per send with a unique
index in `unsubscribe_tokens` (`adapters/db/app-schema.ts:1328-1342`) and issued
for broadcasts and test sends (`core/server/usecases/marketing-email.ts:997-1003`,
`core/server/usecases/marketing-email.ts:1373-1385`). Links use
`${APP_BASE_URL}/u/<token>` (`apps/server/src/composition.ts:521`), and messages
carry both one-click unsubscribe headers
(`core/domain/marketing-email.ts:335-338`). Consumption marks `used_at`
(`core/server/ports.ts:1122-1131`,
`core/server/usecases/marketing-email.ts:467-522`). No address appears in the
URL.

Verify once in production by sending a campaign to a controlled Gmail address.
Gmail's native one-click control and the preference page's plain Confirm button
withdraw only the consent named by the production token's `consent:<id>` scope
(`core/server/usecases/marketing-email.ts:467-522`,
`core/server/usecases/marketing-email.ts:997-1003`). For each action, verify
that the latest consent projection is withdrawn:

```sql
select definition_id, status, occurred_at
from marketing_consents
where email = lower(trim('<controlled-address>'))
order by occurred_at desc, id desc
limit 1;
```

The row must have `status = 'withdrawn'` for the campaign's consent definition.
For a campaign send, the `email_events` lifecycle also records
`mail_kind = 'marketing'` and `type = 'unsubscribed'`. Neither action writes a
suppression row for a production consent-scoped token.

Then open the preference page and use Unsubscribe from everything. That button
is the separate `/u/:token/all` path and writes `unsubscribe_global`
unconditionally (`apps/server/src/marketing-routes.ts:591-602`,
`core/server/usecases/marketing-email.ts:525-583`,
`apps/server/src/public-marketing-pages.ts:306`). Verify it with:

```sql
select email, reason
from suppressions
where email = '<controlled-address>'
  and reason = 'unsubscribe_global';
```

This query must return the controlled address. Its plaintext `email` predicate
is valid only for unsubscribe suppressions. Erasure suppressions store
`email = null` and only `email_hmac`
(`adapters/db/repositories.ts:1347-1351`).

### 10. Rate limiting

**STATUS:** owner-action

The only request limiter is Better Auth's built-in limiter. Custom rules allow
20 requests per 60 seconds for `/sign-in/magic-link`,
`/request-password-reset`, `/magic-link/verify`, and `/sign-in/email`
(`adapters/auth/create-auth.ts:114-127`). No storage is configured, so counters
are in-memory per process and keyed by client IP.

Counters reset on every deploy and cold start. Separate Vercel instances do not
share a bucket (`vercel.json`, `apps/server/src/entry.vercel.ts`), so effective
throughput is 20 times the number of active instances. A NAT, corporate network,
or mobile-carrier cohort also shares one bucket on the paying-member magic-link
login path.

Nothing else rate-limits requests. `rateLimited` exists but is unused
(`core/domain/errors.ts:65`), while `marketing_throttle_buckets` is a per-tenant
SES sending budget rather than a request limiter
(`adapters/db/app-schema.ts:1387`).

Before launch, add an edge or WAF rule in front of `/api/auth/*`. Treat the
current rule as a bot speed bump, not an account-security control. Record a
follow-up to give Better Auth a database-backed store shared across instances
and cold starts.

### 11. Real Stripe verification runbook

**STATUS:** pre-launch-verify

Only `PAYMENT_PROVIDER=fake` has been exercised end to end. Run this procedure
against a Stripe test-mode account on staging with `PAYMENT_PROVIDER=stripe`.
Repeat the signature and refund checks once in live mode with a 1 PLN product.

Store `stripe.restrictedKey` and `stripe.webhookSecret` with `tenant-secret set`.
In Stripe, add
`https://<tenant-domain>/api/webhooks/stripe/<tenantId>` as a webhook endpoint
(`core/contract/routes.ts:1214`,
`apps/server/src/public-app.ts:548-571`). Enable exactly
`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`charge.refunded`, and `charge.dispute.created`
(`core/server/usecases/stripe-webhook.ts:103-111`).

Confirm credentials with:

```sh
pnpm --silent run cli --tenant <slug> stripe test-connection
```

The command creates and immediately expires a session
(`apps/cli/src/main.ts:2394-2401`,
`core/server/usecases/provider-diagnostics.ts`).

Use real signed Stripe deliveries. Do not use `stripe deliver-webhook`, which
uses the CLI's own signer (`apps/cli/src/main.ts:2403-2419`).

a. Buy a subscription product with card `4242 4242 4242 4242`. Confirm a member,
grant, paid order, fulfillment e-mail, and a webhook 2xx in Stripe.

b. Advance a Stripe test clock until `invoice.paid`. Confirm a renewed period
and a second paid order (`core/server/usecases/stripe-webhook.ts:425`).

c. Force a renewal failure with card `4000 0000 0000 0341`. Confirm the
subscription becomes `past_due` and the order becomes `failed`
(`core/server/usecases/subscription-lifecycle.ts:200-228`).

d. Refund the charge in Stripe. Confirm the order becomes `refunded` and the
grant is revoked when no other paid access remains
(`core/server/usecases/stripe-webhook.ts:491-540`).

e. Open a dispute with card `4000 0000 0000 0259`. Confirm
`charge.dispute.created` follows the same adjustment path.

f. Cancel the subscription in Stripe. Confirm
`customer.subscription.deleted` makes the local row `canceled` through
`updateSubscriptionFromProvider`.

g. Remove that member in the staff panel. Confirm the Stripe subscription is
immediately canceled, `subscriptionCancellations` reports `canceled`, and a
later test-clock tick does not revive access.

h. Change one byte in a payload and replay it. Confirm HTTP 400 with no state
change (`adapters/payment/stripe.ts:259-317`,
`apps/server/src/public-app.ts:555-562`,
`core/contract/http-status.ts:8`). Redeliver an already processed
event from Stripe and confirm `processed=false` with no duplicate order
(`core/server/usecases/stripe-webhook.ts:610-612`,
`adapters/db/app-schema.ts:797-812`).

i. After the run, execute the SQL in item 15 and call
`GET /api/orders/reconciliation`
(`core/server/usecases/order-reconciliation.ts:20`).

### 12. Bunny token authentication

**STATUS:** pre-launch-verify

Signing activates only when the tenant stores `bunny.securityKey`.
`core/server/usecases/lesson-media.ts:76-86` resolves the key, and
`core/server/usecases/lesson-media.ts:42-53` appends `token` and `expires` with a
one-hour lifetime (`core/server/usecases/lesson-media.ts:22`). The HMAC
implementation is in `adapters/crypto/bunny-embed-token-signer.ts`.

For every production tenant with `bunny.securityKey`, open Bunny dashboard,
then Stream, the library, Security, and Token Authentication. Enable Token
Authentication. Request an embed URL, remove its query string, and confirm
Bunny rejects the unsigned URL. If no production tenant stores the key, mark
this item not applicable rather than done.

### 13. Dev sink purge

**STATUS:** done

PR #21 shipped in commits `2b7ce55` and `3b79a22`, merged as `544b489`.
`createDevSinkPurge` deletes both sink tables
(`adapters/db/repositories.ts:2158-2167`). Node startup runs it once outside
tests (`apps/server/src/entry.node.ts:16-25`), while
`selectDevSinkPurge` returns no capability in production
(`apps/server/src/composition.ts:346-350`).

`apps/server/src/entry.vercel.ts` has no purge step. This matches the production
guard, but a non-production Vercel deployment never purges its sinks. The sinks
are written only when items 1 or 6 are misconfigured.

Verify once on the production database:

```sql
select count(*) from dev_emails;
select count(*) from dev_magic_links;
```

Both results must be zero.

### 14. Demo credentials

**STATUS:** owner-action

The seed creates `creator@together.dev` and `creator2@together.dev` with
`demo1234` (`adapters/db/seed.ts:73`, `adapters/db/seed.ts:102`,
`CLAUDE.md`). Seeding is manual. `vercel-build` runs only migration and build
steps (`package.json:22`), so deployment does not call `db:seed` or `db:reseed`.

Never point `db:seed` or `db:reseed` at the production `DATABASE_URL`. Verify:

```sql
select email
from "user"
where email like '%@together.dev';
```

The query must return no rows (`adapters/db/auth-schema.ts:11`).

### 15. Provider-side subscription cancel on member removal

**STATUS:** done

Member removal now cancels Stripe subscriptions before pseudonymization in
[`core/server/usecases/members.ts`](../core/server/usecases/members.ts). The
Stripe adapter performs immediate provider cancellation and treats missing or
already canceled subscriptions as settled
([`adapters/payment/stripe.ts`](../adapters/payment/stripe.ts)). The retention
and retry behavior is documented in
[`docs/member-erasure.md`](member-erasure.md).

Cancellation failures do not block erasure. The response includes
`subscriptionCancellations`, the server logs failures with the
`[member-removal]` prefix, and the staff panel names provider subscription IDs
that returned `failed`. These records are not durable by themselves: the server
uses `process.stderr.write` for a short-retention runtime log, the response is
seen once, and the panel warning is transient component state overwritten by
the next successful removal (`apps/server/src/composition.ts:472`,
`apps/web/src/features/home/members/MembersPanel.tsx:56-76`). Before launch,
configure a log drain and alert for `[member-removal]`, and capture failures from
the response array or panel warning when they occur.

The `already_canceled` outcome is also an operational risk. The Stripe adapter
maps `resource_missing` and every 404 to that outcome, although either can mean
a stale subscription ID or credentials for the wrong Stripe account, and the
staff panel warns only for `failed`
(`adapters/payment/stripe.ts:26-33`,
`apps/web/src/features/home/members/MembersPanel.tsx:69-76`). Surface
`already_canceled` provider IDs in the staff panel too and check them directly
in the intended Stripe account.

Re-running the same removal is the retry. The flow ignores local subscription
status, so tombstoned members and locally canceled rows are retried. The
cancel-before-pseudonymize path is unreachable through `pnpm run smoke`: smoke
uses the fake adapter and never removes the created member
(`adapters/payment/fake.ts:48`, `scripts/smoke.ts:480-545`). Item 11g is the
only execution of this path before launch and must not be skipped.

Run this periodic safety-net query:

```sql
select s.id, s.provider_subscription_id, s.member_id
from member_subscriptions s
join members m on m.id = s.member_id and m.tenant_id = s.tenant_id
where m.deleted_at is not null
  and s.provider = 'stripe'
  and s.provider_subscription_id is not null;
```

The query has no provider-cancellation completion discriminator and grows with
every erased member, because local erasure marks every subscription canceled
regardless of the provider result. It is not a worklist. Use the response array,
panel warning, and `[member-removal]` alert as the primary failure signals; use
this SQL periodically to catch missed signals. For every row, check whether the
subscription is still active in Stripe. If it is, re-run member removal. This
reconcile pass must complete before the next billing cycle.

If provider cancellation fails and a late `invoice.paid` arrives:

- the erased member continues to be charged;
- the webhook flips the local subscription from `canceled` back to `active`,
  undoing the erasure transaction's local cancel;
- it creates or renews the product grant for the tombstoned member; and
- it appends a new paid order after the erasure date with the retained company
  name, address, postal code, city, and NIP copied from the previous order.

The webhook finds the unchanged `provider_subscription_id`, sources billing
from `previousOrder?.billing`, and calls `renewSubscriptionPeriod`
(`core/server/usecases/stripe-webhook.ts:399-442`,
`core/server/usecases/subscription-lifecycle.ts:140-196`,
`core/domain/commerce.ts:83-95`). The member row remains tombstoned and its auth
user remains severed, so nobody can log in with the restored grant. Because the
grant is restored, `listPaidOrdersWithoutGrant` remains empty and does not
surface the incident.

Durable retry scheduling, cancel-at-period-end or refund policy, Stripe customer
deletion, and self-service member deletion are outside this change. Production
guards for payment, e-mail, and secure-cookie defaults remain the owner actions
in items 5 through 7. Other audited backlog items remain in
[`tasks/audit-convergence-r4.md`](../../tasks/audit-convergence-r4.md) and are
not added to this launch checklist.
