# Together architecture

This document defines the foundation-level architecture of Together. Product
scope and business decisions remain in [`tasks/`](tasks/); this file names the
system boundaries, the vocabulary used to discuss them, and the rules that
must remain true as the product evolves.

The product vision and tenancy model come from
[`tasks/prd-together.md`](tasks/prd-together.md). Foundation provenance and
deliberate divergences from agentproofarch are recorded in
[`FOUNDATION.md`](FOUNDATION.md). Where a task document records an accepted
domain decision, it is the ADR-equivalent source linked from the relevant
section below.

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
| `app/scripts` | Gates, migration and seed entry points, e2e drivers, import tools, and operational probes. |

Only `app/apps/server/src/composition.ts` constructs production adapters.
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
| **Island core** | A future `features/<name>/core/` pure-TypeScript module that accepts events and exposes selectors. No island cores exist yet; the boundary is reserved for the first feature that needs one. |
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
- `@vercel/*` and `@neondatabase/*` remain adapter-only dependencies. A future
  platform entry requires an explicit reviewed exemption.

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

- Every tenant-scoped use-case receives `ctx: { identity }` first.
- Every tenant-scoped repository operation requires `tenantId`.
- A tenant identifier supplied by a caller never substitutes for the tenant in
  the authenticated identity.
- Staff-only operations require a staff role; owner-only integration and secret
  operations require `owner`.
- Member reads are constrained by membership and entitlement, including
  product-gated learning and community access.
- Worker identities are explicit and tenant-scoped; they do not become
  unrestricted application identities.

The current authorization model is distributed role and entitlement checks in
the use-cases. A central default-deny capability matrix is a planned foundation
upgrade, not a property of the current code. The accepted gap and sequencing
are recorded in
[`tasks/agentproofarch-upgrade.md`](tasks/agentproofarch-upgrade.md). Until that
lands, new use-cases must follow the existing fail-closed identity checks and
must include cross-tenant tests.

Community visibility and moderation decisions are recorded in
[`tasks/community-mvp.md`](tasks/community-mvp.md). Tenant terminology shown to
users is defined separately in
[`tasks/terminology-glossary.md`](tasks/terminology-glossary.md).

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

This convention governs coupon redemptions, email delivery, invoice and KSeF
submission state, and other durable workflows. The accepted domain shapes are
recorded in:

- [`tasks/subscriptions-sales.md`](tasks/subscriptions-sales.md) for orders,
  subscriptions, grants, and webhook idempotency.
- [`tasks/coupons-affiliates.md`](tasks/coupons-affiliates.md) for redemption
  projections, events, attribution, and append-only price history.
- [`tasks/marketing-email-spec.md`](tasks/marketing-email-spec.md) for consent,
  suppression, campaign, and delivery lifecycles.
- [`tasks/invoicing.md`](tasks/invoicing.md) for immutable billing snapshots,
  invoice projections, frozen fiscal artifacts, and asynchronous KSeF state.

Scheduler runs are operational telemetry, not lifecycle projections. A run is
finalized once from `running` to `completed` or `failed`; its per-tenant result
rows are written during finalization and are not mutated afterward.

Erasure is policy-aware rather than a blind cascade. Product data that may be
removed or pseudonymized follows the relevant retention flow. Fiscal records
and immutable compliance evidence remain when their legal retention basis
requires it.

## Transactions and external effects

Atomicity is owned by adapter methods that implement a business operation, not
by HTTP handlers. When a command must update a projection and append an event,
or create several rows that form one invariant, the database adapter exposes
one port operation and performs one transaction.

Money is represented as integer minor units. Orders are the sales ledger and
the source of truth for revenue and coupon attribution. Payment and webhook
handlers are idempotent by provider event and business-object identity.
Subscription access is read-time entitlement derived from grants and their
expiry, as decided in
[`tasks/subscriptions-sales.md`](tasks/subscriptions-sales.md).

External calls cannot participate in a database transaction. Durable workflows
therefore persist intent and checkpoints before or after the call as the domain
requires, then retry from stored state. KSeF additionally freezes canonical XML
and its hash before submission and treats ambiguous duplicates as a conflict
for recovery, not permission to invent a new invoice number.

The code currently allows both `node-postgres` and `neon-http`, while some
repository methods require interactive transactions. That compatibility must
not be assumed until the transaction-capability gate planned in
[`tasks/agentproofarch-upgrade.md`](tasks/agentproofarch-upgrade.md) lands.

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

The product decisions for the public marketing and consent surface live in
[`tasks/marketing-email-spec.md`](tasks/marketing-email-spec.md); public commerce
behavior lives in
[`tasks/subscriptions-sales.md`](tasks/subscriptions-sales.md) and
[`tasks/coupons-affiliates.md`](tasks/coupons-affiliates.md).

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

A complete HTTP edge baseline covering security headers, CSP, request-size
limits, explicit CORS policy, and the remaining CSRF review is deferred to the
next foundation stage. The deferral is explicit in
[`tasks/agentproofarch-upgrade.md`](tasks/agentproofarch-upgrade.md); this
document does not claim those controls already exist.

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
the baseline is never regenerated merely to absorb it. The accepted layout
model and enforcement decisions live in
[`tasks/ux-layout-system.md`](tasks/ux-layout-system.md), with owner decisions in
[`tasks/ux-decisions.md`](tasks/ux-decisions.md).

The current feature tree does not yet contain island cores. Their machine
ladder is a reserved evolution path, not permission to introduce a global state
library. Server state remains in typed descriptors; trivial view state remains
in React.

## Gates

Architecture is enforced by configuration and executable probes:

| Gate | Guarantee |
|---|---|
| `npm run check` | Type safety, ESLint boundaries, lockfile consistency, dependency graph, dead-code/dependency drift, documentation cross-checks, and tests. |
| `npm run smoke` | A fresh isolated database, migrations and seed, real server boot, CLI contract, and representative runtime flows. |
| `npm run quickstart:probe` | The documented fresh-database onboarding path, repeat seed, real server, and CLI hello. |
| `npm run e2e:auth` | Registration, login, session, tenant resolution, and magic-link authentication. |
| `npm run e2e:poc` | The creator and member proof-of-concept journeys through the real browser stack. |
| `npm run e2e:subs` | Subscription, payment, ledger, grant, replay, and expiry lifecycle. |
| `npm run e2e:marketing` | Marketing consent, delivery, suppression, and provider-event lifecycle. |
| `npm run visual` | Multi-theme, multi-viewport pixel comparison against reviewed repository goldens. |

CI runs `check`, `smoke`, the quickstart probe, and the auth, PoC, subscription,
and marketing e2e suites on pushes and pull requests to `poc-together`. KSeF
e2e is excluded because it targets an external shared test network. Visual
comparison remains local until platform-scoped CI baselines and a platform
guard land. Third-party GitHub Actions are pinned to full commit SHAs.

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
  CLI commands, product thresholds, and Together's own accepted task decisions.
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
- **Docs stay separated:** this file and provenance describe foundation
  doctrine; product requirements and domain decisions stay in `tasks/`.

When a second real application consumes the same foundation, domain-free
enforcement configuration may graduate to a versioned package. Core source does
not: each application continues to own and evolve its domain locally.
