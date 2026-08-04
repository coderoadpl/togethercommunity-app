# US-020 — tenant custom domains: offline scope

> Status: plan, not implemented. Defines the part of US-020 (creator-managed
> custom domains, `FR-62`) that can be built, tested and merged **without any
> owner action** — no live DNS, no Vercel token, no production promotion.
> Everything requiring the owner is listed in [Owner-gated](#owner-gated) and
> stays out of the PR.

## Decisions

- **Provisioner is a port with two real implementations**, selected by
  `DOMAIN_PROVISIONER` (`noop` default, `vercel`). `noop` is the self-host and
  local default, not a placeholder — it keeps domain rows resolvable while TLS
  is terminated elsewhere. Two real implementations satisfy the "no speculative
  ports" rule; a `caddy` implementation lands with the self-host Docker/on-demand
  TLS work and needs no redesign.
- **The adapter never writes DNS.** It registers the domain with the provider
  and returns the records a human must create. This is what makes the whole
  feature offline-testable: the only external call is the Vercel REST API, which
  is mocked in unit tests.
- **Two DNS topologies, one adapter.**
  - **Together (default): own zone, NS delegation available.** Together runs on
    its own domain, so tenant subdomains come from a wildcard on that zone
    (`*.{APP_BASE_DOMAIN}`) attached to the Vercel project directly. No CNAME
    workaround.
  - **Nested base domain (fallback mode): wildcard CNAME, no NS delegation.**
    When the base domain is a subdomain of a zone we do not control the
    nameservers for — the agentproofarch demo case, `*.agentproofarch.coderoad.pl`
    → `cname.vercel-dns.com` — a single wildcard CNAME replaces delegation.
    Together must not assume it can create records in the parent zone; that is
    exactly why the adapter only *reports* required records.
    (Owner clarification 2026-07-28: the wildcard-CNAME scheme was decided for
    the demo app under `coderoad.pl`; Together's own domain takes the simpler
    NS-delegated path. Both stay supported because the adapter is topology-blind.)
- **Tenant custom domains are provider-agnostic in core.** A tenant points
  `spolecznosc.example.com` at `SELF_HOST_TARGET_CNAME` (Vercel:
  `cname.vercel-dns.com`) and, when the provider demands ownership proof, adds
  the returned `TXT _vercel.example.com`. Core never learns the target value —
  it is adapter configuration.
- **Cookie isolation is preserved, not extended.** Sessions span subdomains of
  `APP_BASE_DOMAIN`; every custom domain stays a separate cookie world
  (`app/docs/security.md`). Adding a domain never merges cookie worlds.
- **Verification tokens are DNS values, never logs.** `VERCEL_TOKEN` is never
  logged, never returned in an envelope, never surfaced in CLI/web output; the
  provider's `vc-domain-verify` challenge is returned only as a
  `RequiredDnsRecord.value`.
- **Docs-first.** Every deliverable below ships with its doc/ADR update in the
  same PR; `pnpm run doc-lint` gates it.

## Baseline in Together today

| Surface | State |
|---|---|
| `app/core/domain/tenant.ts:310` | `tenantDomainSchema = {id, tenantId, domain, kind: 'subdomain'\|'custom', verified}` |
| `app/core/server/ports.ts:1091` | `TenantDomainRepository` is read-only: `findByDomain`, `listVerifiedDomains` |
| `app/adapters/db/repositories.ts` | reads verified domains only; no insert/delete |
| `app/core/server/usecases/resolve-tenant.ts:30` | exact verified custom domain → subdomain of `APP_BASE_DOMAIN` → `X-Tenant` |
| `app/core/contract/routes.ts` | no domain routes |
| `app/apps/server/src/env.ts:25` | `APP_BASE_DOMAIN` only; no provisioner env |
| `app/drizzle` | `tenant_domains` exists (unique index on `domain`); next migration `0063` |

Resolution already works. What is missing is the **lifecycle**: create, check,
remove, and the DNS instructions the creator needs.

## Port shape (adopt upstream `RequiredDnsRecord`)

Adopted verbatim from agentproofarch v1.2.0 PR #103
(`DELTA-MAP-v120.md` §3, `demo/core/server/ports.ts:165-199`) so the two
codebases stay diff-comparable:

```ts
type DnsRecordPurpose = 'ownership-verification' | 'pointing';

interface RequiredDnsRecord {
  readonly type: string;
  readonly name: string;
  readonly value: string;
  readonly purpose: DnsRecordPurpose;
}

interface DomainProvision {
  readonly requiredDnsRecords: RequiredDnsRecord[];
}

interface DomainCheck {
  readonly resolved: boolean;
  readonly detail: string;
  readonly requiredDnsRecords: RequiredDnsRecord[];
}

interface DomainPort {
  provision(domain: string): Promise<DomainProvision>;
  check(domain: string): Promise<DomainCheck>;
  remove(domain: string): Promise<void>;
}
```

Together adaptations:

- `requiredDnsRecordSchema` lives in `core/domain/tenant.ts` (zod is the domain
  vocabulary there); `ports.ts` and `core/contract/routes.ts` import it instead
  of duplicating the shape — upstream duplicates it, we do not.
- Contract response arrays are **optional** for additive compatibility, matching
  upstream, so an older client tolerates a provisioner that returns nothing.
- Port name is `DomainProvisionerPort` (Together's ports are `…Port`/`…Repository`
  by role); `TenantDomainRepository` keeps persistence.

## Offline scope — build order

Strict layer order; each step is independently mergeable and fully unit-tested.

1. **Domain** — `core/domain/tenant.ts`: `dnsRecordPurposeSchema`,
   `requiredDnsRecordSchema`, `domainProvisionSchema`, `domainCheckSchema`.
   Domain-level validation of the submitted hostname (lowercase, punycode-safe,
   no port, not equal to and not a subdomain of `APP_BASE_DOMAIN` — those are
   platform-owned) with a typed `AppError`.
2. **Ports** — `core/server/ports.ts`: `DomainProvisionerPort`;
   `TenantDomainRepository` gains `listByTenant(tenantId)`,
   `create(domain)`, `markVerified(id)`, `deleteById(tenantId, id)`. Every
   mutating signature is `tenantId`-scoped.
3. **Persistence** — `adapters/db/repositories.ts` implements the new methods;
   migration `0063_tenant_domains_lifecycle.sql` adds `created_at` and
   `verified_at` (nullable) to `tenant_domains`. The unique index on `domain`
   already makes cross-tenant hijacking a DB-level failure; map its violation to
   a typed conflict error rather than a 500.
4. **Use-cases** — `core/server/usecases/tenant-domains.ts`:
   `listTenantDomains`, `addTenantDomain`, `checkTenantDomain`,
   `removeTenantDomain`. New capabilities `tenant:domain:read` /
   `tenant:domain:write` in `core/domain/authorization.ts`, granted alongside
   `tenant:settings:read` / `tenant:settings:write`. `addTenantDomain` order is
   validate → provision → persist the unverified row, so a provisioner failure
   leaves no orphan row. `removeTenantDomain` deletes the row only after
   `port.remove()` resolves (the ordering ambiguity flagged in agentproofarch
   PR #62 is decided here, not inherited).
5. **Contract** — `core/contract/routes.ts`:
   `tenantDomains: GET /api/tenant/domains`,
   `tenantDomainsCreate: POST /api/tenant/domains`,
   `tenantDomainsCheck: POST /api/tenant/domains/check`,
   `tenantDomainsDelete: DELETE /api/tenant/domains/:domainId`.
   Request stays `{ "domain": "spolecznosc.example.com" }`; responses carry
   `{ domain, requiredDnsRecords? }`.
6. **Adapters** — `adapters/domain-provisioning/`:
   - `noop.ts` — empty record arrays, `check` resolves against the persisted row.
   - `vercel.ts` — `POST /v10/projects/{id}/domains`,
     `GET /v9/projects/{id}/domains/{domain}/config`,
     `DELETE /v9/projects/{id}/domains/{domain}`; zod-parses every response
     before it crosses back into core; maps `verification[]` challenges to
     `purpose: 'ownership-verification'` and apex `A` / subdomain `CNAME`
     targets to `purpose: 'pointing'`; treats `409 domain_already_in_use` for
     **our own** project as convergent success and for a foreign project as a
     typed conflict (the 409-ambiguity deferred upstream is resolved here).
   - `select.ts` — `DOMAIN_PROVISIONER` switch, fail-fast at boot when
     `vercel` is selected without `VERCEL_TOKEN` / `VERCEL_PROJECT_ID`.
     Vendor SDK/fetch stays inside this directory (`app/adapters/AGENTS.md`;
     `pnpm run depcruise` enforces it).
7. **Server** — `apps/server/src/app.ts` returns use-case results verbatim;
   `composition.ts` wires the selected provisioner; `env.ts` adds
   `DOMAIN_PROVISIONER: z.enum(['noop','vercel']).default('noop')`,
   `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `SELF_HOST_TARGET_CNAME`, with the
   cross-field refinement mirroring the existing `EMAIL_PROVIDER` pattern
   (`env.ts:85`).
8. **Client + CLI + web** — `core/client` methods; `together domain
   list|add|check|remove` in `apps/cli/src/main.ts` rendering a human-readable
   DNS block (JSON output stays verbatim); creator settings page listing domains
   with copy-paste DNS rows and a "Sprawdź" action (PL copy, English code).
9. **Generated artifacts** — `pnpm run permissions:generate`,
   route-table regeneration, `pnpm run coverage:baseline`.

## Offline tests

All green with no network, no token, no DNS.

- **Vercel adapter** (`adapters/domain-provisioning/vercel.test.ts`) against a
  stubbed `fetch`: provider payload → `RequiredDnsRecord[]` mapping for
  subdomain (CNAME) and apex (A); ownership-challenge mapping; 409 same-project
  convergence vs foreign-project conflict; malformed/failed responses rejected by
  the zod boundary instead of leaking `unknown`; **assert `VERCEL_TOKEN` never
  appears in any thrown error, log line, or returned envelope**; `remove` idempotent
  on 404.
- **Selector** — boot fails fast and with an actionable message when
  `DOMAIN_PROVISIONER=vercel` lacks credentials; defaults to `noop`.
- **Use-cases** — authorization matrix (member/staff/owner/API key), record
  propagation, hostname rejection for platform-owned names, cross-tenant
  `deleteById` denial, no orphan row on provisioner failure.
- **Contract** — schema acceptance/rejection, optional-array compatibility.
- **Resolution regression** — `resolve-tenant.test.ts` still prefers a verified
  custom domain over subdomain over header; an unverified row does **not**
  resolve.
- **Cookie world** — a custom-domain request keeps its own session boundary.
- **CLI** — text formatting pinned, JSON pass-through pinned.

Gate: `pnpm run check` (typecheck, lint, depcruise, knip, doc-lint, test) plus
`pnpm run coverage:check` and `pnpm run permissions:check`.

## Docs deliverables (same PR)

- `app/docs/decisions/0012-tenant-custom-domains.md` — provisioner seam, the two
  DNS topologies, no-DNS-writes rule, ordering decisions.
- `app/docs/decisions/0003-vercel-environments.md:49` — replace "until a wildcard
  base domain is attached" with the attached-wildcard state and the env matrix.
- `app/docs/security.md` — custom-domain cookie world under the new lifecycle.
- `app/docs/route-table.md`, `app/docs/permission-table.md` — regenerated.
- `app/README.md` — `DOMAIN_PROVISIONER` and `SELF_HOST_TARGET_CNAME`.
- `app/.env.example` — the four new vars, empty values.
- `docs/custom-domains.md` — creator-facing DNS instructions (both topologies),
  PL user-visible copy sourced from `tasks/terminology-glossary.md`.

## Owner-gated

Not in the PR, not simulated, not worked around:

1. **Scoped `VERCEL_TOKEN`** — created by the owner, scoped to the Together
   project, stored as a Vercel Production/Preview env var. The agent never holds it.
2. **`VERCEL_PROJECT_ID`, `DOMAIN_PROVISIONER=vercel`, `SELF_HOST_TARGET_CNAME=cname.vercel-dns.com`**
   set in the Vercel environment.
3. **Base-domain DNS** — Together's own zone: wildcard `*.{APP_BASE_DOMAIN}`
   attached to the Vercel project (NS delegation or registrar records). In the
   nested fallback topology: the single wildcard CNAME in the parent zone.
4. **`main` → `production` promotion** — gated by the branch ruleset approval the
   agent cannot give.
5. **Live tenant-domain test** — registering a real domain via CLI, creating live
   test tenants, browser verification of TLS + cookie isolation. Runs only after
   1–4.

Until 1–4 exist, production behaves exactly as today: `DOMAIN_PROVISIONER=noop`,
subdomain and `X-Tenant` resolution unchanged.

## Deferred

- `caddy` provisioner + self-host on-demand TLS (arrives with the Docker
  production topology; the port shape already fits).
- Automated DNS writes on registrar APIs — deliberately never.
- Domain-level redirect/canonicalization and per-domain branding (FR-62 add-on
  billing, separate story).
