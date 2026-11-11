# Running Together on Kubernetes

This is the contract between the application image and a Kubernetes
deployment: what to build, which commands to run, which ports and probes to
wire, which environment variables the processes read, and which scheduled
calls replace the platform crons in [`vercel.json`](../vercel.json). The
manifests themselves live outside this repository. The
[self-host guide](self-host.md) covers the single-machine Compose stack, whose
behaviour this contract leaves unchanged.

## Image

Build one image per commit and promote that image unchanged. The browser
bundle embeds its configuration at build time, so the values below are build
arguments, not runtime settings. None of them is a secret; never pass a secret
as a build argument, because build arguments are visible in the image history.

| Build argument | Value | Effect |
|---|---|---|
| `APP_VERSION` | `pnpm exec tsx scripts/derive-version.ts` in a full clone | Stamped into the image's `package.json`, so `/api/health`, trace metadata and the browser stamp report it. Empty keeps the committed manifest version. |
| `APP_COMMIT_SHA` | `git rev-parse HEAD` | Embedded in the browser bundle and kept as the image's runtime default, so the server and the browser report the same commit. |
| `APP_BASE_DOMAIN` | The multi-tenant base domain | Embedded in the browser bundle for tenant and sign-in routing, and kept as the runtime default. Empty builds a single-tenant bundle. |
| `VITE_SENTRY_DSN` | The public browser DSN, or empty | Enables browser error reporting. It ships to every browser and is not a credential. |

```bash
cd app
docker build \
  --build-arg APP_VERSION="$(pnpm exec tsx scripts/derive-version.ts)" \
  --build-arg APP_COMMIT_SHA="$(git rev-parse HEAD)" \
  --build-arg APP_BASE_DOMAIN=togethercommunity.app \
  --tag together:"$(git rev-parse --short HEAD)" .
```

The Docker build context excludes `.git`, so the version has to be derived
before the build. Do not set `APP_COMMIT_SHA` in the pod environment: the image
already carries it, and a different runtime value would make the server and the
browser disagree. `APP_BASE_DOMAIN` in the pod environment must equal the build
argument. The image labels `org.opencontainers.image.version` and
`org.opencontainers.image.revision` repeat the two identity values.

## Commands

Every container uses the working directory `/app` and runs as the unprivileged
`node` user. The image entrypoint migrates and then serves, which suits Compose;
Kubernetes overrides `command` so that the two steps run separately.

| Workload | `command` | Notes |
|---|---|---|
| Server Deployment | `["node", "apps/server/src/entry.node.js"]` | Serves HTTP and never migrates. |
| Migration Job | `["node", "adapters/db/migrate.js"]` | Applies pending migrations from `/app/drizzle` and exits 0. Run it once per release before the Deployment rolls out, with `parallelism: 1` and `backoffLimit: 0`; two migrators must never run at once. |

The migration Job reads `DATABASE_URL`, which points at the migration role, and
optionally `APP_ENV` for its log line. It reads no other configuration. The
server pods use a separate runtime role.

## Ports

| Port | Listener | Exposure |
|---|---|---|
| `48730` | Application HTTP (`PORT`) | Reached only by the edge proxy, the scheduled calls and the kubelet probes. |
| `48732` | Certificate-admission check (`INTERNAL_PORT`) at `/internal/domain-check` | Reached only by the edge proxy's on-demand TLS `ask`. Unauthenticated by design; never route it publicly. |

The admission listener starts only when `INTERNAL_PORT` is set.

## Probes

| Probe | Endpoint | Meaning |
|---|---|---|
| Liveness | `GET /api/health/live` | The process answers. It never touches the database, so a database outage does not restart pods. |
| Readiness | `GET /api/health/ready` | 200 only when the database answers and holds at least as many applied migrations as this release ships. A pod that starts before the migration Job finishes stays unready with `503` and a message naming both counts. A database ahead of the release stays ready, so old pods keep serving while a newer release migrates. |
| Startup | `GET /api/health/live` | Boot reads the environment and builds the dependency graph before listening. |

`GET /api/health` is the promotion attestation (version, SHA, database
fingerprint, migration counts and schema fingerprint); it answers 200 even when
the database is down, so it is not a probe.

## Shutdown

On `SIGTERM` or `SIGINT` the server stops accepting connections on both
listeners, closes idle keep-alive connections, stops the in-process tickers and
waits for the requests and ticker runs already in progress. After 20 seconds
it closes the connections that are still open. It then flushes pending
authentication e-mail, closes the realtime `LISTEN` connection and the database
pool, flushes trace export, and exits 0; each of those steps gets at most
5 seconds. Keep `terminationGracePeriodSeconds` at 30 or more, plus the length
of any `preStop` delay.

## Environment

Only variable names are listed here; the values come from the secret store.
[`env.ts`](../apps/server/src/env.ts) validates every one of them and refuses to
boot on an invalid production configuration.

Required in production (`NODE_ENV=production` is the image default):

- `APP_ENV=production`, `APP_BASE_URL` (HTTPS), `APP_BASE_DOMAIN`
- `DATABASE_URL`, `DB_DRIVER=node-postgres`
- `AUTH_TRUSTED_PROXY_HEADER`
- `BETTER_AUTH_SECRET`, `SECRETS_MASTER_KEY`
- `PAYMENT_PROVIDER=stripe`, `SECURE_COOKIES=true`, `KSEF_ENVIRONMENT=production`
- `EMAIL_PROVIDER` (`ses` or `smtp`) and `EMAIL_FROM`
- `EMAIL_DISPATCH_SECRET`, `MARKETING_TICK_SECRET`, `CRON_SECRET`

Required by the chosen configuration:

- SMTP mail: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`
- SES mail: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- On-demand TLS admission: `INTERNAL_PORT=48732`
- A pooled `DATABASE_URL`: `REALTIME_DATABASE_URL` with a direct connection for `LISTEN`
- Google sign-in: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Trace export: `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_SERVICE_NAME`

Optional: `DATABASE_POOL_MAX`, `OPERATOR_SECRET`, `PLATFORM_OWNER_EMAILS`,
`PRODUCTION_DATABASE_FINGERPRINT`, `APP_CUSTOM_DOMAIN_TARGET`,
`DOMAIN_PROVISIONER_APEX_A_RECORD`, `TENANT_CREATION`, `PLATFORM_EGRESS_IP`,
`SMOKE_MEMBER_PASSWORD`, `SMOKE_CREATOR_PASSWORD`, `PERSONALISATION_MAX_BYTES`
and the tuning variables in [`.env.example`](../.env.example).

Leave unset: `APP_COMMIT_SHA` (the image carries it), every `VERCEL_*`
variable, `TOGETHER_VISUAL_CLOCK`, `SNS_TEST_CERT_PEM_BASE64`, and the
`DOMAIN_PROVISIONER_TOKEN`, `DOMAIN_PROVISIONER_PROJECT_ID`,
`DOMAIN_PROVISIONER_TEAM_ID` and `DOMAIN_PROVISIONER_GIT_BRANCH` quartet,
which would hand custom-domain provisioning back to the previous hosting
provider. Without them custom domains run in the manual activation mode
described in the [custom domains guide](custom-domains.md).

### Connection budget

Each server process opens at most `DATABASE_POOL_MAX` pooled connections
(10 when unset) plus one direct `LISTEN` connection for the realtime bus. The
migration Job holds one connection while it runs. Size the database's
connection limit for every replica during a rolling update, the migration Job
and an administrative reserve.

## Client address

The application trusts exactly one header for the client address, named by
`AUTH_TRUSTED_PROXY_HEADER`. The header must carry a single IP address; a
comma-separated forwarding chain is rejected and authentication rate limits
fall back to a shared bucket, which is reported once on stderr. Therefore:

- exactly one proxy terminates public traffic and sets that header by
  overwriting whatever the client sent (the bundled
  [`Caddyfile`](../Caddyfile) does this with
  `header_up X-Forwarded-For {remote_host}` and
  `AUTH_TRUSTED_PROXY_HEADER=x-forwarded-for`);
- that proxy sees the real client address, so no second proxy or load balancer
  that rewrites the source address sits in front of it;
- nothing else can reach port `48730`, so no client can supply the header
  itself.

## Scheduled endpoints

Each row is one platform cron from [`vercel.json`](../vercel.json) and becomes
one Kubernetes CronJob with `concurrencyPolicy: Forbid`, `timeZone: Etc/UTC`
and the same schedule. The job sends a `GET` to the server Service on port
`48730` with the header `Authorization: Bearer <CRON_SECRET>` and succeeds on a
2xx answer. The request must be allowed to run longer than the endpoint's own
budget, because the server keeps working after a client disconnects: give the
HTTP client at least 90 seconds and `activeDeadlineSeconds` at least 120.

<!-- scheduled-endpoints:start -->
| Path | Schedule | Overlapping calls | In-process ticker |
|---|---|---|---|
| `/api/internal/marketing/tick` | `* * * * *` | Avoid. Campaign sends are leased, but the maintenance scan (SES inbox, retention, identity refresh, telemetry drain) starts when the last completed maintenance run is old enough, without a claim, so two scans can repeat provider calls. Budget `MARKETING_WORKER_SECONDS` (at most 55 s). | None. |
| `/api/internal/dispatch-ksef` | `0 * * * *` | Safe. Jobs are claimed with `FOR UPDATE SKIP LOCKED` and a unique index allows one running job per tenant ([`ksef-repositories.ts`](../adapters/db/ksef-repositories.ts)). | KSeF dispatch every `KSEF_DISPATCH_INTERVAL_MS`. The HTTP call additionally purges expired rate-limit windows. |
| `/api/internal/domain-check` | `*/15 * * * *` | Avoid. The scan takes no lease; in the manual activation mode it does no work. | None. |
| `/api/internal/dispatch-email` | `* * * * *` | Safe. Outbox rows are claimed with `FOR UPDATE SKIP LOCKED` and marked `sending` in the same transaction ([`email-outbox.ts`](../adapters/db/email-outbox.ts)); fan-out jobs are leased the same way ([`notification-fanout-jobs.ts`](../adapters/db/notification-fanout-jobs.ts)); a stock reservation is released by an update conditioned on its `active` status ([`stock.ts`](../adapters/db/stock.ts)). | E-mail dispatch and the expired-reservation sweep every `EMAIL_DISPATCH_INTERVAL_MS`. The HTTP call additionally drains notification fan-out. |
| `/api/internal/dispatch-auto-invoices` | `0 * * * *` | Safe. Jobs are claimed with `FOR UPDATE SKIP LOCKED` and moved to `running` by an update conditioned on `queued` ([`auto-invoice-jobs.ts`](../adapters/db/auto-invoice-jobs.ts)). | Automatic invoicing every `KSEF_DISPATCH_INTERVAL_MS`; the CronJob only adds an hourly pass. |
| `/api/internal/marketing/imports/tick` | `* * * * *` | Safe. Each import is held by a 30-second worker lease checked against the worker id and attempt before every write; a second worker yields with a conflict. Budget 20 s. | None. |
<!-- scheduled-endpoints:end -->

Production refuses to boot without `CRON_SECRET`, and
`/api/internal/marketing/imports/tick` accepts no other credential, so the
CronJobs need only that one secret.

Every server process also runs the three in-process tickers named in the last
column. They and the CronJobs claim work through the same database claims, so
running both at once is harmless: a row claimed by one caller is invisible to
the other until its lease expires. The tickers cannot replace the CronJobs,
because the HTTP calls also drain notification fan-out and purge rate-limit
windows, and three of the endpoints have no ticker at all. No switch to turn
the tickers off is needed or provided.
