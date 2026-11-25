# Observability

Production is watched by three independent layers. Each one answers a different
question and none of them depends on the other two.

| Layer | Surface | Question |
| --- | --- | --- |
| Liveness and readiness | `/api/health/live`, `/api/health/ready`, `/api/health` | Does the process answer and is its schema current? |
| Deep health | `/api/health/deep` | Does every tenant still parse, load and sign? |
| Post-deploy smoke | `.github/workflows/prod-smoke.yml` | Can a real member sign in and play a lesson on the deployed commit? |

## Alerting doctrine

An SMS wakes a person up. A monitor that pages for something the owner cannot
act on — a check that has never worked here, a failure already known and being
worked on — teaches the owner to ignore the channel, and the next real outage
arrives on a phone nobody reads. So paging is governed by one rule set, applied
identically by `prod-health.yml`, `prod-smoke.yml` and `staging-smoke.yml`:

1. **Observe-only until green.** Every monitor that can page starts silent on an
   environment it has never been green on. It writes its verdict to the job
   summary and to a `::notice::`, fails the run when it should, and sends no SMS.
   The first green run on that environment arms it.
2. **Page on a state change only.** A page needs the previous completed run of
   the same workflow to have been green, or the failing set to have changed since
   the last red one.
3. **Never twice in a row for the same failing set.** A monitor that keeps
   failing the same way stays quiet after the first page; the run still goes red,
   which is what a dashboard is for.
4. **Recovery is announced.** The first green run after a page sends a `RECOVERED`
   SMS, so an incident always has a closing message on the same channel.
5. **A new check inherits observe-only.** A check added to an armed monitor is
   silent until it has been green on that environment once. Adding a probe can
   therefore never page the owner about the probe itself.

The one exception is a failure outside the monitor's own check inventory — the
run could not measure its checks at all (`unreachable`). It pages as soon as the
monitor is armed, because "never green" cannot be distinguished from "never ran"
and silence would be the wrong default for a monitor that stopped working.

### How it is implemented

`.github/actions/alert-gate` is the single place that decides. Each monitor hands
it the failing set and the full inventory of checks the run measured; the action
reads the workflow's previous completed run through the Actions API, restores the
state the previous run recorded, and outputs `should_page`, `recovered`,
`observe_only`, `pageable` and `reason`. The SMS steps are gated on those outputs
and on nothing else.

State travels between runs as one workflow artifact per monitor and environment,
`alert-gate-<workflow>-<environment>`, holding whether the monitor has ever been
green, whether a page is still outstanding, the failing set that was last paged
for, and the names cleared to page (every check that has been green here at least
once). The artifact is overwritten on every run and kept for the repository's
artifact retention; if it expires or is deleted, the monitor falls back to
observe-only until its next green run, which is the safe direction.

Only a run that reached the gate records state, so a run that was skipped or died
before its checks leaves the recorded failing set untouched — an intervening
skipped run cannot turn a still-unchanged failure back into a page.

The decision itself is `app/scripts/alert-gate.ts` — a pure function with no
dependencies, run by the composite action under Node's own type stripping and
unit-tested in `app/scripts/alert-gate.test.ts`. The workflow wiring is asserted
in `app/config-regression/alert-gate-action.test.ts`, which fails when any SMS
step in the three monitors is conditioned on anything other than the gate.

Because the state starts empty, the first run of each monitor after this doctrine
landed is observe-only, and the monitor arms itself on its next green run.

## Database connection faults

- `[database-pool] Idle client removed: … total=… idle=… waiting=…` means
  the query pool discarded a broken idle connection. The counters describe the
  remaining total connections, idle connections and callers waiting for a client.
- `[trusted-origins] Using cached origins after domain lookup failed: … cold=…`
  is logged once per outage with a sanitized error chain. `cold=true` means no
  domain lookup has succeeded and only configured origins are trusted;
  `cold=false` means the last successfully loaded custom origins remain trusted.
- `[trusted-origins] Domain lookup recovered after N failures` means a refresh
  succeeded after the reported number of failed lookups. It replaces the cached
  custom origins and starts the normal 60-second freshness window.

The incident signature is an auth 403 `INVALID_CALLBACK_URL` on a custom domain
next to a trusted-origins failure line in the same minute. Failed lookups impose
a one-second backoff instead of renewing the 60-second success cache. Once the
database answers again, custom-domain sign-in recovers on the next request after
the backoff, with at most one second of backoff remaining; no background retry
runs. A link rejected by origin validation remains usable after recovery.
Unknown origins remain rejected. These diagnostics do not change alerts;
owner-side monitors follow the observe-only doctrine above.

## `GET /api/health` instance description

Besides the attestation fields (`version`, `sha`, `commit`, `environment`,
`production`, `databaseFingerprint`, the migration and schema fields), the
unauthenticated health answer carries one `instance` object that lets a client
tell instances of the same release apart:

- `baseDomain`: the configured `APP_BASE_DOMAIN`, or `null` on a single-tenant
  instance, which runs without it.
- `singleTenant`: `true` when the instance runs without `APP_BASE_DOMAIN`.
- `databaseIdentity`: the first 16 hex characters of a SHA-256 hash of the
  database host, port and database name that the PostgreSQL driver resolves
  for the application's own pool: the same SSL-mode-normalised `DATABASE_URL`,
  passed as the pool's `connectionString`, so the `host` and `port` query
  parameters override the URL authority and a nested `connectionString`
  parameter is ignored. The port follows the driver: a URL that names none
  takes `PGPORT`, then 5432. The database name is hashed as the driver decodes
  it (`%C3%A9` becomes `é`, `%2F` stays as written). The value is `null` when
  the URL itself names no host or database (a value the driver would take from
  `PGHOST`, `PGDATABASE` or the user name does not count), selects a Unix
  socket, or does not parse. It never contains a credential or the connection
  string, and unlike `databaseFingerprint` it differs for two databases on one
  server.

The object is additive: `databaseFingerprint` keeps its value (a hash of the
database host name only), so monitors that pin it are unaffected. Releases
before this field answer without `instance`. `shop plan`, `shop apply` and
`shop drift` use it to derive and verify workspace hosts
([shop-manifest.md](shop-manifest.md)).

## `GET /api/health/deep`

Unauthenticated, rate-limited to 12 requests per minute per address
(`deep-health:ip` bucket, `deepHealthPerIp` policy in
`apps/server/src/public-rate-limit.ts`, overridable with
`PUBLIC_RATE_LIMIT_DEEP_HEALTH_PER_IP_PER_MINUTE`), and cached in process for
60 seconds. The endpoint reads production data but returns none of it:

- Check names are fixed and tenants are never named.
- Only a message a probe wrote itself is returned, truncated to 200 characters.
  Any other cause — a driver error, which would carry the failed SQL and the
  values bound to it — is reported as `unexpected <ErrorType>`.
- No count reaches the caller: how many tenants exist, and how many of them have
  storage, stored secrets or a dedicated transport, stay server-side.
- Nothing derived from a decrypted secret ever reaches the response.

The whole report is bounded by a 20-second budget (`DEEP_HEALTH_BUDGET_MS`),
comfortably inside the 60-second function limit in `vercel.json`. A probe that
outlives the remaining budget is abandoned and the report gains a failing
`deadline` check naming every probe that did not finish, so a hanging
dependency pages with a name instead of a 504.

- **200** — every check is green.
- **500** — at least one check failed; `data.failing` lists their names.
- **429** — the address exhausted its bucket.

The envelope is the standard one: `{ "ok": true, "data": … }` in both the 200
and the 500 case, because the envelope reports whether a report could be
produced while the HTTP status reports whether production is healthy.

```json
{
  "ok": true,
  "data": {
    "ok": false,
    "checkedAt": "2026-09-05T09:12:00.000Z",
    "failing": ["tenant-settings"],
    "warnings": [],
    "storageCors": "not-applicable",
    "checks": [
      { "name": "tenant-directory", "ok": true, "ms": 4, "error": null },
      { "name": "scheduler-freshness", "ok": true, "ms": 6, "error": null },
      { "name": "tenant-settings", "ok": false, "ms": 11, "error": "…" },
      { "name": "public-offer", "ok": true, "ms": 38, "error": null },
      { "name": "course-content", "ok": true, "ms": 52, "error": null },
      { "name": "tenant-secret-decryption", "ok": true, "ms": 3, "error": null },
      { "name": "email-transport", "ok": true, "ms": 9, "error": null },
      { "name": "storage-presign", "ok": true, "ms": 2, "error": null },
      { "name": "storage-cors", "ok": true, "ms": 8, "error": null }
    ]
  }
}
```

A per-tenant check aggregates every tenant into one entry: `ok` is false as soon
as one tenant fails it, `ms` is the summed duration and `error` is the first
failure. A tenant with no stored secret, no storage configuration and no
dedicated e-mail transport is skipped by those probes instead of failing them —
the response cannot distinguish "nothing to check" from "checked and fine", and
that is deliberate; the per-check subject counts stay internal (they are
asserted in `core/server/usecases/deep-health.test.ts`, so an inert probe is
caught by the suite rather than by reading production output). The public
`storageCors` field is only an aggregate status: `ok`, `warning`, or
`not-applicable`. Per-tenant CORS results, tenant counts, and origins stay in the
server-side report available to operator-authenticated code paths.

### What each check does

| Check | Scope | What it exercises |
| --- | --- | --- |
| `tenant-directory` | platform | Enumerates every tenant; nothing else can run without it. |
| `scheduler-freshness` | platform | Newest `schedulerRuns` row started less than 2 hours ago. A deployment that has never scheduled anything (fresh database, self-host without cron) has no age to compare and is skipped; only a scheduler that ran and then stopped fails. |
| `tenant-settings` | per tenant | Loads the settings row and parses it through `tenantSettingsSchema` — the same parse the Studio settings response goes through. |
| `public-offer` | per tenant | Builds the public offer (products, prices, preview lessons, branding). |
| `course-content` | per tenant | Loads a course and the first lesson it references: the first publicly visible course through the anonymous structure, or — when every course is members-only — the first course through its modules. |
| `tenant-secret-decryption` | per tenant | Decrypts every stored secret with the master key. The operator report names keys with decryption failures or empty values; the public report exposes only a generic failure. Secret values are never returned or logged. |
| `email-transport` | per tenant | Resolves the transactional transport (tenant SES → SMTP → Resend). Tenants on the platform pool are skipped. |
| `storage-presign` | per tenant | Signs a GET URL for the configured bucket. No request is sent to the bucket. |
| `storage-cors` | per tenant | Sends a presigned `PUT` preflight for the platform origin and every verified custom domain. Database-backed results and rate limits are shared for ten minutes; blocked, unknown, and budget-limited origins add a warning without failing deep health. The public response exposes only the aggregate `storageCors` status, never origins or per-tenant entries. |
| `deadline` | platform | Present only when the 20-second budget ran out; names the probes that did not finish. |

`prod-health.yml` probes `/api/health` first and `/api/health/deep` second; the
scheduled run fails when the deep probe answers anything other than 200, and
reports `health` or `deep-health` as its failing check to the alert gate, which
decides whether that failure pages.

## Post-deploy remote smoke

`.github/workflows/prod-smoke.yml` runs on a `deployment_status` event with
state `success` and environment `Production`, and on `workflow_dispatch`. Both
the wait and the checks target `$PROD_BASE_URL` — every tenant host serves
`/api/health`, so the commit attestation holds on the tenant's own host and the
smoke never signs a member of one tenant in on another's. It waits until that
host reports the deployment's commit (up to five minutes), reseeds the smoke
tenant, then runs `pnpm run smoke:remote` (`app/scripts/remote-smoke.ts`) with
`EXPECTED_SHA` set to that commit.

A manual dispatch may point `base_url` at any host; left empty it smokes
`PROD_BASE_URL`. It may also leave `expected_sha` empty, and the wait and the
`health-attestation` match are then both skipped, so any commit the host serves
is accepted.

The wait comes first so the reseed always reaches the build under test — on the
deployment the alias would otherwise still be answering from the previous one,
which need not know the reseed route at all.

Checks, in order:

1. `health-attestation` — `sha` matches `EXPECTED_SHA`, database up, schema current.
2. `health-deep` — `/api/health/deep` answers 200 with `ok: true`.
3. `public-offer` — the anonymous offer for the tenant; on the smoke tenant it must list at least one published product.
4. `public-page` — the tenant storefront returns HTML.
5. `member-sign-in` — password sign-in of the synthetic member.
6. `member-identity` — `/api/me` reports a membership on the tenant.
7. `student-courses` — the member's course list; on the smoke tenant the seeded `Acme Course` must appear, and its structure must expose an accessible lesson.
8. `lesson-playback` — the accessible lesson loads with HTTP 200 and a valid student lesson envelope, and resolves a playback URL that is not `unavailable`; on the smoke tenant the seeded lesson carries a Bunny Stream video, so a `bunny` playback URL must resolve.
9. `studio-tenant-settings` — **skipped**. Tenant API key scopes cover marketing, transactional, enrollment, import, report, `subscriptions:read`, and `subscriptions:adopt` capabilities only; none of them grants `tenant:settings:read`. Shop management keys are a separate credential class: they live in their own table (`shop_management_keys`), pass their own authenticator (`core/server/usecases/shop-machine-auth.ts`) and are accepted only on the routes under `/api/m2m/shop`. Their scopes map to capabilities in `capabilitiesByShopManagementScope` (`core/domain/shop-management-key.ts`), intersected with the capabilities of the issuing owner: `shop:catalog:read` grants `product:read` and `product:price:read`; `shop:catalog:write` grants `product:write`, `product:price:write` and `product:publish`; `shop:orders:read` grants `order:read` and `order:export`; `shop:fulfilment:write` grants `order:write`; `shop:settings:read` grants `tenant:settings:read`; `shop:settings:write` grants `tenant:settings:write`; `shop:integrations:read` grants `tenant:secret:read`; `shop:integrations:write` grants `tenant:secret:write`, held only for the integration operations on the allow-list in the same file. A shop management key with `shop:settings:read` therefore holds `tenant:settings:read`, but only on `/api/m2m/shop` routes; the Studio settings read (`GET /api/tenant/settings`) is a session route that no key authenticates, so this check still cannot be driven by a key from a workflow. No `SMOKE_STUDIO_API_KEY` secret is needed today. Re-enable this check by adding a read scope to `capabilitiesByScope` in `core/domain/api-key.ts` first.

### Member checks without credentials

Checks 5–8 need the synthetic member. When **both** `SMOKE_MEMBER_EMAIL` and
`SMOKE_MEMBER_PASSWORD` are absent the smoke reports all four as `skipped` with
the reason `SMOKE_MEMBER_EMAIL and SMOKE_MEMBER_PASSWORD are not configured`,
prints `smoke:remote: NOTICE member checks skipped — set SMOKE_MEMBER_EMAIL and
SMOKE_MEMBER_PASSWORD`, and exits 0. The public surface is still smoked, the run
stays green and no SMS is sent.

When only **one** of the two is set the smoke fails `member-sign-in` with the
name of the missing variable: a half-configured secret pair is a
misconfiguration, not a deliberate opt-out, and it pages like any other failure.

Every run appends its check list — statuses and skip reasons — to the job
summary, so a green run still shows what was not exercised.

On failure the workflow asks `.github/actions/alert-gate` whether the failure may
page and, when it may, sends one SMS through the shared
`.github/actions/alert-sms` composite action — the same SNS credentials
`prod-health.yml` uses — carrying only the check names cleared to page. Skipped
checks never trigger an SMS. Credentials are never printed: the script reports
check names and messages, never request bodies or headers.

The reseed step is `continue-on-error`, so a refused or unreachable reseed still
lets the checks run. One step then assembles the whole failing list — `reseed`
first, then the alias and check names — and the summary, the SMS and the run
failure all quote it, so `failing=reseed,public-offer` names both the checks
that broke and the reseed that probably broke them. A broken reseed must never
cost the deployment its smoke and its alert.

### Repository secrets the owner must add

Settings → Secrets and variables → Actions → repository secrets:

| Secret | Used by | Purpose |
| --- | --- | --- |
| `ALERT_AWS_ACCESS_KEY_ID` | prod-health, prod-smoke | IAM user allowed to `sns:Publish` only. |
| `ALERT_AWS_SECRET_ACCESS_KEY` | prod-health, prod-smoke | Its secret key. |
| `ALERT_SMS_PHONE` | prod-health, prod-smoke | On-call number in E.164 form. |
| `SMOKE_MEMBER_EMAIL` | prod-smoke | Optional override; defaults to `kontakt+smoke-member@togethercommunity.app`. Absent (with no default) → member checks skipped. |
| `SMOKE_MEMBER_PASSWORD` | prod-smoke | Password the smoke member is seeded with **and** signed in with. Must equal the deployment's `SMOKE_MEMBER_PASSWORD` environment variable. Set exactly one of the pair and the smoke fails. |
| `OPERATOR_SECRET_PRODUCTION` | prod-smoke | Operator secret for `POST /api/internal/reseed-acme`; must equal the production deployment's `OPERATOR_SECRET`. Falls back to the deprecated `PROD_OPERATOR_SECRET` repository secret. Absent → the reseed step prints a notice and is skipped. Sent only to the tenant host, so a dispatch against another host skips the reseed instead of leaking the secret to it. |

The creator account never signs in from the workflow, so its password lives on
the deployment only, as `SMOKE_CREATOR_PASSWORD`.

The first three already exist for `prod-health.yml`; the smoke reuses them.

### Repository variables the owner must add

Settings → Secrets and variables → Actions → repository variables. No host is
hard-coded in a workflow: every one of these falls back to the `acme` fixture on
`togethercommunity.app`, so an unset variable makes the workflow watch the
synthetic demo tenant instead of the deployment that matters.

| Variable | Used by | Fallback when unset |
| --- | --- | --- |
| `SMOKE_TENANT` | prod-health, prod-smoke | `acme` — the tenant slug the production smoke variables build their default host from. |
| `PROD_HEALTH_HOST` | prod-health | `<SMOKE_TENANT>.togethercommunity.app` — the host `/api/health` and `/api/health/deep` are probed on. |
| `PROD_BASE_URL` | prod-smoke | `https://<SMOKE_TENANT>.togethercommunity.app` — the deployment smoked on `deployment` events and on a dispatch that leaves `base_url` empty. |
| `STAGING_HOST` | staging-links | `acme.staging.togethercommunity.app` — the seeded tenant host published as the deployment's environment URL and pinned on the promotion pull request. |
| `VERCEL_DEPLOYMENTS_URL` | staging-links | `https://vercel.com/dashboard` — the deployments list linked from the same places. |

Pointing `SMOKE_TENANT` at another tenant also skips the reseed with a notice:
the route rebuilds `tenant-acme` only, and wiping it would serve no run that
checks something else.

## Staging smoke

`.github/workflows/staging-smoke.yml` answers the question production's smoke
cannot: *is staging still its own deployment?* It runs on every `push` to
`staging`, on a daily `schedule`, and on `workflow_dispatch` with `base_url` and
`expected_sha` inputs. The push is the primary trigger because it is the one
event this repository emits itself: the platform's own deployment records name
the environment and the commit however it currently labels them, so a smoke
gated on them stops running the moment that labelling changes. It runs
`pnpm run smoke:staging` (`app/scripts/remote-smoke.ts --staging`) against
`https://` + the `STAGING_HOST` variable (default
`acme.staging.togethercommunity.app`) and always sends requests as the seeded
`acme` tenant.

A push arrives before the deployment it will produce, so the job first waits for
the host to serve the pushed commit: it polls `/api/health` with the bypass
header every 20 seconds for up to 15 minutes until `data.sha` equals the
expected commit. A host still serving the previous commit is a build in flight,
not a regression, so those attempts only wait. When the 15 minutes pass without
a match the job fails on `deployment-alias` with the commit it observed instead
and sends no SMS — nothing about staging's health was measured. A dispatch with
an empty `expected_sha`, and the scheduled run, smoke whatever the host serves.

Checks, in order:

1. `health-attestation` — `/api/health` answers a parseable attestation.
2. `staging-environment` — the database is `up`, `environment` is `staging`, `production` is `false`, the schema is current.
3. `database-fingerprint` — `databaseFingerprint` differs from `PRODUCTION_DATABASE_FINGERPRINT` **and** equals `STAGING_DATABASE_FINGERPRINT`.
4. `health-deep` — `/api/health/deep` answers 200 with `ok: true`.
5. `public-offer` — the seeded tenant offer lists at least one published product.
6. `public-page` — the seeded tenant storefront returns HTML.
7. `member-sign-in` — password sign-in of the seeded smoke member.
8. `member-identity` — `/api/me` reports a membership on the seeded tenant.
9. `student-courses` — the seeded smoke member sees `Acme Course` and has an accessible lesson.
10. `lesson-playback` — the seeded lesson loads with HTTP 200 and a valid student lesson envelope, and resolves a playable Bunny Stream URL.
11. `studio-tenant-settings` — skipped for the same API-key scope reason as production smoke.
12. `auth-mail-serverless` — requests a magic link for the seeded member and waits up to 90 seconds for its redacted platform send-log row to settle as `sent`. Skipped, not failed, when the workflow carries no operator secret.

The evidence behind check 12 comes from `GET /api/internal/auth-send-log/latest`,
an operator-secret-gated read that reports the latest send-log row of the
**seeded smoke member** on the requested tenant — the recipient is fixed to that
seed constant, so the route answers for no other address. It returns only
`status`, `kind`, `queuedAt` and `settledAt`: never an address, a subject, a
provider message id or a link. `settledAt` carries the delivery timestamp of a
`sent` row and is null for every other status.

A staging deployment wired to the production database therefore fails within a
deploy instead of within days. The fingerprint is asserted against both ends:
"not production" alone would pass on a third, unknown database, and "equals
staging" alone would pass a variable someone pinned to the production value.

Until `STAGING_DATABASE_FINGERPRINT` is set, `database-fingerprint` fails with
`the staging database is unpinned: set STAGING_DATABASE_FINGERPRINT=<value>`, the
smoke prints `smoke:staging: unpinned=true` when the missing pin is its only
failure, and the workflow turns that into a green run carrying the observed
fingerprint as a `::notice::`, in the job summary and with the steps that pin it.
The owner therefore pins it once from a passing run instead of reading it out of
the database, and an unset variable — a configuration chore, not an incident —
neither pages nor leaves the branch red. Once the variable is set every mismatch
fails and pages. A fingerprint matching production pages either way, pin or no
pin.

### Secrets after a database branch reset

Legacy staging databases were copied from production, so every tenant secret
they carried — SES, S3, Stripe, Bunny, iFirma, KSeF — was encrypted with the
production `SECRETS_MASTER_KEY`. Staging holds a different key, so those rows
decrypt to nothing there: `/api/health/deep` fails `tenant-secret-decryption`,
and `storage-presign` fails with it because the S3 configuration is one of the
unreadable rows. New staging databases are empty databases on the protected Neon
branch: migrations run from `0000` at build time, the deployed seed populates
them, and the build refuses schema-only copies, so there may be no copied secrets
to sanitize.

`POST /api/internal/sanitize-staging-secrets` resolves that. Guarded by the same
`x-scheduler-operator-secret` header the acme reseed uses, it scans every stored
tenant secret, attempts to decrypt each one, deletes the ones that fail, and
records a `sanitize-staging-secrets` platform audit event carrying the counts. It
refuses with `403` when the deployment identity reports production **or** when
`DATABASE_URL` fingerprints as the production database, so the route cannot reach
production data even if someone aims it there.

Once the unreadable rows are gone, `tenant-secret-decryption` and
`storage-presign` report the same "nothing configured here" result they report
for a tenant that never configured an integration: green, with no subject
measured. That is the intended staging steady state — staging then holds only the
secrets an operator entered on staging.

`staging-smoke.yml` calls the route before its checks, using the
`OPERATOR_SECRET_STAGING` repository secret through the deployment-protection
bypass header. Absent secret → the step prints a notice and the smoke runs
against staging as it stands; a failing call does not fail the job, so a sanitize
problem never masquerades as a staging outage. On an empty staging database
populated by the deployed seed, the route is a no-op when no copied secret rows
exist.

To give staging its own working integrations, sign in to Studio on the staging
host and re-enter them there — Studio → Integrations for e-mail, storage,
payments and invoicing. Use staging-only credentials (Stripe test keys, a
separate bucket, an SES sandbox identity); anything entered on staging is
encrypted with staging's key and survives until the next branch reset, which
wipes them again.

### The scheduler check on a non-production deployment

Vercel cron jobs (`app/vercel.json`) fire against the production deployment only,
so no scheduler run ever starts on staging or a preview. `scheduler-freshness`
therefore reports `skipped` with `scheduler runs only on production` on every
non-production deployment instead of ageing out into a failure. The check stays
`ok`, measures no subject, and carries its reason in the report; only production
compares the last run's age against the two-hour ceiling.

Staging sits behind Vercel Deployment Protection, so every request carries
`x-vercel-protection-bypass` with the automation bypass secret. The smoke reads
JSON APIs only, so it never needs the `x-vercel-set-bypass-cookie` companion
header that a browser session would. The secret is sent only to
`STAGING_HOST_URL`: a dispatch naming another host stops before the smoke with a
notice instead of leaking the header to it.

When `VERCEL_AUTOMATION_BYPASS_SECRET` is absent the job prints a notice and
stops before installing anything: protection would answer every probe with its
own challenge, and failing on that would page the owner about a missing secret
rather than about staging. No SMS is sent, and the alert gate records nothing,
so a skipped run neither arms nor disarms the monitor. Any other failure goes
through the gate and, when it may page, sends one SMS through
`.github/actions/alert-sms` — the credentials `prod-smoke.yml` uses — carrying
`Together STAGING smoke FAILED: <failing checks>`.

The skip lives in the workflow, not in the script: `pnpm run smoke:staging`
sends the bypass header only when `VERCEL_AUTOMATION_BYPASS_SECRET` is set, so
it can also probe a staging deployment that sits behind no deployment
protection.

### Repository secret and variables the owner must add

| Name | Kind | Purpose |
| --- | --- | --- |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | secret | Bypasses staging deployment protection. Absent → the whole smoke is skipped with a notice. Sent only to `STAGING_HOST_URL`, so a dispatch against another host skips the smoke instead of leaking the secret to it. |
| `PRODUCTION_DATABASE_FINGERPRINT` | variable | The fingerprint staging must **not** answer with. Unset → the workflow falls back to the recorded production value. |
| `STAGING_DATABASE_FINGERPRINT` | variable | The fingerprint staging must answer with. Unset → the run passes green and prints the value to pin, without an SMS. |
| `STAGING_HOST` | variable | Host the smoke targets, without a scheme. Unset → `acme.staging.togethercommunity.app`. |
| `OPERATOR_SECRET_STAGING` | secret | The staging deployment's `OPERATOR_SECRET`, used to sanitize secrets and read redacted auth-mail evidence. Falls back to the deprecated `STAGING_OPERATOR_SECRET` repository secret. Unset → the sanitize and the `auth-mail-serverless` check are skipped with a notice, the remaining checks still run. |

Obtain the bypass secret in Vercel → Settings → Deployment Protection →
Protection Bypass for Automation, then copy it into Settings → Secrets and
variables → Actions → repository secrets. Regenerating it in Vercel invalidates
the copy here.

## Purchase end-to-end on a deployed host

`pnpm run e2e:purchase:remote` (`app/scripts/purchase-e2e.ts`) buys, pays and
refunds in the payment provider's **test mode**, only in the `acme` fixture
workspace. Local e2e runs use the fake provider. Choose the deployed target
with `PURCHASE_E2E_ENVIRONMENT`:

| | staging | production |
| --- | --- | --- |
| Host | `https://acme.<staging host>` on the platform domain, never the production fixture host | exactly `https://acme.<platform domain>` |
| Health | `staging`, a database other than `PRODUCTION_DATABASE_FINGERPRINT` | `production`, on `PRODUCTION_DATABASE_FINGERPRINT` |
| Credential | fixture staff session (default: the seeded fixture owner) | exclusive purchase-smoke shop management key, sent in `X-API-Key` to the two purchase-smoke routes only |
| Test slot and fixtures | the runner configures the slot and provisions fixtures | the [operator reseed](#purchase-smoke-fixtures-and-machine-key) configures the slot and provisions fixtures; the runner changes neither |
| Event delivery | the runner forwards events | the provider delivers events to the registered test endpoint |
| Deployment bypass | sent to the staging origin only | never read or sent |

The runner refuses redirects, refuses a missing pinned production fingerprint,
and checks `/api/health` before issuing credentials. Both modes require
`rk_test_` and `pk_test_` provider keys and reject live-mode provider objects.
Production never signs in and sends no password, session cookie or deployment
bypass. The purchase-smoke route requires the fixture's own test slot and an
empty live slot.

### How a test payment completes without a person

The provider documents that its hosted Checkout page has security measures that
prevent automated testing
([Automated testing](https://docs.stripe.com/automated-testing)). The runner
instead creates a card payment method from `tok_visa` and confirms it via
`/v1/payment_pages/<session>/confirm`, the method used by the provider CLI's
`checkout.session.completed` trigger. Before confirming, it checks the test
session ID and that the total matches the fixture price, including any required
delivery. It supplies a delivery address and rate when the session collects
them and accepts provider terms when required. The confirmation endpoint is not
in the public API reference; a provider-side change fails the purchase checks
with the provider's error code and parameter name. Keep the run volume low:
test mode is rate-limited more strictly than live mode
([Testing](https://docs.stripe.com/testing)).

### Production checks

1. `target` — `/api/health` reports production and the pinned database fingerprint.
2. `start <scenario>` and `pay <scenario>` — one run ID covers `digital-course`, `parcel-courier`, `parcel-locker` and `bundle-locker`. The machine key starts each fixed test checkout; the sandbox publishable key completes it. Expected totals are 99.00, 40.99, 37.99 and 136.99 PLN respectively.
3. `paid <scenario>` — polls the return page's public `GET /api/public/checkout/session-status?session_id=…` and the machine-key result. The public response must say `paid`; the own-checkout result must say `paid: true` and include an applied `checkout.session.completed` receipt whose event ID matches a stored provider event for that session.
4. `delivery` — reports `pending_webhooks` for the checkout events; the count is informational, not a pass condition.
5. `api version` — reports the received API version recorded on each checkout receipt (missing versions fail) and the test endpoint's configured version from the provider's Webhook Endpoints API (read only).
6. `refund full` and `refund partial` — use the provider API to refund all of the digital course and 5.00 PLN of the courier parcel. The runner re-reads the test session it paid and refuses an unrelated payment intent. The provider retry key is derived from the run ID and scenario. The own-checkout result must show the expected refund state and amount and an applied `charge.refunded` receipt for that amount.
7. `replay` — reads the confirmed parcel-locker session in API version `2020-03-02` and in the pinned webhook version. It runs both payloads through the local adapter and checks the total, the 12.99 PLN delivery fee and the Polish delivery address. The replay posts nothing to the deployed host.

`pending_webhooks = 0` means the provider stopped retrying, not that the
platform applied the event; the applied state is proven only by the receipt,
which the server writes in the same transaction that applies the event.
An event fetched from the Events API is the provider's stored object, not the
body the endpoint received; the receipt's event id and API version are what
the server recorded on application.
The production refund check proves inbound refund reconciliation (a
provider-side refund reaches the order), NOT the staff refund flow.

#### Not verified on production

- The staff refund flow.
- Test-mode coupon refusal.
- Stock movement.
- Fixture provisioning through staff routes.
- Purchase e-mail and invoicing.

### Staging checks and forwarding

The staging runner checks target identity and signs in as fixture staff. It
confirms the workspace (`tenant-acme`) and an owner or admin role, and stops
before writing if four new orders would exceed `PURCHASE_E2E_TEST_ORDER_CAP`
(default 300). It checks that the live slot is empty, configures the test slot
and provisions the rates, product, prices, stock and bundle. It verifies the
specific test-mode coupon refusal. For each purchase it checks the paid test
order's amount, product lines, delivery, locker code where applicable and sales
link, and confirms that stock did not move. It checks that the run's events
were signature-verified, reads the endpoint's pinned version, and replays the
parcel-locker payment locally as in production. The staging refunds are staff
refunds: the whole digital order and 5.00 PLN of the parcel-locker order. The
runner checks both the order's reconciled refund and the provider refund of the
same payment naming the staff refund job.

The provider cannot deliver to staging behind deployment protection. The
runner generates a signing secret, stores it as `stripe.testWebhookSecret`,
reads its own checkout and refund events from the Events API, then signs the
stored objects and posts them to
`/api/webhooks/stripe/tenant-acme?mode=test` with the staging bypass header.
This tests ingestion of the stored-event payload, not the provider's delivery,
signature or exact received body. The registered test endpoint stays in the
sandbox; the provider's direct deliveries to the protected host fail until it
stops retrying. The forwarder signs `<timestamp>.<body>` with HMAC-SHA256 and
sends `t=<timestamp>,v1=<signature>`.

The staging restricted key needs the permissions listed for the test-mode
card, including Charges and Refunds write access, and Events read access. Its
sandbox is separate from production. Test-slot configuration removes previous
endpoints for the workspace and slot in its sandbox.

### Configuration and production sandbox permissions

The staging and production credentials are independent. Neither environment
falls back to the other environment's secrets.

| Variable | staging | production |
| --- | --- | --- |
| `PURCHASE_E2E_BASE_URL` | `https://acme.` staging origin | `https://acme.togethercommunity.app` |
| `PURCHASE_E2E_ENVIRONMENT` | `staging` | `production` |
| `PRODUCTION_DATABASE_FINGERPRINT` | database staging must not use | pinned production database |
| `STRIPE_TEST_RESTRICTED_KEY_STAGING` | staging sandbox restricted test key | not read |
| `STRIPE_TEST_PUBLISHABLE_KEY_STAGING` | staging sandbox publishable test key | not read |
| `PURCHASE_E2E_STAFF_PASSWORD_STAGING` | optional; defaults to the seeded demo password | not read |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | existing staging smoke secret | not read |
| `PURCHASE_E2E_PRODUCTION_SHOP_KEY` | not read | exclusive purchase-smoke machine key issued by the fixture workspace's verified owner |
| `PURCHASE_E2E_PRODUCTION_STRIPE_KEY` | not read | runner restricted `rk_test_` key of the dedicated production fixture sandbox |
| `PURCHASE_E2E_PRODUCTION_STRIPE_PUBLISHABLE_KEY` | not read | `pk_test_` key of that same sandbox |

Optional on both modes: `PURCHASE_E2E_PLATFORM_DOMAIN` (defaults to
`togethercommunity.app`) and `PURCHASE_E2E_RUN_ID` (defaults to the current
Unix time in milliseconds). Optional on staging only:
`PURCHASE_E2E_STAFF_EMAIL`, `PURCHASE_E2E_EXPECTED_DATABASE_FINGERPRINT`,
`PURCHASE_E2E_LOCKER_CODE` (default `WAW01M`) and `PURCHASE_E2E_TEST_ORDER_CAP`.

Use one provider sandbox **only for this production fixture**, with two
separate restricted `rk_test_` keys and the same sandbox's `pk_test_` key.
The provider keys do not inherit the shop key's workspace/checkout limits.
See the provider's [key permissions reference](https://docs.stripe.com/keys/permissions-reference).

**Deployment key: `SMOKE_PURCHASE_STRIPE_TEST_KEY`.** The reseed configures
webhooks and the server uses this key for checkout sessions and reconciliation.

| Resource (Dashboard) | Level | Permission | Calls it covers |
| --- | --- | --- | --- |
| Webhook Endpoints | Write | `webhook_write` | `POST /v1/webhook_endpoints`, `DELETE /v1/webhook_endpoints/{id}`, `GET /v1/webhook_endpoints` (slot configuration and cleanup) |
| Checkout Sessions | Write | `checkout_session_write` | `POST /v1/checkout/sessions`, `POST /v1/checkout/sessions/{id}/expire` |
| Charges and Refunds | Read | `charge_read` | `GET /v1/refunds`, `GET /v1/refunds/{id}` (refund reconciliation) |
| everything else | None | | |

Studio's permission check reports the coupon, promotion-code and refund-write
permissions as missing for this key. These permissions are not needed here.

**Runner key: `PURCHASE_E2E_PRODUCTION_STRIPE_KEY`.** Only the runner holds
this key; it never reaches the deployed application.

| Resource (Dashboard) | Level | Permission | Calls it covers |
| --- | --- | --- | --- |
| Checkout Sessions | Read | `checkout_session_read` | `GET /v1/checkout/sessions/{id}` |
| Events | Read | `event_read` | `GET /v1/events` |
| Charges and Refunds | Write | `charge_write` | `POST /v1/refunds` (the provider-side refund), `GET /v1/refunds` |
| Webhook Endpoints | Read | `webhook_read` | `GET /v1/webhook_endpoints` (reports the endpoint's API version) |
| everything else | None | | |

The runner key cannot configure webhooks or create Checkout Sessions. The
publishable key completes payment via `POST /v1/payment_methods` with `tok_visa`
and `GET`/`POST /v1/payment_pages/{id}[/confirm]`.

### Records and scheduling

Both modes create test orders and checkout snapshots in `tenant-acme`; the
records stay out of live access, revenue, exports and reconciliation. Production
uses the synthetic smoke member and produces checkout bindings and applied-event
receipts. Its refunds originate at the provider and never create a staff refund
job. Staging writes fixture settings, registers a test webhook and stores the
forwarder's signing secret; its orders use the `purchase-e2e:<run id>` reference
and its staff refunds may wake the shared refund dispatcher. Production orders
are removed by the next fixture reseed and staging orders stay until the next
database branch reset. A test-mode purchase never sends Together e-mail.

The planned workflows are separate from this runner. A staging run would
follow the staging smoke. A production run would follow a successful
`prod-smoke` after the fixture reseed, remaining observe-only until first green
and paging only through `.github/actions/alert-gate`.

## The smoke tenant

Production carries one permanent synthetic tenant, `acme` (`tenant-acme`). It is
the seed's acme fixture — the same rows local development and the e2e suites
get — so smoke assertions can name known content:

| Fixture | Value |
| --- | --- |
| Tenant | `tenant-acme`, slug `acme`, name `Acme Courses` |
| Creator | `kontakt+smoke-creator@togethercommunity.app` |
| Smoke member | `kontakt+smoke-member@togethercommunity.app`, granted `product-acme-course` |
| Passwordless member | `student2@together.dev` |
| Published product | `product-acme-course` — `Acme Course` |
| Course | `course-acme` — `Acme Course`, one module, one lesson with a Bunny Stream video |

Only the password source differs by environment. Locally and in e2e both
accounts are seeded with the shared demo password; on production the seed reads
`SMOKE_MEMBER_PASSWORD` and `SMOKE_CREATOR_PASSWORD` and refuses to run when
either is unset or equal to the demo password, so the demo password can never
reach a production database.

### What is hidden

The tenant is marked by its identity (`SMOKE_TENANT_ID` in
`core/domain/smoke-tenant.ts`), not by a column — no migration, and the marking
travels with the fixture:

- **Tenant directory.** `createTenantDirectory(db, production)` drops it from
  `listAll()`. That is the only cross-tenant enumeration reaching a public
  surface (`/api/health/deep`), so on production the synthetic tenant is neither
  listed nor probed there. The platform exposes no other public tenant listing;
  `GET /api/tenants` returns the caller's own staff workspaces and member communities.
- **Marketing.** On production the marketing SES credential resolver refuses the
  tenant with `broadcasts_disabled`, and every marketing send — campaign
  dispatch, the M2M send API, the send-to-self test — resolves credentials
  before it reaches SES, so none of them can leave the platform. `campaignTick`
  additionally returns an empty, no-op result for the tenant so no campaign is
  even leased. Off production the tenant is an ordinary demo tenant and
  campaigns run.
- **Transactional e-mail.** On production the layered sender routes its messages
  to `createSinkEmailPort`, which logs `[email-sink] to=… subject=…` and drops
  the message. Sends are recorded with the `platform` transport, because no
  tenant integration ran.

### Purchase smoke fixtures and machine key

Set `SMOKE_PURCHASE_STRIPE_TEST_KEY` to an `rk_test_` restricted key from a
sandbox dedicated to the synthetic workspace. The operator reseed seeds two
shipping rates (courier: 15.99 PLN; parcel locker: 12.99 PLN), terms and privacy
URLs, the 25.00 PLN physical product with its active price and 1000 units of
stock, the course VAT rate (23%), and the unlisted parcel-and-course bundle
sales link. It configures only the TEST payment slot through the shared Stripe
configuration path, including provider-managed webhook registration. Without
this variable, the normal smoke seed is unchanged. A malformed key is ignored
with a warning. The reseed response includes `testPayments`: `configured`,
`not-configured`, or `failed`; check this field before running purchases.

A verified owner of `tenant-acme` issues a shop management key with
`purpose: "purchase-smoke"`, `scopes: []`, `mode: "direct"`, a name and
an absolute expiry no more than 30 days away. The existing owner key-revocation
and purge controls apply. The secret is returned once. Neither issuance nor
renewal is available to machine keys. Issue it signed in as the seeded fixture
owner: authentication checks that the issuer still owns the workspace, and the
reseed re-creates only that owner's grant, so a key issued by another owner
stops authenticating after the next reseed.

The key grants only two routes:

- `POST /api/m2m/shop/purchase-smoke/checkouts`: JSON `{runId, scenario}`;
  scenario is `digital-course`, `parcel-courier`, `parcel-locker`, or
  `bundle-locker`. Returns `{runId, scenario, reference, sessionId, url}`.
- `GET /api/m2m/shop/purchase-smoke/checkouts/:reference/result`: returns
  that key's checkout identity, paid state, refund state, the largest cumulative
  refunded amount among applied refund events, and applied-event receipts
  (received event id, type and API version, application time and observed refund
  amount). A missing version remains null, not an inferred provider version.

All checkouts use the existing synthetic smoke member, TEST mode and fixed
fixtures. Locker scenarios use `WAW01M`. No caller-selected buyer, product,
price, amount, workspace, return URL or payment mode is accepted. A missing test
slot or any configured live slot refuses checkout. The workspace cap is 40
checkouts per UTC day, including pending checkouts; a repeated key/run/scenario
returns the existing checkout rather than creating another.

Reseeding preserves existing purchase-purpose keys, revocation state, original
absolute expiry, request and lifecycle audit, rate-limit buckets and checkout
bindings inside the same transaction. It does not mint, extend or un-revoke a
key. Other shop keys are removed. Key mutations and checkout creation serialize
with reseeding. The reseed still removes orders: an old binding is not a fresh
purchase, and its result is unavailable after that order is removed. Use a new
run id after reseeding; retained bindings keep the daily cap from resetting.

Receipts are written in the same transaction that applies a payment or refund
event to that order (a state change, or a larger cumulative refunded amount),
never on signature acceptance or event handling alone. A late partial
refund after a full refund and a duplicate full refund produce no new receipt.
A provider refund tests
inbound refund reconciliation, not staff refund authorization or dispatch.
The runner needs a separate restricted provider key from this same exclusive
sandbox, without webhook-configuration permissions. It does not receive the
operator secret or server configuration credential.

### Reseeding the smoke tenant

`POST /api/internal/reseed-acme`, authenticated by the
`x-scheduler-operator-secret` header, wipes and re-applies **only**
`tenant-acme`. `prod-smoke.yml` calls it before the checks.

The header is matched against `OPERATOR_SECRET`, the one name every environment
uses for the internal operator routes. `PROD_OPERATOR_SECRET`,
`STAGING_OPERATOR_SECRET`, `CRON_SECRET` and `EMAIL_DISPATCH_SECRET` are still
accepted, in that order, so a deployment can be migrated without downtime; all
four are deprecated and exist only until every environment sets `OPERATOR_SECRET`.
A deployment that gives the workflow its own operator secret can rotate it
without touching the secret its scheduled jobs authenticate with.

The run is transactional, takes the same class of advisory lock as the full
reseed, and writes a `reseed-acme` row into `platform_audit_events`. Unlike
`POST /api/platform/data-reset` it is allowed on production by design — the
tenant is synthetic — so it deliberately skips `productionResetRefusal`. The
fingerprint guard still protects the full reset. Three checks stand in its place
and refuse the run with a `conflict` error carrying the reason:

- `tenant-acme` exists under a slug other than `acme`;
- `tenant-acme` has any member whose e-mail is neither on `@together.dev` nor
  one of the two smoke accounts;
- `tenant-acme` holds a marketing consent from an address outside that same set
  — a public surface the fixture never uses, so the row belongs to a real person
  and its consent evidence must not be wiped.

Alongside those refusals, note what the run rewrites beyond the tenant: the wipe
is tenant-scoped, but the re-seed is not entirely. `user` and `account` carry no
tenant column, so re-creating the fixture resets the password and timestamps of
the global rows of both smoke accounts,
`kontakt+smoke-creator@togethercommunity.app` and
`kontakt+smoke-member@togethercommunity.app`. Both are platform-owned addresses
the guard allow-lists, so no real person's credential is in reach — but the run
is "only `tenant-acme`" in the tenant-scoped tables, not in the auth tables.

Manually, against any database:

```bash
DATABASE_URL=… SMOKE_MEMBER_PASSWORD=… SMOKE_CREATOR_PASSWORD=… pnpm run reseed:acme
```

The script decides whether it is writing to production from the process
environment **and** from the fingerprint of `DATABASE_URL` against
`PRODUCTION_DATABASE_FINGERPRINT`, so an operator laptop with no `NODE_ENV` set
still cannot write the demo password to the production database. On any other
database both passwords may be omitted and the demo password is used.
`pnpm run db:seed` uses the same test and refuses outright, because the full
demo fixture has no business on production.

## External monitor (owner-side, no code)

Configure one uptime monitor per URL in Better Stack or UptimeRobot. Both
endpoints are unauthenticated, so no header or credential is needed.

| URL | Expected | Interval | Timeout | Confirm before alerting |
| --- | --- | --- | --- | --- |
| `https://<tenant-host>/api/health` | HTTP 200 and body contains `"database":"up"` | 5 min | 15 s | 2 consecutive failures |
| `https://<tenant-host>/api/health/deep` | HTTP 200 | 5 min | 30 s | 2 consecutive failures |

Notes for the monitor configuration:

- Keep the interval at 5 minutes or slower. The deep endpoint is capped at 12
  requests per minute per address and answers from a 60-second cache, so a
  faster poll buys no freshness and only risks a 429.
- Treat 429 as "monitor misconfigured", not as an incident.
- Route both monitors to SMS on the same on-call number as
  `ALERT_SMS_PHONE`, so every alert path lands in one place.
- The GitHub-scheduled `prod-health.yml` probe runs hourly and stays as the
  backstop if the external monitor account lapses; the two are deliberately
  independent.
