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
state `success` and environment `Production`, and on `workflow_dispatch`. It
waits until `https://coderoad.togethercommunity.app/api/health` reports the
deployment's commit (up to five minutes), then runs
`pnpm run smoke:remote` (`app/scripts/remote-smoke.ts`) with
`EXPECTED_SHA` set to that commit. A manual dispatch may leave `expected_sha`
empty; the wait and the `health-attestation` match are then both skipped, so any
commit the host serves is accepted.

Checks, in order:

1. `health-attestation` — `sha` matches `EXPECTED_SHA`, database up, schema current.
2. `health-deep` — `/api/health/deep` answers 200 with `ok: true`.
3. `public-offer` — the anonymous offer for the tenant.
4. `public-page` — the tenant storefront returns HTML.
5. `member-sign-in` — password sign-in of the synthetic member.
6. `member-identity` — `/api/me` reports a membership on the tenant.
7. `student-courses` — the member's course list and the structure of its first course.
8. `lesson-playback` — the first accessible lesson resolves a playback URL that is not `unavailable`.
9. `studio-tenant-settings` — **skipped**. Tenant API key scopes cover marketing, transactional, enrollment and import capabilities only; none of them grants `tenant:settings:read`, so a Studio settings read cannot be authenticated by a key from a workflow. No `SMOKE_STUDIO_API_KEY` secret is needed today. Re-enable this check by adding a read scope to `capabilitiesByScope` in `core/domain/api-key.ts` first.

On failure the workflow sends one SMS through the shared
`.github/actions/alert-sms` composite action — the same SNS credentials
`prod-health.yml` uses — carrying only the failing check names. Credentials are
never printed: the script reports check names and messages, never request
bodies or headers.

### Repository secrets the owner must add

Settings → Secrets and variables → Actions → repository secrets:

| Secret | Used by | Purpose |
| --- | --- | --- |
| `ALERT_AWS_ACCESS_KEY_ID` | prod-health, prod-smoke | IAM user allowed to `sns:Publish` only. |
| `ALERT_AWS_SECRET_ACCESS_KEY` | prod-health, prod-smoke | Its secret key. |
| `ALERT_SMS_PHONE` | prod-health, prod-smoke | On-call number in E.164 form. |
| `SMOKE_MEMBER_EMAIL` | prod-smoke | E-mail of the synthetic member. |
| `SMOKE_MEMBER_PASSWORD` | prod-smoke | Its password. |

The first three already exist for `prod-health.yml`; the smoke reuses them.

### Creating the synthetic member

The smoke signs in as a real member of the CodeRoad tenant. It never writes, so
one free product is enough.

1. In Studio on `coderoad.togethercommunity.app`, publish (or reuse) one free
   product whose access items cover at least one course with one lesson.
2. Create a member with a dedicated address, for example
   `smoke+prod@togethercommunity.app`, and set a password on it (the smoke uses
   password sign-in, not a magic link, so the account must have one).
3. Grant that member the free product.
4. Store the address in `SMOKE_MEMBER_EMAIL` and the password in
   `SMOKE_MEMBER_PASSWORD`.
5. Verify with a manual `workflow_dispatch` run of `prod-smoke` before relying
   on it.

Keep the account out of marketing audiences and out of any staff role: the
smoke must exercise the member surface, nothing wider.

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
