# Together PoC

A proof of concept for **Together**, built on the agent-first, strictly layered
full-stack TypeScript foundation. The implemented PoC includes auth, tenant
resolution, course delivery, products and grants, checkout, community,
marketing and integration surfaces across the web SPA, API and CLI.

Recurring repository reviews are defined in the [audit roster](docs/audits/README.md).

## Quickstart (local demo)

For a production Docker install, use the one-page [self-host guide](docs/self-host.md).

```bash
pnpm install --frozen-lockfile               # Node.js 24
pnpm run db:up        # Postgres 16
pnpm run db:migrate
pnpm run db:seed      # creators, tenants, courses, tiered products, members with varied grants
pnpm run build:web
pnpm run dev:server   # API + SPA on http://localhost:48730
```

Dependencies live in this checkout's pnpm-linked `app/node_modules` tree. The
former tracked symlink to another checkout's shared `node_modules` has been
removed; run the frozen install separately in each checkout.

The dev server serves the built SPA from `dist/web`, not directly from
`apps/web/src`. `pnpm run dev:server` and `pnpm run db:reseed` compare mtimes and
rebuild a stale bundle automatically. After pulling changes, run
`pnpm run build:web` before starting the server if you use another entry point.

Transactional mail uses the database-backed development sink by default.
To exercise the real SMTP adapter, select `EMAIL_PROVIDER=smtp` as described in
[ADR-0007](docs/decisions/0007-local-mailpit.md), then inspect captured messages
at `http://localhost:48980`.

Open **http://studio.localhost:48730** and **http://acme.localhost:48730** —
sign in as `creator@together.dev` / `demo1234` on studio, or
`creator2@together.dev` / `demo1234` on acme. Each tenant domain opens the panel
with its own isolated courses, products and members; branding (logo, accent
color) is per tenant too — in the seed only `akademia` is branded. Note: on
`localhost` browsers reject cross-subdomain cookies, so you sign in per tenant
domain; on a real base domain one session spans all tenant subdomains.

## Demo data

`pnpm run db:seed` provisions a rich, idempotent demo dataset (deterministic ids
throughout, e.g. `course-js`, `lesson-js-zmienne-1`) meant for manually testing
feature parity. Re-running the seed never duplicates anything.
`pnpm run db:reseed` restores a pristine demo before audits/demos: it wipes all
data in the three demo tenants (studio/acme/akademia) — including any leftovers
and mutated progress from previous sessions — and re-runs the seed, leaving
exactly the canonical state. Other tenants (e.g. imported ones) are untouched.

**Tenants and owners** (owners sign in with password `demo1234`):

| Tenant     | Subdomain                        | Owner                     |
| ---------- | -------------------------------- | ------------------------- |
| Studio Demo | http://studio.localhost:48730   | `creator@together.dev`    |
| Acme Courses | http://acme.localhost:48730    | `creator2@together.dev`   |
| Akademia Samouka | http://akademia.localhost:48730 | `creator3@together.dev` |

**Courses**

- **Studio** — `Kurs JavaScript od podstaw` (`course-js`): 3 modules with legacy
  prefixes (`Część 1 - Podstawy` → 2 chapters, `Część 2 - DOM`, `Część 3 -
  Projekty`); `React w praktyce` (`course-react`): 2 modules. Lessons mix
  `embed` (YouTube-nocookie), `html` (Polish teaching prose), `link` and `pdf`
  blocks.
- **Akademia** — `Samodzielna nauka programowania` (`course-akademia`): 2 modules.
- **Acme** keeps its original walking-skeleton data untouched.

**Product tiers (Studio)** — all published, price in PLN grosze:

| Product                          | Price   | Access level                                    |
| -------------------------------- | ------- | ----------------------------------------------- |
| `Kurs JavaScript - pełny dostęp` | 39900   | course-level → `course-js`                      |
| `React w praktyce - pełny dostęp`| 49900   | course-level → `course-react`                   |
| `Pakiet: moduł DOM`              | 9900    | module-level → only the DOM module of `course-js` |
| `Free preview`                   | 0       | lesson-level → one lesson from every module of both courses |

Akademia offers `Akademia - dostęp roczny` (29900, course-level).

**Members** — sign in **passwordlessly via magic link** (CLI `login-magic
--email <e>`, or a checkout). Their grants exercise every access edge state:

| Member                          | Tenant   | Grant                          | What they see                                                  |
| ------------------------------- | -------- | ------------------------------ | ------------------------------------------------------------- |
| `kursant.aktywny@together.dev`  | studio   | perpetual → JS course          | `course-js` fully-accessible, partially-completed (2 lessons done + last-viewed) |
| `kursant.wygasly@together.dev`  | studio   | JS course, **expired 7d ago**  | course **absent** from `student courses`; structure `not-accessible` |
| `kursant.przyszly@together.dev` | studio   | JS course, **starts in 7d**    | course **absent** (grant not yet active); structure `not-accessible` |
| `kursant.modul@together.dev`    | studio   | active → DOM module pack        | `course-js` partially-accessible (only DOM module unlocked)   |
| `free@together.dev`             | studio   | active → Free preview           | both courses partially-accessible (one lesson per module)     |
| `kursant.akademia@together.dev` | akademia | active, expires in ~330d        | `course-akademia` fully-accessible, 1 lesson completed        |

The "absent vs. not-accessible" behaviour reflects `listMyCourses` semantics: it
lists only courses whose access status (computed from **active** grants) is not
`not-accessible`, so expired and future grants drop the course from the list
entirely, while `student structure <courseId>` still resolves it as
`not-accessible`.

## CLI — the agent feedback loop

```bash
pnpm --silent run cli login --email creator2@together.dev --password demo1234
pnpm --silent run cli tenant list
pnpm --silent run cli tenant switch acme
pnpm --silent run cli product list
pnpm --silent run cli --tenant acme course list
pnpm --silent run cli --json whoami        # single JSON document on stdout
```

Every command supports `--json` and exits with a code mapped from the error
taxonomy (`validation`=2, `unauthorized`=3, `forbidden`=4, `not_found`=5,
`conflict`=6, `tenant_not_found`=7, `internal`=10). That makes the CLI a
deterministic verification loop for AI agents — and the reference client.

## Marketing e-mail

Marketing delivery uses a BYO-SES model: every tenant connects its own Amazon
SES account, while Together enforces consent, suppression, unsubscribe, sender
identity, throttling, and send logging. Multi-step automations are intentionally
orchestrated in n8n or Make through the M2M API; there is no native drip builder
by design. See the [marketing automation API guide](../docs/marketing-automation-api.md)
and its ready-made n8n and Make scenarios. Tenant setup, the ready-to-paste AWS
production-access answers, and transactional SMTP fallbacks are in the
[SES onboarding guide](../docs/ses-onboarding.md).

## Architecture in one screen

```
core/domain     entities, Result, error taxonomy          → zod only
core/contract   API routes + schemas (single source)      → domain
core/server     use-cases + ports (interfaces)            → domain
core/client     typed HTTP client + query definitions     → contract
adapters/db     Drizzle repos, driver factory (pg|neon)   → implements ports
adapters/auth   Better Auth (server + client adapter)     → implements ports
apps/server     Hono wiring + composition root            → the only place adapters are instantiated
apps/web        React SPA (Vite, TanStack Router/Query)   → core/client only
apps/cli        commander commands                        → core/client only
```

Rules are **machine-enforced**: `eslint-plugin-boundaries` + `dependency-cruiser`
fail the build on any cross-layer import, on `@vercel/*`/`@neondatabase/*`
outside `adapters/`, and on any framework import inside `core/`. `any` and
type assertions (`as`, except `as const`) are lint errors.

```bash
pnpm run check   # typecheck + lint + dependency graph + tests — the static gate
pnpm run smoke   # runtime gate: fresh DB, real server boot, CLI roundtrip
```

The Vitest projects currently discover <!--count:test-files-->240<!--/count-->
test files across the Node and browser suites.

## Tenant resolution

Per request: (1) exact custom-domain match in `tenant_domains`,
(2) subdomain of `APP_BASE_DOMAIN` (subdomain = org slug),
(3) `X-Tenant` header (CLI), (4) the sole tenant when `APP_BASE_DOMAIN` is
unset. An unknown supplied subdomain or header is rejected instead of falling
back to the single-tenant target. Membership is verified in every case; every
tenant-scoped use-case takes `ctx.identity` and every repository call requires
`tenantId`. Tenant lifecycle status and plan are migration-managed in this
phase; no application write surface is exposed yet.

## Community

Lesson discussions are the first Community (Faza 2) slice:

- **Discussions under lessons** — context-generic posts (`contextKind:
  'lesson'` today, spaces later) with nested replies capped at depth 3,
  author edit + soft delete ("Wpis usunięty" placeholder keeps thread shape),
  and staff moderation (staff can delete any post; staff posts carry the
  "Autor" badge).
- **Visibility = lesson entitlement** — you read, search and write a lesson's
  discussion iff that lesson is fully accessible to you (staff always).
  Free-preview lessons deliberately have open discussions — the community
  teaser for the book funnel.
- **Search** — Postgres full-text (`tsvector` GIN, `simple` config) over post
  bodies, entitlement-filtered server-side; the course page groups hits by
  lesson.
- **Subscriptions & notifications** — authors and repliers auto-follow their
  thread, with an explicit follow/mute toggle. A reply fans out `thread-reply`
  notifications to subscribers (minus the reply author) through
  `NotificationChannelPort`: **in-app** (row + realtime bus → the bell badge)
  and **e-mail** today; **web push later is just another adapter** on the same
  port — no redesign needed.
- **Realtime with a fallback** — the in-app channel streams over SSE and the
  browser falls back to polling on serverless (details in
  [Realtime](#realtime) below).

The seed plants a Polish demo discussion under `course-js` lessons
(`lesson-js-zmienne-1`, `lesson-js-dom-1`), including a creator answer and a
deleted-post placeholder, plus one unread notification for
`kursant.aktywny@together.dev` — the bell shows a badge on first login.

```bash
pnpm --silent run cli --tenant studio discussion list --lesson lesson-js-zmienne-1
pnpm --silent run cli --tenant studio discussion search --query const
pnpm --silent run cli --tenant studio notifications list
```

## Realtime

In-app notifications stream over Server-Sent Events: an authenticated,
tenant-scoped `GET /api/notifications/stream` sends the unread count on
connect, then pushes each new notification for that recipient as it is
delivered (with a heartbeat comment every 25 s). The web app keeps its
TanStack Query caches fresh from this stream and never renders stream
payloads directly.

The stream requires a long-lived Node process. On serverless deployments
(function duration limits cut idle connections), the browser wrapper detects
the failing stream and transparently falls back to 30-second polling of the
same notification endpoints — no server-side configuration needed.

E-mail delivery of thread replies rides the same notification-channel port and
is toggled with `NOTIFY_EMAIL` (see `.env.example`).

## S3-compatible storage

The integrations panel walks the tenant owner through provider choice,
connection fields and a live probe that writes, reads back and deletes one
scratch object before the configuration is encrypted as the `s3.configuration`
tenant secret. AWS S3, Cloudflare R2, Backblaze B2 and MinIO are covered by
per-provider key instructions in the wizard. The same two steps are available
from the CLI:

```bash
pnpm --silent run cli --tenant studio storage probe --provider minio \
  --endpoint http://localhost:9000 --region us-east-1 --bucket studio-files \
  --access-key-id '<id>' --secret-access-key '<secret>'
pnpm --silent run cli --tenant studio storage configure --provider minio \
  --endpoint http://localhost:9000 --region us-east-1 --bucket studio-files \
  --access-key-id '<id>' --secret-access-key '<secret>'
```

`pnpm run e2e:storage` runs the probe and its failure paths against a throwaway
MinIO container; point `STORAGE_E2E_*` at a real bucket to run the same
verification against a provider account. Runtime probes reject loopback,
link-local and private-network endpoints by default. Self-hosted MinIO on a
trusted private network requires `STORAGE_ALLOW_PRIVATE_ENDPOINTS=true`.

## Stripe test mode

Set `PAYMENT_PROVIDER=stripe`, sign in as the tenant owner, open **Integrations →
Stripe**, and save the tenant's `rk_test_…` restricted key. Together detects the
mode from the prefix, registers the tenant webhook through Stripe, and stores
the returned signing secret encrypted without adding either credential to an
env file or Git. Headless deployments can perform the same setup through the
CLI. Then verify the connection:

```bash
pnpm --silent run cli --tenant studio stripe configure rk_test_…
pnpm --silent run cli --tenant studio stripe test-connection
```

The restricted key needs write access to Checkout Sessions, Coupons, Promotion
Codes, Subscriptions, and Webhook Endpoints. Together enables the event set it
handles when creating the endpoint. For localhost without a public callback,
the Stripe CLI can still forward events:

```bash
stripe listen --events checkout.session.completed --forward-to http://localhost:48730/api/webhooks/stripe/<tenant-id>
```

Open a published product's `/checkout/<product-id>` page and pay with a Stripe
test card. The browser return page only shows status; the signed webhook creates
or renews access and sends the welcome magic link.

Checkout supports one-time and recurring prices. Stripe subscription webhooks
renew access, handle payment failures, and end grants when subscriptions are canceled.

## Ports

| service | port |
|---|---|
| API + SPA | 48730 |
| Vite dev | 48731 |
| Postgres (Docker) | 48912 |

## License

Together is Fair Source software available under
[FSL-1.1-ALv2](../LICENSE.md). The license grants use, modification, and
redistribution for any purpose other than a Competing Use, and names internal
use and access as a Permitted Purpose, so self-hosting Together for your own
organization or community is allowed. A Competing Use — making Together, or
substantially similar functionality based on it, available to others in a
commercial product or service — is not. Each release automatically becomes
available under Apache-2.0 two years after that release is made available.
Read [LICENSE.md](../LICENSE.md) for the terms that govern.

Learn more at [fsl.software](https://fsl.software/) and
[fair.io](https://fair.io/).
