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
[Local Mailpit](docs/local-mailpit.md), then inspect captured messages
at `http://localhost:48980`.

Open **http://studio.localhost:48730** and **http://acme.localhost:48730** —
sign in as `creator@together.dev` / `demo-password-15` on studio, or
`kontakt+smoke-creator@togethercommunity.app` / `demo-password-15` on acme.
Each tenant domain opens the panel with its own isolated courses, products and
members; branding (logo, accent color) is per tenant too — in the seed only
`akademia` is branded. Note:
on `localhost` browsers reject cross-subdomain cookies, so you sign in per
tenant domain; on a real base domain one session spans all tenant subdomains.

## Demo data

`pnpm run db:seed` provisions an idempotent English demo dataset with deterministic
IDs such as `course-js` and `lesson-js-variables-1`. Re-running the seed never
duplicates anything. All three demo tenants use English as their default language.
`pnpm run db:reseed` restores a pristine demo before audits and demonstrations:
it wipes data in studio, acme, and akademia, including leftover records and changed
progress, then re-runs the seed. Other tenants are untouched.

**Tenants and owners** (owners sign in with password `demo-password-15`):

| Tenant | Subdomain | Owner |
| --- | --- | --- |
| Studio Demo | http://studio.localhost:48730 | `creator@together.dev` |
| Acme Courses | http://acme.localhost:48730 | `kontakt+smoke-creator@togethercommunity.app` |
| Akademia Samouka | http://akademia.localhost:48730 | `creator3@together.dev` |

**Courses**

- **Studio** — `JavaScript from Scratch` (`course-js`): 3 modules with prefixes
  (`Part 1 - Basics`, with 3 chapters; `Part 2 - DOM`; `Part 3 - Projects`).
  `React in Practice` (`course-react`) has 2 modules: `Part 1 - Fundamentals`
  and `Part 2 - Advanced patterns`.
- **Akademia** — `Learning to Code on Your Own` (`course-akademia`): 2 modules,
  `Part 1 - Learning from scratch` and `Part 2 - Practice`.
- **Acme** — `Acme Course` (`course-acme`): one introductory module and lesson
  for smoke testing.

Lessons combine Bunny Stream video, YouTube-nocookie embeds, English HTML teaching
content, resource links, and PDF attachments. The tiny English PDF at
`apps/web/public/assets/sample-lesson.pdf` is served from `/assets/sample-lesson.pdf`
on the same origin so it can be displayed inline. Regenerate it with
`pnpm exec tsx scripts/make-sample-pdf.ts`.

**Product tiers (Studio)** — published products, prices in PLN minor units:

| Product | Price | Access |
| --- | --- | --- |
| `JavaScript Course - full access` | 39900 | All of `course-js` |
| `React in Practice - full access` | 49900 | All of `course-react` |
| `DOM Module Pack` | 9900 | Only the DOM module of `course-js` |
| `Free preview` | 0 | One lesson per module in both courses, plus the video demo |
| `Studio Club - subscription` | 4900 monthly / 49900 yearly | Both courses while the subscription is active |
| `Creator Workbook` | 7900 | A downloadable workbook |
| `Together 101 Course` | 19900 | A starter product with no course access items |

`Scenario Workshop` (`product-studio-workshop`, slug `workshop-scenario`) is an
unpublished product priced at 49900. `Together 101 Course` uses ID
`product-studio-course-101` and checkout slug `course-together-101`.
Akademia offers `Akademia - annual access` (29900, all of `course-akademia`),
and Acme offers `Acme Course` (9900). Studio also includes paid and failed orders,
monthly subscription renewals, and a `PARTNER20` coupon with a 20% discount.

**Members** — sign in **passwordlessly via magic link** (CLI `login-magic
--email <e>`, or a checkout). Their grants exercise the access states:

| Member | Tenant | Grant | What they see |
| --- | --- | --- | --- |
| `student.active@together.dev` | studio | Perpetual JS access, active club subscription, and workbook | Both courses accessible; JS has 2 completed lessons and a last-viewed lesson |
| `student.expired@together.dev` | studio | JS access expired 7 days ago | Course absent from `student courses`; structure `not-accessible` |
| `student.future@together.dev` | studio | JS access starts in 7 days | Course absent until the grant starts; structure `not-accessible` |
| `student.module@together.dev` | studio | Active DOM Module Pack | Only the DOM module unlocked |
| `free@together.dev` | studio | Active Free preview | Sample lessons in both courses; community posting is banned for repeated advertising |
| `student.subscriber@together.dev` | studio | Active simulated monthly club subscription | Both courses accessible |
| `student.akademia@together.dev` | akademia | Active annual access, expires in about 330 days | Akademia course accessible, with 1 completed lesson |

The "absent vs. not-accessible" behavior reflects `listMyCourses`: it lists only
courses accessible through active grants. Expired and future grants drop the
course from that list, while `student structure <courseId>` still resolves it as
`not-accessible`.

**Community and supporting content** — English discussions under
`lesson-js-variables-1` and `lesson-js-dom-1` include student questions, creator
replies, and a deleted-post placeholder. `student.active@together.dev` starts with
one unread reply notification. The public `Community` space (`space-studio-community`,
slug `community`) is the Studio home space. `JavaScript Club` and `React Club`
are product-gated spaces. Seeded posts include introductions, learning resources,
and a coding challenge, with reactions, follows, and an open moderation report.
Akademia includes a published English privacy policy at slug `privacy-policy`,
plus consent records and email preferences. Studio includes marketing campaigns,
delivery events, and an English transactional outbox sample.

## CLI — the agent feedback loop

See [CLI usage](docs/cli.md) for lesson preview controls and the parity inventory.
Read-only tenant API keys support [activity reports](docs/reports-api.md) through
the API and CLI without database role changes.

```bash
pnpm --silent run cli login --email kontakt+smoke-creator@togethercommunity.app --password demo-password-15
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
core/domain          entities, Result, error taxonomy          → zod only
core/contract        shared API routes + schemas               → domain
core/server          use-cases + ports (interfaces)            → domain
core/client          typed HTTP client + query definitions     → contract, domain
adapters/db          Drizzle repos, PostgreSQL runtime         → implements server ports
adapters/auth        Better Auth (server + client adapter)     → implements ports
apps/server          Hono wiring + runtime composition         → domain, contract, server, adapters
apps/web             React SPA (Vite, TanStack Router/Query)   → client, contract, domain, auth adapter
apps/cli             commander commands                        → client, contract, domain, auth adapter
api/                 Vercel function entry points              → apps/server platform entry
packages/client-sdk  typed API client package                  → client, contract, domain, auth adapter
config-regression/   architecture gate regression probes       → enforcement configuration
scripts/             gates, e2e drivers, operational tools     → verification and operations
```

`eslint-plugin-boundaries` and `dependency-cruiser` enforce the configured
import directions and external dependency allowlists. Clients cannot import
`core/server` or database adapters. `@vercel/*` and `@neondatabase/*` are confined
to adapters and the reviewed `apps/server/src/entry.vercel.ts` boundary.
Framework imports in core, `any`, and type assertions other than `as const`
are prohibited.

`composition.ts` wires server adapters and delegates realtime selection and
construction to `realtime-transport.ts`. The web API module and CLI context
construct auth client adapters; operational scripts also compose adapters.
The gates constrain imports, not exclusive adapter construction. The DB factory
retains both driver branches, but `apps/server/src/env.ts` accepts only
`node-postgres` because runtime repositories require interactive transactions.

- `pnpm run check` = `typecheck` + `typecheck:islands` + `lint` + `lock-lint` +
  `license-lint` + `migration-lint` + `tenant-scope-check` + `tenant-neutral-lint` +
  `depcruise` + `knip` + `doc-lint` + `test` —
  the **static** gate.
- `pnpm run smoke` is the runtime gate: a fresh isolated database, real server
  boot, and CLI roundtrips.

```bash
pnpm run check
pnpm run smoke
```

In `.github/workflows/ci.yml`, `check` also runs the production dependency audit.
The `smoke` job runs `smoke` and `quickstart:probe`; the macOS `visual` job runs
`visual`, which builds Storybook before comparing captures. The twelve e2e
matrix suites are `auth`, `poc`, `subs`, `marketing`, `coupon`, `public-authz`,
`member-activity`, `member-shell`, `impersonation`, `two-factor`, `image-assets`,
and `custom-domain`. The `auth` job also runs `fixtures:check` and `visual:app`.
`e2e:storage`, `e2e:ksef`, and coverage scripts exist but are not run by this
workflow. These gates run for pushes and pull requests targeting `main` and
`staging`.

The Vitest projects currently discover <!--count:test-files-->454<!--/count-->
test files across the Node and browser suites.

## Tenant resolution

Per request: (1) exact custom-domain match in `tenant_domains`,
(2) subdomain of `APP_BASE_DOMAIN` (subdomain = org slug),
(3) `X-Tenant` header (CLI), (4) the sole tenant when `APP_BASE_DOMAIN` is
unset. An unknown supplied subdomain or header is rejected instead of falling
back to the single-tenant target. Owners connect their own domains from
**Settings → Addresses**; see the [custom domains guide](docs/custom-domains.md)
for the provider keys and the manual mode self-hosted installs run on.
Tenant resolution selects an active tenant without checking membership; public
reads and checkout use that resolution too. Authenticated operations authorize
through `core/server/authorize.ts` and the implemented default-deny capability
matrix in `core/domain/authorization.ts`, with membership and entitlement
checks where required. `Ctx` entry points carry identity; public checkout,
terms-consent helpers, and Stripe webhook processing instead take explicit
tenant inputs. The permission inventory covers exported `Ctx` functions, not
every function in the use-case directory. Tenant-scoped repository operations
require `tenantId`, with named platform exceptions in the tenant-scope checker.
Tenant lifecycle status and plan are migration-managed in this phase; no application write surface is exposed yet.

## Community

Lesson discussions are the first Community (Phase 2) slice:

- **Discussions under lessons** — context-generic posts (`contextKind:
  'lesson'` today, spaces later) with nested replies capped at depth 3,
  author edit + soft delete ("Deleted post" placeholder keeps thread shape),
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

The seed plants an English demo discussion under `course-js` lessons
(`lesson-js-variables-1`, `lesson-js-dom-1`), including a creator answer and a
deleted-post placeholder, plus one unread notification for
`student.active@together.dev` — the bell shows a badge on first login.

```bash
pnpm --silent run cli --tenant studio discussion list --lesson lesson-js-variables-1
pnpm --silent run cli --tenant studio discussion search --query const
pnpm --silent run cli --tenant studio notifications list
```

## Realtime

In-app notifications stream over Server-Sent Events: an authenticated,
tenant-scoped `GET /api/notifications/stream` opens with `retry: 1000` and the
unread count, then pushes each new notification or direct message for that
recipient as it is delivered, with a heartbeat comment every 10 s. Every
realtime chunk carries an `id:` of `createdAt|entityId`. The stream closes
itself after 25 s, below the 30 s serverless function cap, and the browser
reconnects with `Last-Event-ID`; the server replays what the client missed
from the persisted notification and conversation tables (up to 20 of each).
The web app keeps its TanStack Query caches fresh from this stream and never
renders stream payloads directly.

`REALTIME_TRANSPORT` selects the bus behind the stream: `pg` (default) fans
events out across instances over Postgres `LISTEN`/`NOTIFY` with
identifier-only payloads, `in-process` keeps them inside a single process. The
`pg` listener needs a direct, non-pooled connection — see
`REALTIME_DATABASE_URL` in `.env.example`.

When the stream itself is unusable — no `EventSource`, repeated errors, or
connections the host keeps cutting short of the rotation — the browser wrapper
falls back to 30-second polling of the same notification endpoints, with no
server-side configuration needed.

E-mail delivery of thread replies rides the same notification-channel port and
is toggled with `NOTIFY_EMAIL` (see `.env.example`).

## S3-compatible storage

The integrations panel walks the tenant owner through provider choice,
connection fields and a live probe that writes, reads back and deletes one
scratch object before the configuration is encrypted as the `s3.configuration`
tenant secret. AWS S3, Cloudflare R2, Backblaze B2 and MinIO are covered by
per-provider key instructions in the wizard. This is the only way in: the
generic tenant-secrets endpoint rejects every `s3.*` key, so no storage
credential is stored without a passing probe. The same two steps are available
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
MinIO container using the image pinned in `scripts/test-images.ts`; point
`STORAGE_E2E_*` at a real bucket to run the same verification against a provider
account. Runtime probes reject loopback,
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

Open a published product's `/checkout/<product-slug-or-id>` page and pay with a Stripe
test card. The browser return page only shows status; the signed webhook creates
or renews access and sends the welcome magic link.

Checkout supports one-time and recurring prices. Stripe subscription webhooks
renew access, handle payment failures, and end grants when subscriptions are canceled.

## Versioning

The version every surface reports is counted from the commit graph at build
time — MINOR per production promotion, PATCH per pull request merged since it.
See the [versioning guide](docs/versioning.md).

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
