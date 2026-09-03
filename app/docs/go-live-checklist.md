# Go-live checklist

This checklist is for the owner performing the production launch. Complete every
owner action and pre-launch verification against the production configuration or
the named staging environment.

### 1. Magic-link exposure

**STATUS:** done

Magic-link exposure fails closed at boot. `AUTH_DEV_EXPOSE_MAGIC_LINKS` defaults
to `false` (`apps/server/src/env.ts:93-96`), and every environment except local
development rejects `true` (`apps/server/src/env.ts:165-180`). Local development
means `NODE_ENV` other than `production` with `APP_ENV` unset or `development`
(`apps/server/src/env.ts:38-43`), so staging and preview refuse to boot with the
flag on. In local development the auth adapter writes links to `dev_magic_links`
(`adapters/auth/create-auth.ts:467-475`) and the sign-in response exposes them
(`apps/server/src/internal-app.ts:882`).

Verify the deployed environment has `AUTH_DEV_EXPOSE_MAGIC_LINKS` unset or set
to `false`.

### 2. Dev and simulation endpoints

**STATUS:** done

Simulation endpoints fail closed at boot and are mounted only in local
development. `SIMULATED_PAYMENTS` defaults to `false`
(`apps/server/src/env.ts:89-92`) and is rejected outside local development
(`apps/server/src/env.ts:165-180`); `selectDevEndpoints`
(`apps/server/src/composition.ts:458-466`) additionally forces both dev flags off
whenever the process is not a local development one, so no `/api/dev/*` route is
registered on production, staging or preview. The resulting flag gates the
complete `/api/dev/*` block, including purchase, grant, magic-link, e-mail, and
subscription-cycle simulation endpoints
(`apps/server/src/internal-app.ts:686-932`).

Verify the deployed environment has `SIMULATED_PAYMENTS` unset or set to
`false`.

### 3. Tenant self-signup

**STATUS:** done

`TENANT_CREATION=open` is interpreted as `bootstrap` in production
(`apps/server/src/composition.ts:371-376`). In bootstrap mode, the tenant
creation use-case allows the first workspace only while the tenant store is
empty and rejects later attempts (`core/server/usecases/create-tenant.ts:36-42`).
The repository also makes the first-workspace write atomic, so concurrent
requests cannot create a second workspace.

For a new installation, verify the first workspace can be created exactly once,
then set `TENANT_CREATION=closed` for steady state. For an installation that is
provisioned before launch, set it to `closed` before the first production boot.

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

**STATUS:** enforced-by-env-schema

Production boot rejects every `PAYMENT_PROVIDER` value except `stripe`. The
fake adapter remains available outside production for local and staging use.

**OWNER ACTION:** Set `PAYMENT_PROVIDER=stripe` for the Production environment
in the Vercel project settings.

Open **Integrations → Stripe** and save an `rk_test_…` or `rk_live_…` restricted
key with write access to Checkout Sessions, Coupons, Promotion Codes,
Subscriptions, and Webhook Endpoints. Alternatively, configure a headless
deployment with the CLI. Together registers the webhook, stores its signing
secret, and derives the mode from the stored key prefix. Then run:

```sh
pnpm --silent run cli --tenant <slug> stripe configure rk_test_…
pnpm --silent run cli --tenant <slug> stripe test-connection
```

Complete item 11 before accepting payments.

### 6. Production e-mail provider

**STATUS:** enforced-by-env-schema

Production boot rejects the default `EMAIL_PROVIDER=dev` and requires `ses` or
`smtp`. The selected real provider also requires `EMAIL_FROM`.

**OWNER ACTION:** Set `EMAIL_PROVIDER=ses` or `EMAIL_PROVIDER=smtp` and set
`EMAIL_FROM` for the Production environment in the Vercel project settings.

Send a transactional test message from the production deployment.

Queued messages leave the outbox only when something drains it. A Node
deployment drains it in-process every `EMAIL_DISPATCH_INTERVAL_MS`
(`apps/server/src/entry.node.ts`); on Vercel the drain is the every-minute cron
for `GET /api/internal/dispatch-email` declared in `vercel.json`, authenticated
with `Authorization: Bearer $CRON_SECRET`. Confirm the job appears under Cron
Jobs and that a test message reaches the inbox rather than staying queued.

### 7. Secure cookies

**STATUS:** enforced-by-env-schema

Production boot rejects the default `SECURE_COOKIES=false` and requires `true`.

**OWNER ACTION:** Set `SECURE_COOKIES=true` for the Production environment in
the Vercel project settings.

Sign in on the production origin, open the browser developer tools, and confirm
the session cookie has `Secure`, `HttpOnly`, and `SameSite=Lax`.

### 8. Secrets rotation, including the legacy AWS key

**STATUS:** owner-action

The legacy platform's read-capable AWS key was stored in the development
database for `akademia-samouka` as `s3.accessKeyId` and `s3.secretAccessKey`
(recorded in the import-rehearsal audit, kept in the owner's private archive).
The SigV4 presigner consumes those
secrets through `core/server/usecases/lesson-media.ts` and
`adapters/storage/s3.ts`.

Create a fresh IAM user for the media bucket and store it on the production
tenant through the storage flow, which probes the connection before saving:

```sh
pnpm --silent run cli --tenant <slug> storage configure --provider aws_s3 \
  --endpoint https://s3.<region>.amazonaws.com --region <region> \
  --bucket <bucket> --access-key-id '<id>' --secret-access-key '<secret>'
```

The generic `tenant-secret set` command rejects every `s3.*` key, so storage
credentials always pass the probe first — the key needs write, read and delete
on one scratch object, not only `s3:GetObject`. Endpoint, region, bucket and
both keys end up in the single encrypted `s3.configuration` secret, which also
backs imported lesson media playback when the legacy pair is absent.

Deactivate and then delete the legacy key in IAM. Delete the development copy
with:

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

**STATUS:** done; edge control remains owner-action

The only request limiter is Better Auth's built-in limiter. Custom rules allow
20 requests per 60 seconds for `/sign-in/magic-link`,
`/request-password-reset`, `/magic-link/verify`, and `/sign-in/email`
(`adapters/auth/create-auth.ts`). Its windows use database storage, backed by
`rate_limit`, so restarts and concurrent serverless instances share buckets.
The auth edge discards client-supplied forwarding input. Set
`AUTH_TRUSTED_PROXY_HEADER=direct` when Node receives traffic directly; the
socket peer is then authoritative. The shipped Caddy configuration overwrites
`X-Forwarded-For`, so its sanctioned value is `x-forwarded-for`. Other
production reverse proxies must overwrite the selected header. Vercel
deployments use the platform-written `x-vercel-forwarded-for` header.

Unauthenticated write routes carry a second application limiter: fixed windows
in `rate_limit_buckets`, keyed by scope and subject and claimed with one upsert
per request (`core/server/usecases/public-rate-limit.ts`,
`apps/server/src/public-rate-limit.ts`). Checkout session creation, coupon
validation and the marketing consent forms allow 30 requests per minute per
client address and 300 per minute per resolved tenant; magic-link,
password-reset, sign-up and verification requests share that per-address budget
and allow 5 per ten minutes per e-mail address. The sign-in method lookup
(`/api/public/auth-resolve`) spends its own `auth-resolve:ip` and
`auth-resolve:tenant` windows — 20 per minute per client address and 200 per
minute per resolved tenant — so a shared address exhausting the lookup cannot
block checkout. The five limits are configurable
(`PUBLIC_RATE_LIMIT_WRITES_PER_IP_PER_MINUTE`,
`PUBLIC_RATE_LIMIT_WRITES_PER_TENANT_PER_MINUTE`,
`PUBLIC_RATE_LIMIT_AUTH_LINKS_PER_EMAIL_PER_10_MINUTES`,
`PUBLIC_RATE_LIMIT_AUTH_RESOLVES_PER_IP_PER_MINUTE`,
`PUBLIC_RATE_LIMIT_AUTH_RESOLVES_PER_TENANT_PER_MINUTE`), relax outside
production so the end-to-end suites are unaffected, and switch off per bucket
at `0`. Rejections answer `429` with `Retry-After`, and the hourly KSeF
dispatch run deletes expired windows.

`marketing_throttle_buckets` remains a per-tenant SES sending budget rather
than a request limiter (`adapters/db/app-schema.ts:1387`).

Before launch, add an edge or WAF rule in front of `/api/auth/*` and
`POST /api/public/auth-resolve`. The durable application limiter is defense in
depth and does not replace the launch edge control.

### 11. Real Stripe verification runbook

**STATUS:** pre-launch-verify

Only `PAYMENT_PROVIDER=fake` has been exercised end to end. Run this procedure
against a Stripe test-mode account on staging with `PAYMENT_PROVIDER=stripe`.
Repeat the signature and refund checks once in live mode with a 1 PLN product.

Save the restricted key through **Integrations → Stripe** or `stripe configure`.
Confirm that the panel shows the expected test/live badge and that Stripe
contains the generated tenant endpoint. Together enables exactly
`checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`charge.refunded`, and `charge.dispute.created`
(`core/server/usecases/stripe-webhook.ts`).

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

f. Cancel the subscription at period end in Stripe. Confirm the grant expiry
drops to the reported `current_period_end` with no retry grace, and that
`customer.subscription.deleted` then makes the local row `canceled` while
keeping that expiry. Cancel another subscription immediately and confirm the
grant expiry drops to Stripe's reported `ended_at` rather than the later
`current_period_end` (`core/server/usecases/subscription-lifecycle.ts`,
`syncGrantToSubscription`).

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
implementation is in `adapters/crypto/bunny-token-signer.ts`.

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
`demo-password-15` (`adapters/db/seed.ts:62`; applied on creation at
`adapters/db/seed.ts:127` and converged for existing local fixtures at
`adapters/db/seed.ts:129`; `CLAUDE.md`). Seeding is manual. `vercel-build` runs
only migration and build steps (`package.json:24`), so deployment does not call
`db:seed` or `db:reseed`.

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
in items 5 through 7. Other audited backlog items remain in the
post-convergence backlog (owner's private archive) and are not added to this
launch checklist.

### 16. Production branch and approval wall

**STATUS:** owner-action

The release topology targets an owner-approved `staging` to `main` pull
request, but repository files do not prove that wall is live. `main` is the
default and production branch; `staging` is the integration trunk where feature
pull requests merge. Later on 2026-08-04, this model was
switched to the platform's
default convention precisely because the previous inverted model (`main` as
staging and `production` as production) fought the hosting and database
integrations, which assume the default branch is production.

The earlier 2026-08-04 warning remains relevant history: the remote then had no
`production` branch and no ruleset, so the former target wall was not live.
GitHub enforces rulesets and branch protection on public repositories on the
Free plan, but the requirement remains procedural until the owner configures
the new wall; an agent must not be described as technically unable to approve
or release its own work.

Before launch, create `staging` from the owner-approved `main` commit. Protect
`staging` so ordinary work merges through reviewed pull requests, and protect
`main` so production changes require a pull request from `staging`, independent
owner approval, and the required CI checks. `.github/workflows/ci.yml` triggers
on both `staging` and `main`, so feature and promotion pull requests produce the
required statuses. Disallow direct pushes, force pushes, deletion, and
unreviewed bypasses. The legacy `production` branch is not a deployment or
promotion target. Inspect the live rules through the GitHub UI or API and
record them, the approving owner, promotion pull request, `staging` SHA, and
resulting `main` SHA in the launch record.

Until those steps are complete, do not claim an enforced production-promotion
wall. Any rehearsal remains subject to the documented owner-approval procedure
and does not satisfy the SIL-3-shaped launch requirement by itself. The target
topology and the distinction between decision and live state are recorded in
[ADR-0003](decisions/0003-vercel-environments.md).

### 17. Production hosting account boundary

**STATUS:** owner-action

Create and link production under a paid commercial hosting team or account
whose membership is reviewed by the owner. Verify that no agent has a hosting
login, CLI session, deployment token, database credential, or production
secret. Preview and staging must not reuse the production hosting, database, or
credential boundary.

After item 16 creates `staging`, set Vercel Production Branch Tracking to
`main` and verify that a `staging` merge creates staging only. Staging is the
`staging`-branch Preview deployment: it must carry `APP_ENV=staging` scoped
to Preview with branch `staging`, and its database URL must come exclusively
from the database integration, which automatically creates and manages its
dedicated branch per git branch. A fourth verified trap is member-role mapping
on the hosting team: when a git identity that pushes or merges (including a machine account
merging pull requests) maps to a hosting-team member whose role cannot create
deployments (a read-only viewer seat), the platform silently drops every
deployment that identity triggers — no record, no error. An UNMAPPED git
identity deploys fine, so adding a viewer seat for an active git account is
strictly worse than no seat. Keep deploy-triggering git identities either
unmapped or mapped to a role that may create deployments, and re-test a push
after any team-membership change. A third verified trap sits on the GitHub
side: when the
hosting provider's GitHub App requests updated permissions, the pending
request can silently stop ALL deployment creation for the installation —
pushes produce no deployment records and deploy-hook jobs die without a
trace, while billing and the project's git connection look healthy. Check
the organization's installed GitHub Apps for a "Permission updates
requested" badge before any deeper debugging, and re-approve deliberately
(restrict the app to the repositories that need it). Two verified database
traps: the integration only participates in
push-triggered deployments, so a manual redeploy silently falls back to
whatever static database variable is in scope, and a static Preview-scoped
database URL therefore must not exist at all — remove the Preview scope from
the integration's static entry so a missing injection fails loudly instead of
writing to the production database. Review the
live hosting-team membership, Git integration, environment scopes, and
production branch setting; repository files cannot prove any of them. Record
the owner who performed the review and the target project and team in the
launch record.

### 18. Manual deployed-SHA attestation

**STATUS:** pre-launch-verify

`smoke:remote` is a manual command, no workflow invokes it, and its SHA
comparison is silently skipped when `EXPECTED_SHA` is absent. For launch,
`EXPECTED_SHA` is mandatory. Fetch the promoted branch, resolve its exact head,
and run the command against the deployed production URL:

```sh
git fetch origin main
BASE_URL=https://deployment.example \
SMOKE_TENANT=acme \
EXPECTED_SHA="$(git rev-parse origin/main)" \
pnpm run smoke:remote
```

Do not accept the deployment if the command fails, if `EXPECTED_SHA` was
omitted, or if the health attestation reports another commit. Retain the
command result together with the deployment URL, expected SHA, actual health
SHA, and approving owner. Repeat the same mandatory-SHA check on staging before
promotion and on production after promotion. This owner sign-off is a manual
post-deployment attestation, not an automated CI or hosting gate.

### 19. Realtime listener connection

**STATUS:** pre-launch-verify

`REALTIME_TRANSPORT` defaults to `pg`, so the realtime bus holds a dedicated
`LISTEN` connection resolved from `REALTIME_DATABASE_URL`, then
`DATABASE_URL_UNPOOLED`, then `DATABASE_URL`
(`apps/server/src/realtime-transport.ts`). Transaction-mode poolers accept
`LISTEN` and never deliver a notification, so a pooled URL degrades in-app
notifications and direct messages to the 25 s stream rotation without any error.

Confirm which URL the managed database integration injects into each deployed
environment. If `DATABASE_URL` points at a pooler, set `REALTIME_DATABASE_URL`
or `DATABASE_URL_UNPOOLED` to the direct connection for staging and production.
The listener logs `[realtime] listener connection targets a pooled host` at boot
when the hostname contains `pooler` or the port is 6543 or 6432; check the
deployment log after the first request. That heuristic cannot see every pooler
(RDS Proxy and PgBouncer on 5432 look like a direct host), so confirm the URL
against the provider console rather than relying on the absence of the warning.

Each warm instance holds one direct connection, which counts against the
database `max_connections` budget. Verify that the compute size can carry the
expected number of concurrent streams.
