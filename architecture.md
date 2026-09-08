# Together architecture

This document defines Together's system boundaries, vocabulary, and architecture
rules. Together combines digital product sales, marketing, course delivery,
and community with creator-owned storage and payment accounts; authentication
is shared globally while member relationships and data remain tenant-scoped.
Foundation provenance and divergences from agentproofarch are recorded in
[FOUNDATION.md](FOUNDATION.md).

## System shape

Together is a multi-tenant TypeScript application with four core layers,
infrastructure adapters, and three application entry surfaces:

```text
apps/web ──→ core/client ──→ core/contract ←── apps/server
apps/cli ──→ core/client                         │
                                                ↓
core/domain ←── core/server ←── adapters ←── composition root
```

The arrows describe allowed knowledge, not every runtime call. The server
composition root instantiates adapters and supplies them to use-cases.
`core/server` does not import `core/contract`; HTTP translation stays in the
application boundary. The web and CLI clients do not import server use-cases or
database adapters.

The source tree has these responsibilities:

| Path | Responsibility |
|---|---|
| `app/core/domain` | Entities, schemas, domain rules, lifecycle transitions, and the closed error taxonomy. |
| `app/core/server` | Use-cases and infrastructure ports. It returns domain `Result` values and knows no transport or framework. |
| `app/core/contract` | HTTP paths, envelopes, status mappings, and transport schemas shared by server and clients. |
| `app/core/client` | Typed API actions and TanStack query/mutation descriptors. |
| `app/adapters` | Database, auth, encryption, email, payment, storage, video, and provisioning implementations of ports. |
| `app/apps/server` | Environment parsing, composition, identity resolution, HTTP routes, and process entry. |
| `app/apps/cli` | A thin API client and the primary exact feedback surface for agents. |
| `app/apps/web` | The React application: routes, isolated features, layout skeletons, UI primitives, and theme. |
| `app/api/` | Vercel function entry points delegating to the server platform entry, including the platform-reset function. |
| `app/packages/client-sdk` | Typed client SDK packaging for core client, contract, domain, and the headless auth adapter. |
| `app/config-regression` | Regression probes for architecture and enforcement configuration. |
| `app/scripts` | Gates, migration and seed entry points, e2e drivers, import tools, and operational probes. |

`app/apps/server/src/composition.ts` wires runtime server adapters and delegates
realtime selection and construction to `realtime-transport.ts`. The web API
module and CLI context construct auth client adapters; operational scripts also
compose adapters. Import gates do not enforce a sole construction site.
Provider SDKs stay behind adapter ports. Framework and persistence types do not
cross into core.

## Vocabulary

The following words have precise meanings in this repository. A business domain
and a frontend feature are related, but they are not synonyms.

| Term | Meaning |
|---|---|
| **Domain** | A business subdomain such as products, learning, commerce, community, marketing, or invoicing. |
| **`core/domain`** | The single shared language layer for all domains: pure entities, zod schemas, rules, transitions, and errors. |
| **Feature** | A vertical UI slice under `apps/web/src/features/<name>/`. A broad feature may present several business domains. |
| **Island** | A feature viewed through its isolation guarantee: it cannot import another feature directly. |
| **View** | A React component inside a feature. It renders state and invokes that feature's actions or descriptors. |
| **Island core** | A pure-TypeScript module under `features/<name>/core/`. The checkout core implements local state and event reduction; ESLint and dependency-cruiser enforce its framework and portability boundaries. |
| **Machine** | The state implementation inside an island core. The ladder is descriptor re-exports, then an island store, then a statechart derived from a domain transition table. A feature climbs only when the previous rung is insufficient. |
| **Descriptor** | A typed query or mutation definition produced through `core/client`; it is the seam between server state and React Query. |
| **Bus** | A closed union of client-only ephemeral signals between island cores. Views never publish or consume it directly. The server-side notification channel and SSE fan-out are separate mechanisms. |
| **Port** | An interface owned by `core/server` for an infrastructure capability that can vary by provider or platform. |
| **Vocabulary dependency** | A library that extends the language of a layer, such as zod or TanStack Query. It is imported directly only where explicitly allowlisted. |
| **Projection** | The current queryable state of a lifecycle-bearing record. |
| **Event** | An immutable, ordered fact explaining a lifecycle transition. |

Frontend server state belongs in descriptors. Local component state stays local.
Cross-feature coordination uses server state, the URL, a route parent, or a
typed bus once an island-core use case proves the need. Features never coordinate
through sibling imports or an untyped global event channel.

## Layer rules

The foundation is ports-and-adapters with a deliberately strict dependency
graph:

- `core/domain` depends only on its explicitly allowlisted vocabulary.
- `core/server` depends on `core/domain`, never on `core/contract`, clients,
  adapters, applications, or frameworks.
- `core/contract` depends on `core/domain`, never on server use-cases.
- `core/client` depends on domain and contract and never on server or adapters.
- Adapters may depend inward on core and never outward on applications.
- Web and CLI are clients. They cannot reach database, provisioning, or server
  internals.
- `@vercel/*` and `@neondatabase/*` are confined to adapters and the reviewed
  `app/apps/server/src/entry.vercel.ts` platform boundary, as configured in
  ESLint and dependency-cruiser.

External dependencies are default-denied by ESLint boundaries and
dependency-cruiser. Each layer has an explicit allowlist. Adding a package
therefore requires both a dependency decision and a graph decision; installing
it is not sufficient authorization to import it.

Boundary values are parsed with zod. `any` and type assertions other than
`as const` are forbidden. Use-cases return `Result<T, AppError>` and do not
throw across a boundary. New errors extend the closed taxonomy and receive
exhaustive HTTP-status and CLI-exit-code mappings. Together retains its own
error-code set and numbering.

## Request and composition flow

The Node entry parses the environment and starts the Hono application. The
composition root selects adapters, constructs repositories and external
transports, and injects them into route handlers and background dispatchers.

For an authenticated request:

1. The server resolves the user session.
2. Host or tenant-header resolution selects the tenant.
3. Identity resolution produces user, tenant, staff-role, and member context.
4. The route parses transport input and invokes a use-case.
5. The use-case authorizes against the identity and calls tenant-scoped ports.
6. The route converts the `Result` into the shared contract envelope.

The CLI and web app both use `core/client`. This makes the CLI a real contract
consumer rather than a privileged backdoor and is why it is the default
verification surface.

## Tenancy and authorization

Tenant identity is resolved at the server edge, but isolation is enforced again
inside the application:

- Authenticated application entry points receive `ctx: Ctx`. Public checkout,
  terms-consent helpers, and Stripe webhook processing instead accept explicit
  tenant inputs without `Ctx`.
- Tenant-scoped repository operations require `tenantId`; named platform
  exceptions are recorded in `app/scripts/tenant-scope-check.ts`.
- A tenant identifier supplied by a caller never substitutes for the tenant in
  the authenticated identity.
- Staff-only operations require a staff role; owner-only integration and secret
  operations require `owner`.
- Member reads are constrained by membership and entitlement, including
  product-gated learning and community access.
- Worker identities are explicit and tenant-scoped; they do not become
  unrestricted application identities.

Authorization uses a central default-deny capability model, with tenant and
entitlement checks enforced in use-cases. New use-cases must fail closed and
include cross-tenant tests; the generated [permission table](app/docs/permission-table.md)
records the enforced capabilities.

Lesson discussion reads, search, and writes require lesson entitlement; space
feeds require membership or an active product grant, and archived spaces are
hidden from members. Authors can edit or soft-delete their own posts, while
staff can delete any post without breaking thread structure.
User-facing terminology follows the
[terminology glossary](app/docs/terminology-glossary.md).

## Data lifecycle

Lifecycle-bearing records use a current-state projection plus append-only
events by default:

- The projection supports lists, filters, deduplication, and current decisions.
- Events preserve the immutable ordered history.
- A transition that changes both is persisted atomically by the repository.
- Events are not edited or deleted except by an explicit retention or erasure
  policy.
- External identifiers and idempotency keys are persisted so provider retries
  do not duplicate business effects.

This convention governs the following durable workflows:

- Orders form the sales ledger; paid subscription periods renew grants through
  the period end plus a three-day grace window. Webhook processing deduplicates
  both provider events and business objects.
- Coupon redemptions use projections and append-only events, while revenue
  attribution is queried from orders. Price changes append history from which
  the lowest price over the preceding thirty days is derived.
- Consent records preserve the wording version and timestamped evidence;
  campaigns and deliveries keep durable state and events. Every marketing send
  rechecks current consent and suppression, so late withdrawals take effect.
- Paid orders retain immutable billing snapshots, and invoices use projections
  plus events. Direct KSeF submission freezes canonical XML and its hash before
  asynchronous delivery and retains provider references for recovery.

Scheduler runs are operational telemetry, not lifecycle projections. A run is
finalized once from `running` to `completed` or `failed`; its per-tenant result
rows are written during finalization and are not mutated afterward.

Erasure is policy-aware rather than a blind cascade. Product data that may be
removed or pseudonymized follows the relevant retention flow. Fiscal records
and immutable compliance evidence remain when their legal retention basis
requires it. The retained-data policies and operational removal path are
documented in [app/docs/member-erasure.md](app/docs/member-erasure.md).

## Transactions and external effects

Atomicity is owned by adapter methods that implement a business operation, not
by HTTP handlers. When a command must update a projection and append an event,
or create several rows that form one invariant, the database adapter exposes
one port operation and performs one transaction.

Money is represented as integer minor units. Orders are the sales ledger and
the source of truth for revenue and coupon attribution. Payment and webhook
handlers are idempotent by provider event and business-object identity.
Subscription access is checked at read time from grants and their expiry;
cancellation stops renewal without cutting off the already-paid period and
its grace window.

External calls cannot participate in a database transaction. Durable workflows
therefore persist intent and checkpoints before or after the call as the domain
requires, then retry from stored state. KSeF additionally freezes canonical XML
and its hash before submission and treats ambiguous duplicates as a conflict
for recovery, not permission to invent a new invoice number.

Runtime repositories require interactive transactions, so deployments use
`DB_DRIVER=node-postgres` and reject `neon-http` at boot. The
[atomicity reference](app/docs/data-atomicity.md) records the operations that
must commit as one unit.

## Public surfaces and caching

Together intentionally serves tenant public surfaces. These include published
offers and checkout, consent and unsubscribe flows, hosted legal documents,
tenant marketing pages, and provider webhooks. This is a deliberate divergence
from the upstream headless-only public surface.

Public reads resolve the tenant from the host or the explicit tenant header.
Successful public JSON responses use public revalidation semantics with ETags
where available and vary by host and tenant header. Public errors and
identity-bearing responses are `no-store`. Confirmation and preference pages
are also `no-store`. Versioned legal documents are immutable domain records even
when transport caching remains conservative.

Cache changes are contract changes. A route may become publicly cacheable only
when its response is independent of session identity, its tenant varies are
correct, and errors cannot poison a shared cache. Authenticated, member,
checkout-state, and secret-bearing responses never enter a shared cache.

Public consent pages refer to immutable wording and legal-document versions;
an unsubscribe GET displays preferences, while an explicit POST changes consent.
Checkout offers the product's active one-time or recurring prices and shows the
validated discount breakdown and lowest-thirty-day price when a coupon applies;
coupon attribution follows paid orders without tracking cookies.

## Security baseline

The present baseline is defense in depth at typed and runtime boundaries:

- Authentication is isolated behind the auth adapter; clients do not spell
  provider routes or import provider SDKs.
- Auth POSTs require a trusted origin. Cookie security is environment-driven,
  and production refuses development secret defaults.
- Tenant BYO credentials are encrypted at rest and resolved by tenant through
  narrow ports. Secret values do not enter domain objects or client contracts.
- Request, provider, environment, import, and persisted JSON shapes are parsed
  before use.
- Sensitive and identity-bearing responses use `no-store`.
- Development payment and magic-link routes are disabled unless their explicit
  development toggles are enabled.
- Vendor SDK imports and platform imports are confined to reviewed adapters.
- Marketing suppression, consent, unsubscribe, and provider-webhook checks are
  server-side responsibilities, not UI conventions.

The HTTP edge applies security headers, CSP, body limits, CORS, and CSRF
controls, with explicit public-route manifests that fail validation when an
unlisted public mutation is added. The [security reference](app/docs/security.md)
and [route table](app/docs/route-table.md) describe the current controls and
exposed routes.

## Web architecture

Routes are thin and features own product UI. Features are islands: one feature
cannot import another. Shared code moves down into `components/ui`, `lib`,
`core/client`, or a deliberately shared route parent.

`apps/web/src/components/layout` owns reusable page skeletons. Layouts are
structure-only and may not import features, routes, API bindings, i18n, core, or
adapters. Together deliberately keeps this rule stricter than upstream.
Features provide content through slots. Loading, error, empty, and not-found
branches render inside the owning skeleton so page geometry stays stable.

Visual values belong to the theme system. The `sx` rule reserves layout and
visual structure according to a shrink-only baseline. A new violation is fixed;
the baseline is never regenerated merely to absorb it. Shared page skeletons
and layout primitives own geometry, while `theme.ts` owns visual tokens and
component overrides; features fill slots and keep state branches inside the
same skeleton. Create flows and lesson editing use dedicated routes, buttons
use sentence case, and mobile-first layouts receive both mobile and desktop
visual coverage.

`app/apps/web/src/features/checkout/core/` contains checkout state, events, and
a reducer for price selection and coupon state. ESLint classifies it as an
island core; dependency-cruiser enforces the framework-agnostic and portable
boundaries. `typecheck:islands` checks the island TypeScript configuration.
Server state remains in typed descriptors; trivial view state remains in React.

## Gates

Architecture is enforced by configuration and executable probes:

| Gate | Guarantee |
|---|---|
| `pnpm run check` | `typecheck`, `typecheck:islands`, `lint`, `lock-lint`, `license-lint`, `migration-lint`, `tenant-scope-check`, `tenant-neutral-lint`, `depcruise`, `knip`, `doc-lint`, and `test`. |
| `pnpm run smoke` | A fresh isolated database, migrations and seed, real server boot, CLI contract, and representative runtime flows. |
| `pnpm run quickstart:probe` | The documented fresh-database onboarding path, repeat seed, real server, and CLI hello. |
| `pnpm run e2e:auth` | Registration, login, session, tenant resolution, and magic-link authentication. |
| `pnpm run e2e:coupon` | The interactive checkout coupon flow in a real browser: reveal, invalid code, valid code, discounted breakdown. |
| `pnpm run e2e:poc` | The creator and member proof-of-concept journeys at the CLI+HTTP level. |
| `pnpm run e2e:subs` | Subscription, payment, ledger, grant, replay, and expiry lifecycle. |
| `pnpm run e2e:marketing` | Marketing consent, delivery, suppression, and provider-event lifecycle. |
| `pnpm run e2e:storage` | The S3 write-read-delete probe and its mapped failure paths against a throwaway MinIO container or a real bucket. |
| `pnpm run visual` | Multi-theme, multi-viewport pixel comparison against reviewed repository goldens. |
| `pnpm run storybook:build` | CI compilation of the bounded component workbench documented in [app/docs/storybook.md](app/docs/storybook.md). |

In `.github/workflows/ci.yml`, the `check` job runs `check` and the production
dependency audit. The `smoke` job runs `smoke` and `quickstart:probe`; the macOS
`visual` job runs `visual`, which builds Storybook before comparing captures.
The twelve e2e matrix suites are `auth`, `poc`, `subs`, `marketing`, `coupon`,
`public-authz`, `member-activity`, `member-shell`, `impersonation`, `two-factor`,
`image-assets`, and `custom-domain`. The `auth` job also runs `fixtures:check`
and `visual:app`. `e2e:storage`, `e2e:ksef`, and coverage scripts are available
but are not run by this workflow. These gates run on pushes and pull requests
to `staging` and `main`. Third-party GitHub Actions are pinned to full commit
SHAs.

Gates are deterministic. Rerun-to-green is prohibited; a flake is a P1 defect.
Visual has zero retries.

## Foundation evolution

Together consumes agentproofarch as a copied foundation, not as a long-lived
merge fork and not as an opaque core package. The application owns its core and
domain. The portable artifact is the enforcement configuration and the gates.

[`FOUNDATION.md`](FOUNDATION.md) records the upstream URL, source and upgrade
SHAs, dates, foundation-owned paths, and deliberate divergences. A future
upgrade starts from a path-scoped upstream diff against that recorded SHA.

The evolution rules are:

- **May change freely:** product domains, features, routes, theme, adapters,
  CLI commands, and product thresholds.
- **Should stay synchronized:** ESLint and custom rules,
  dependency-cruiser, TypeScript strictness, gate scripts, config-regression
  probes, CI, and agent instructions.
- **Requires an explicit divergence:** changing the error numbering, public
  surface model, visual harness, i18n model, or other choice recorded in
  `FOUNDATION.md`.
- **Leaves the foundation:** allowing clients to import `core/server`,
  allowing `core/server` to import `core/contract`, permitting frameworks in
  core, dissolving the Result/error contract, enabling unrestricted external
  imports, or weakening the `any` and assertion bans.
- **Public docs describe operation:** architecture and provenance explain
  system boundaries; reference docs describe implemented behavior and runbooks.

When a second real application consumes the same foundation, domain-free
enforcement configuration may graduate to a versioned package. Core source does
not: each application continues to own and evolve its domain locally.
