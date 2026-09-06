# Observability

Production is watched by three independent layers. Each one answers a different
question and none of them depends on the other two.

| Layer | Surface | Question |
| --- | --- | --- |
| Liveness and readiness | `/api/health/live`, `/api/health/ready`, `/api/health` | Does the process answer and is its schema current? |
| Deep health | `/api/health/deep` | Does every tenant still parse, load and sign? |
| Post-deploy smoke | `.github/workflows/prod-smoke.yml` | Can a real member sign in and play a lesson on the deployed commit? |

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
comfortably inside the 30-second function limit in `vercel.json`. A probe that
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
    "checks": [
      { "name": "tenant-directory", "ok": true, "ms": 4, "error": null },
      { "name": "scheduler-freshness", "ok": true, "ms": 6, "error": null },
      { "name": "tenant-settings", "ok": false, "ms": 11, "error": "…" },
      { "name": "public-offer", "ok": true, "ms": 38, "error": null },
      { "name": "course-content", "ok": true, "ms": 52, "error": null },
      { "name": "tenant-secret-decryption", "ok": true, "ms": 3, "error": null },
      { "name": "email-transport", "ok": true, "ms": 9, "error": null },
      { "name": "storage-presign", "ok": true, "ms": 2, "error": null }
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
caught by the suite rather than by reading production output).

### What each check does

| Check | Scope | What it exercises |
| --- | --- | --- |
| `tenant-directory` | platform | Enumerates every tenant; nothing else can run without it. |
| `scheduler-freshness` | platform | Newest `schedulerRuns` row started less than 2 hours ago. A deployment that has never scheduled anything (fresh database, self-host without cron) has no age to compare and is skipped; only a scheduler that ran and then stopped fails. |
| `tenant-settings` | per tenant | Loads the settings row and parses it through `tenantSettingsSchema` — the same parse the Studio settings response goes through. |
| `public-offer` | per tenant | Builds the public offer (products, prices, preview lessons, branding). |
| `course-content` | per tenant | Loads a course and the first lesson it references: the first publicly visible course through the anonymous structure, or — when every course is members-only — the first course through its modules. |
| `tenant-secret-decryption` | per tenant | Decrypts one stored secret with the master key. The plaintext is discarded, never returned. |
| `email-transport` | per tenant | Resolves the transactional transport (tenant SES → SMTP → Resend). Tenants on the platform pool are skipped. |
| `storage-presign` | per tenant | Signs a GET URL for the configured bucket. No request is sent to the bucket. |
| `deadline` | platform | Present only when the 20-second budget ran out; names the probes that did not finish. |

`prod-health.yml` probes `/api/health` first and `/api/health/deep` second; the
scheduled run fails and pages when the deep probe answers anything other than
200.

## Post-deploy remote smoke

`.github/workflows/prod-smoke.yml` runs on a `deployment_status` event with
state `success` and environment `Production`, and on `workflow_dispatch`. Both
the wait and the checks target `https://<SMOKE_TENANT>.togethercommunity.app` —
every tenant host serves `/api/health`, so the commit attestation holds on the
tenant's own host and the smoke never signs a member of one tenant in on
another's. It waits until that host reports the deployment's commit (up to five
minutes), reseeds the smoke tenant, then runs `pnpm run smoke:remote`
(`app/scripts/remote-smoke.ts`) with `EXPECTED_SHA` set to that commit.

A manual dispatch may point `base_url` at any host; left empty it smokes the
tenant host. It may also leave `expected_sha` empty, and the wait and the
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
8. `lesson-playback` — the accessible lesson resolves a playback URL that is not `unavailable`; on the smoke tenant the seeded lesson carries a Bunny Stream video, so a `bunny` playback URL must resolve.
9. `studio-tenant-settings` — **skipped**. Tenant API key scopes cover marketing, transactional, enrollment and import capabilities only; none of them grants `tenant:settings:read`, so a Studio settings read cannot be authenticated by a key from a workflow. No `SMOKE_STUDIO_API_KEY` secret is needed today. Re-enable this check by adding a read scope to `capabilitiesByScope` in `core/domain/api-key.ts` first.

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

On failure the workflow sends one SMS through the shared
`.github/actions/alert-sms` composite action — the same SNS credentials
`prod-health.yml` uses — carrying only the failing check names. Skipped checks
never trigger an SMS. Credentials are never printed: the script reports check
names and messages, never request bodies or headers.

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
| `PROD_OPERATOR_SECRET` | prod-smoke | Operator secret for `POST /api/internal/reseed-acme`; must equal the deployment's `PROD_OPERATOR_SECRET`, or its `CRON_SECRET` where the deployment sets no operator secret. Absent → the reseed step prints a notice and is skipped. Sent only to the tenant host, so a dispatch against another host skips the reseed instead of leaking the secret to it. |

The creator account never signs in from the workflow, so its password lives on
the deployment only, as `SMOKE_CREATOR_PASSWORD`.

The first three already exist for `prod-health.yml`; the smoke reuses them and
passes exactly the inputs that workflow passes, the region left to the composite
action's `eu-central-1` default. The tenant under test comes from the
`SMOKE_TENANT` repository variable and defaults to `acme`; it names both the
`x-tenant` header and the host. Pointing that variable at another tenant also
skips the reseed with a notice: the route rebuilds `tenant-acme` only, and
wiping it would serve no run that checks something else.

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
`coderoad.staging.togethercommunity.app`), the tenant coming from the same
`SMOKE_TENANT` variable the production smoke uses.

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

The staging database is a branch reset from production, so every tenant secret it
carries — SES, S3, Stripe, Bunny, iFirma, KSeF — was encrypted with the
production `SECRETS_MASTER_KEY`. Staging holds a different key, so those rows
decrypt to nothing there: `/api/health/deep` fails `tenant-secret-decryption`,
and `storage-presign` fails with it because the S3 configuration is one of the
unreadable rows.

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
`STAGING_OPERATOR_SECRET` repository secret through the deployment-protection
bypass header. Absent secret → the step prints a notice and the smoke runs
against staging as it stands; a failing call does not fail the job, so a sanitize
problem never masquerades as a staging outage.

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
rather than about staging. No SMS is sent. Any other failure sends one SMS
through `.github/actions/alert-sms` — the credentials `prod-smoke.yml` uses —
carrying `Together STAGING smoke FAILED: <failing checks>`.

### Repository secret and variables the owner must add

| Name | Kind | Purpose |
| --- | --- | --- |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | secret | Bypasses staging deployment protection. Absent → the whole smoke is skipped with a notice. Sent only to `STAGING_HOST_URL`, so a dispatch against another host skips the smoke instead of leaking the secret to it. |
| `PRODUCTION_DATABASE_FINGERPRINT` | variable | The fingerprint staging must **not** answer with. Unset → the workflow falls back to the recorded production value. |
| `STAGING_DATABASE_FINGERPRINT` | variable | The fingerprint staging must answer with. Unset → the run passes green and prints the value to pin, without an SMS. |
| `STAGING_HOST` | variable | Host the smoke targets, without a scheme. Unset → `coderoad.staging.togethercommunity.app`. |
| `STAGING_OPERATOR_SECRET` | secret | Staging's `PROD_OPERATOR_SECRET` value, used to call the secret sanitize before the checks. Unset → the sanitize is skipped with a notice. |

Obtain the bypass secret in Vercel → Settings → Deployment Protection →
Protection Bypass for Automation, then copy it into Settings → Secrets and
variables → Actions → repository secrets. Regenerating it in Vercel invalidates
the copy here.

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
  `GET /api/tenants` returns the caller's own staff memberships.
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

### Reseeding the smoke tenant

`POST /api/internal/reseed-acme`, authenticated by the
`x-scheduler-operator-secret` header, wipes and re-applies **only**
`tenant-acme`. `prod-smoke.yml` calls it before the checks.

The header is matched against `PROD_OPERATOR_SECRET`, falling back to
`CRON_SECRET` and then to `EMAIL_DISPATCH_SECRET`. A deployment that gives the
workflow its own operator secret can therefore rotate it without touching the
secret its scheduled jobs authenticate with.

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
| `https://coderoad.togethercommunity.app/api/health` | HTTP 200 and body contains `"database":"up"` | 5 min | 15 s | 2 consecutive failures |
| `https://coderoad.togethercommunity.app/api/health/deep` | HTTP 200 | 5 min | 30 s | 2 consecutive failures |

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
