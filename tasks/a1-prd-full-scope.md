# A1 — Full PRD scope, cut into sub-packages

> DECIDE program, item A1. Planning artifact: it defines **what the remaining
> full-PRD scope is**, cut into independently schedulable sub-packages, each
> mapped against what already exists in `app/`. It is not a spec — per-package
> specs are written at package entry (see "Entry criteria").
>
> Inputs: `tasks/prd-together.md` (FR/US ids used verbatim), the reality audit
> (file:line — the owner's private audit artifacts), plus direct code
> checks recorded below.
> Baseline commit: `495b45f`.

## Why this cut

The parity sprint (`tasks/mvp-parity.md`) delivered a legacy-shaped product:
courses, entitlements, progress, checkout, panel, i18n. The PRD, however,
promises a **platform**, and the gap is no longer "features" but five
independent surfaces with different owners, different external dependencies and
different risk profiles. Cutting by surface (not by epic) is deliberate: every
package below can be specced, staffed and shipped without blocking another,
apart from the two edges listed in "Sequencing".

Scope-ID note: **US-020 (product model) is carried by SP-4**, because the public
surface is the first consumer that breaks without product types, slug, cover and
rich description. If the owner meant US-020 as a package of its own, split
SP-4.1 out — the entry criteria and deliverables are already written as a
separable block.

## Package map

| ID | Package | PRD anchors | Reality verdict | Size | Depends on |
|---|---|---|---|---|---|
| SP-1 | Auth methods | US-002, FR-3 | Rich but ungoverned: 5 methods shipped, no policy, no per-tenant control | M | — |
| SP-2 | Members | US-032, US-034, FR-3, FR-4, FR-36 | Lists and grants done; 360 card and event timeline partial | L | SP-1 (identity fields), SP-3 (capability policy) |
| SP-3 | Admin | US-003, FR-1, FR-11 | Panel done; role policy contradicts the PRD; no staff management | M | — |
| SP-4 | Public surface (+ US-020) | US-030, US-031, US-020, FR-20, FR-35 | Offer API and checkout links done; embeds and product types missing | L | SP-5 (domain of the embed origin) |
| SP-5 | Custom domains | FR-62, §10 tenant resolution | Resolution and storage exist; no attach/verify/TLS path | M | SP-1 (cookie worlds) |

Sizes: S ≤ 1 workflow, M = 2–3, L = 4+.

---

## SP-1 — Auth methods

**Scope.** Which authentication methods exist, who decides they are on, and how
each behaves across tenant domains. Not: authorization (SP-3), not member data
(SP-2).

**Reality.**
- Shipped: email+password (`app/adapters/auth/create-auth.ts:152`), magic link
  (`:180`), passkeys (`:221`), TOTP 2FA (`:222`), Google
  (`:175`, enabled by env only — `app/apps/server/src/composition.ts:615`).
- Password reset with session revocation and provider-validated flow landed in
  `3be0a66` / `60727a5`; legacy PBKDF2 verification keeps imported accounts
  signing in.
- Magic links are rebased onto the requesting host (per-domain cookie worlds,
  ADR-0002) — this is the mechanism SP-5 inherits.
- Missing: any **per-tenant** method policy. `authConfig` exposes exactly one
  flag (`googleEnabled`, `composition.ts:773`), globally, from env. A creator
  cannot disable passwords, require 2FA for staff, or turn on Google for their
  tenant only. Self-host has no documented default set.

**Entry criteria.**
1. Owner decision on the **method matrix**: which methods are tenant-configurable
   vs instance-global vs always-on (blocking — it determines the schema).
2. Owner decision on **staff 2FA**: optional, enforceable-by-owner, or mandatory.
3. ADR-0002 re-read confirmed as still binding for global-account/per-tenant
   relation split (no re-litigation inside the package).

**Deliverables.**
- Per-tenant auth-method configuration (schema + panel section + CLI), replacing
  env-only gating; `GET /api/public/auth-config` reports the tenant's real set.
- Google (and any future social provider) configured as a BYO integration with
  the standard wizard + live test, per FR-11 — not an operator env var.
- Passkey and 2FA enrollment surfaces for **members**, not only staff
  (`SettingsPanel.tsx` has the staff path; the member account page has none).
- Account-recovery matrix documented and tested per method (lost passkey, lost
  TOTP, passwordless account).
- Self-host default profile: which methods are on out of the box, one paragraph
  in the self-host guide.

**Done when.** A tenant can switch its own login methods from the panel, a
member can enroll a passkey and TOTP, recovery works for every method, and no
auth capability depends on an operator-set env var.

**Dependencies.** None inbound. Outbound: SP-5 (cookie/session behaviour on a
custom domain must be re-verified against whatever this package changes).

---

## SP-2 — Members

**Scope.** The member record as the tenant's owned relation: 360 card, domain
event timeline, GDPR duties, segmentation inputs. Not: community features
(phase 2), not marketing automation (phase 3).

**Reality.**
- Done: member list, CSV/JSON export, manual grant/revoke, bans, progress,
  learning view, data export and erasure requests (`member-data-export.ts`,
  `member-erasure-requests.ts`).
- Partial (per reality audit): the 360 card lacks purchases and Stripe
  subscription detail; `member_events` (`app-schema.ts:230`) carries only
  banned/unbanned, so the "extensible timeline" of FR-36 is a promise, not a
  model; e-mail history lives in a separate tab; order rows do not link to the
  member card.
- Missing: tenant-level export of *everything* (FR-4) as one operation —
  per-entity exports exist, the tenant-wide bundle does not.

**Entry criteria.**
1. FR-36 event taxonomy agreed **on paper first**: the closed set of event
   kinds for phase 1 plus the extension rule for phases 2–3 (community, e-mail,
   visits). Building the timeline before the taxonomy is the known failure mode.
2. SP-3 capability policy resolved for member-data reads (who sees billing,
   who sees erasure requests) — otherwise the card ships with today's ambiguous
   admin/owner split.
3. Legal review of retention/erasure semantics for events referencing deleted
   members (one decision: anonymize vs delete).

**Deliverables.**
- Unified `member_events` model with typed payloads and a single timeline
  component; existing bans, e-mails, grants and orders backfilled into it.
- 360 card completed: purchases, subscriptions with Stripe state, grants,
  progress, timeline — one screen.
- Order → member navigation (`SalesPanel.tsx:264` currently renders plain text).
- FR-4 tenant-wide export (members, orders, course structure, community) in
  JSON/CSV, runnable from panel and CLI.
- Erasure that is provably complete against the new event model.

**Done when.** Every member-facing fact reachable in ≤ 2 clicks from the member
card, a new event source can be added by declaring a type (no timeline rework),
and a tenant can export or erase its data end to end.

**Dependencies.** SP-1 (identity fields on events), SP-3 (capabilities).

---

## SP-3 — Admin

**Scope.** The creator-side control plane: who is staff, what staff may do, how
staff are added and audited. Not: the panel's feature screens.

**Reality.**
- Two staff roles exist (`app/core/domain/identity.ts:3`), with a capability
  table (`authorization.ts:99–216`): `admin` gets the shared staff set, `owner`
  additionally the owner-only list (`:188`).
- **Contradiction with the PRD**: US-003 says the panel is owner-only; the code
  gives admins nearly the whole panel. The reality audit flags this as PARTIAL;
  it is in fact an unresolved decision, not a bug.
- Missing entirely: staff management. `tenant_admins` (`app-schema.ts:174`) has
  no invite, no role change, no removal, no UI, no CLI. Staff exist only because
  a row was written by tenant creation or by hand.
- Missing: an admin action audit trail (bans are recorded, configuration changes
  and grant overrides are not).

**Entry criteria.**
1. Owner ruling on the US-003 contradiction: either restrict the panel to owner
   or rewrite US-003 to describe the admin role. **Blocking** — every deliverable
   below encodes the answer.
2. Decision whether roles stay a fixed pair or become a capability-set model
   (the PRD says "extensible roles"; the code says enum).
3. SP-1 decision on staff 2FA, if enforcement lands here.

**Deliverables.**
- Staff invitation flow (invite by e-mail → accept → role assigned), role change
  and removal, with last-owner protection.
- Capability policy reconciled with the PRD text, documented as a table that the
  authorization tests assert against.
- Admin audit log for staff-visible mutations, feeding the SP-2 timeline where
  the subject is a member.
- CLI parity for every staff operation (repo convention).

**Done when.** An owner can add and remove staff from the panel without touching
the database, the capability table matches the PRD sentence-for-sentence, and
privileged actions are attributable.

**Dependencies.** None inbound. Outbound: SP-2 (capabilities), SP-1 (2FA).

---

## SP-4 — Public surface (carries US-020)

**Scope.** Everything an unauthenticated visitor can touch: offer API, checkout
links, embed widgets — plus the product model those surfaces render. The
platform hosts no marketing pages (ADR-0001, FR-35); that constraint is an
input, not a question.

**Reality.**
- Done: public offer JSON with open CORS and content-version caching
  (`public-offer.ts:68`), shareable checkout URLs, the bounded public route
  manifest (`public-route-manifest.ts:16`) that keeps the surface honest, and
  the Stripe checkout → member → grant → magic-link chain.
- Missing: `/embed/*` — no loader script, no iframe endpoint, no postMessage
  resize contract. FR-35 calls this post-MVP; it is the only remaining piece of
  the sales surface.
- **US-020 (carried here)**: products have no `type` field at all, so FR-20's
  course / digital download / membership triad does not exist in the schema;
  slug, cover image and rich-text description are absent
  (`app/core/domain/product.ts:68`). Digital download delivery (US-023) has no
  asset model and no signed download route.

**Entry criteria.**
1. Product-type decision recorded: is `type` a discriminator that changes
   delivery, or a label over the existing `accessItems` union? This determines
   whether US-023 is a new subsystem or a variant.
2. Embed contract drafted and reviewed: allowed origins, CSP posture, resize
   protocol, versioning of the loader (a public contract cannot be revised
   silently once creators paste it into their sites).
3. SP-5 decision on which host serves embeds and checkout (custom domain vs
   subdomain) — affects CORS and cookie policy.
4. Storage wizard (US-011) available if downloads ship in the same slice;
   otherwise downloads are deferred to a follow-up and stated as such.

**Deliverables.**
- 4.1 Product model: `type`, slug, cover, rich description, with migration and
  panel editing; preview-lesson flag (FR-22) if it lands with the same schema
  change.
- 4.2 Digital download: asset model, signed expiring URLs, 403 for
  non-entitled, member "My products" download buttons.
- 4.3 Embeds: `/embed/*` iframe endpoints, loader script, postMessage resize,
  documented snippet, all registered in the public route manifest.
- 4.4 Public offer extended with the new product fields, cache version bumped.

**Done when.** A creator can paste one snippet into their own site, a visitor
buys through it, and a downloadable product is delivered through a signed URL —
with no page hosted by the platform.

**Dependencies.** SP-5 (origin/host decision) is the only hard edge; US-011
(storage wizard) for 4.2.

---

## SP-5 — Custom domains

**Scope.** Attaching a creator-owned domain to a tenant: verification, TLS,
session behaviour, and the commercial framing (FR-62 makes it a paid add-on on
hosted; on self-host it is simply how deployment works).

**Reality.**
- Resolution is done and tested: custom domain wins over subdomain, which wins
  over the `X-Tenant` header (`resolve-tenant.ts:33–48`); only `verified` rows
  resolve (`repositories.ts:2471`).
- Storage is done: `tenant_domains` with `kind: subdomain | custom` and a unique
  domain index (`app-schema.ts:1296`).
- Missing: everything that writes those rows. No attach use case, no DNS
  verification, no TLS provisioning, no panel section, no CLI — the table is
  populated by the seed only (`seed.ts:970`). `verified` is never set by product
  code.
- Session/cookie behaviour across domains exists in the magic-link rebasing path
  but has never been exercised against a real second domain.

**Entry criteria.**
1. Hosted-vs-self-host split decided: does the platform provision TLS itself
   (ACME in-process), delegate to the reverse proxy (Caddy on-demand TLS), or
   both with different code paths? **Blocking** — it is the whole package.
2. Owner-provided test domain plus DNS access for an end-to-end run
   (OWNER-INPUT-NEEDED; nothing here is verifiable without it).
3. SP-1 stable: whatever auth methods exist must be re-verified per domain
   (cookie world isolation, OAuth callback origins, passkey RP-ID — passkeys are
   bound to an origin and will not transfer between the subdomain and the custom
   domain; this is a design constraint, not a bug to fix later).
4. Pricing decision from PRD §4 confirmed or deferred explicitly — the feature
   may ship before the add-on billing exists (phase 4), but the flag must be
   modelled.

**Deliverables.**
- Attach/verify flow: creator enters a domain → platform issues a DNS challenge
  (TXT or CNAME) → verification job flips `verified` → panel shows state and
  failure reasons in plain language.
- TLS provisioning per the entry-criteria decision, with certificate state
  visible in the panel.
- Redirect policy: canonical host per tenant, subdomain → custom domain
  behaviour, and what happens to old magic links after a switch.
- Passkey / OAuth / cookie re-verification suite across two hosts.
- Domain lifecycle: detach, re-verify, domain taken by another tenant, tenant
  deletion.
- CLI parity; self-host documentation of the proxy configuration.

**Done when.** A domain is attached from the panel, serves TLS, resolves to the
tenant, logs a member in on the custom host, and can be detached without
stranding sessions.

**Dependencies.** SP-1 inbound. Outbound: SP-4 (embed origin, checkout host).

---

## Sequencing

Two hard edges, everything else parallel:

- **SP-1 → SP-5**: auth-method policy must be settled before domains are
  verified against it, or the cookie/passkey matrix is tested twice.
- **SP-5 → SP-4.3**: embeds need a stable public origin before the loader
  contract is published to creators.

SP-3 has no inbound edge and unblocks SP-2; it is the cheapest first move and it
forces the US-003 ruling that several other decisions lean on. Recommended
order: **SP-3 → SP-1 → SP-5 → SP-4 → SP-2**, with SP-2 startable in parallel
once SP-3's capability table is merged and SP-4.1 (product model) startable at
any time.

## Decisions required before any package starts

| # | Decision | Blocks | Type |
|---|---|---|---|
| D1 | US-003 panel-role contradiction: owner-only or admin-inclusive | SP-3, SP-2 | Owner |
| D2 | Auth-method matrix: tenant-configurable vs instance-global | SP-1 | Owner |
| D3 | TLS provisioning model for custom domains | SP-5 | Technical + owner (hosting cost) |
| D4 | Product `type` as delivery discriminator vs label | SP-4 | Technical |
| D5 | FR-36 event taxonomy (closed phase-1 set + extension rule) | SP-2 | Technical |
| D6 | Test domain with DNS access | SP-5 | Owner input |

## Explicitly outside A1

Phase-2/3/4 epics (community, marketing, hosted billing/provisioning) keep their
own PRDs per `tasks/prd-together.md` §7. Integration wizards (US-011–US-014),
Stripe cancellation correctness (US-031), self-host packaging (US-004) and
branding completeness (US-033) stay in the phase-1 gap list of the reality
audit — they are corrections to shipped work, not new scope, and are tracked
there rather than duplicated here.
