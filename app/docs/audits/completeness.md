# Product-completeness audit

## Purpose

Find undocumented absences and incomplete journeys alongside Together's own
backlog and launch commitments. Unlike documentation truth, this audit asks
about capability areas even when no repository document mentions them; it does
not authorize new product scope.

## Run contract

- **Cadence:** monthly, at the end of a product milestone, and before go-live.
- **Owner:** the product owner is accountable; feature owners supply evidence
  and the repository owner validates technical launch blockers.
- **Output format:** a Markdown audit record using the fields required by the
  [roster doctrine](README.md), with backlog item or launch control, promised
  surface, evidence, status, severity, owner, and due date. New product gaps are
  filed in Together's backlog; launch gaps update the checklist through a
  reviewed change.
- **Standard anchor:** OWASP ASVS 5.0.0 V6 and V7 at Level 2 provide an
  ASVS-derived identity-control profile. NIST
  [SP 800-63B-4](https://doi.org/10.6028/NIST.SP.800-63b-4) supplies current
  authenticator and session vocabulary. These references scope identity review
  and do not establish ASVS Level 2 or NIST conformance.

## Sources of truth

Completeness is measured against Together's own post-convergence product
backlog (maintained in the owner's private archive) and the
[go-live checklist](../go-live-checklist.md). An upstream product requirements
document is not an input and cannot create Together scope.

## Tool-performed checks

| Check | Evidence and limit |
| --- | --- |
| `pnpm run check` and `pnpm run smoke` | Prove encoded static controls and the canonical runtime flow. They cannot determine whether an unimplemented backlog capability should exist. |
| `pnpm run permissions:check` | Provides authorization inventory evidence for shipped routes and use-cases. It does not identify missing product journeys. |
| `pnpm run a11y` and visual evidence when explicitly run | Supply accessibility and presentation inputs for implemented routes. They do not establish product completeness and are not members of `pnpm run check`. |

## Manual checks

1. Reconcile every active, deferred, and completed backlog item with current
   code, tests, owner decisions, and user-visible behavior. Preserve deliberate
   deferrals instead of treating them as upstream gaps.
2. Walk the go-live checklist against the target environment and separate
   repository-complete controls from owner actions and unverified external
   state. Link evidence; do not copy checklist content here.
3. For identity scope, sample registration, sign-in, recovery, password change,
   passkeys, MFA, session rotation/revocation, rate limiting, and sign-out across
   creator/platform and tenant-member account surfaces. Map observations to the
   selected ASVS 5.0.0 V6/V7 L2 requirements and NIST SP 800-63B-4 vocabulary.
4. Trace critical product journeys across public, creator, member, CLI, worker,
   and provider boundaries, including negative and recovery paths.
5. Record out-of-scope decisions, unavailable production settings, and
   unexercised providers as blind spots. A green gate means implemented behavior
   works as tested; it does not mean the product backlog is complete.
6. Independently review the product-neutral checklist below, even when the
   backlog says nothing about an area. For each item record current file/test
   evidence, applicable surfaces, and whether it is surfaced, provider-only,
   disabled, partial, missing, or untested. Record an accepted deferral with its
   owner decision and named revisit trigger; an unexplained gap becomes a
   finding or owner question, never automatic implementation scope.
7. Read the cited ASVS or NIST requirement text before assigning a result.
   Record the version, requirement ID, applicability, and direct code/test
   evidence; names or provider documentation alone cannot establish a pass.
8. Enumerate public routes exposed by the configured identity provider and each
   enabled plugin, not only Together's wildcard mount. Map routes to surfaced
   journeys, authorization, tests, and disabled/provider-only states. Newly
   enabled plugins require this review as newly shipped public surfaces.
9. Prioritize absent adjacent capabilities that break a shipped journey, such
   as recovery from an enabled authentication factor, above isolated absences.
   Refer scope and prioritization decisions to the product owner.

### Independent capability checklist

This is an absence-search lens, not a new acceptance contract or feature plan.
Keep Together's backlog and go-live references alongside it, and do not import
an upstream PRD or demo status ledger.

| Capability area | Questions to reconcile with evidence and owner decisions |
| --- | --- |
| Identity entry and exit | Can intended users register, sign in, sign out, verify identity contact details, and recover access without enumeration or lockout? |
| Credentials and factors | Do password change/reset, passkey and MFA enrollment, challenge, removal, and recovery form complete journeys when the factor is enabled? |
| Sessions and account management | Are session visibility/revocation, account/profile changes, contact changes, and account erasure surfaced, provider-only, disabled, or explicitly deferred? |
| Workspace and membership lifecycle | Are bootstrap, roles, invitations, member removal, workspace settings, and workspace closure addressed for the product's intended users? |
| Tenant and capability boundaries | Do shipped journeys preserve tenant isolation and role/capability decisions across public, creator, member, CLI, worker, and provider paths? |
| Legal and data lifecycle | Are applicable terms, privacy, consent, retention, export, and erasure obligations connected to shipped journeys and go-live controls? |
| Recovery and operations | Do enabled mail, payment, background-work, and other provider paths expose the failure/retry/recovery behavior their shipped journeys need? |

## Finding criteria

- A Together backlog or launch commitment lacks an evidenced implementation or
  silently reduces its promised behavior without a cited owner decision.
- A checklist item is missing, partial, provider-only, or untested without a
  documented disposition and revisit trigger. Record applicability uncertainty
  as an owner question, not a newly imposed feature requirement.
- A shipped identity control contradicts the cited, applicable ASVS/NIST
  requirement text, or an enabled provider/plugin route exposes an incomplete
  journey without an accepted disposition. Include requirement and file evidence.
- An absent adjacent capability breaks a shipped feature, or current scope
  sources disagree without an adjudicating owner decision. Preserve soft email
  verification and the documented first-workspace waiver below.

## Known blind spots

- This checklist is not exhaustive; unknown capability classes can still be
  missed. A passing audit cannot establish that the product has every useful
  SaaS feature or conforms to ASVS/NIST.
- Code and tests do not prove live provider delivery, production configuration,
  or inaccessible owner decisions. Record unavailable evidence and unexercised
  journeys, including any sampled identity checks, as unverified or partial.
- This audit cannot decide whether a capability is worth building or overturn
  accepted deferrals; gaps require owner triage rather than automatic scope.

## Email-verification evidence — 2026-08-04

- **Reviewed commit:** `bcac038897c8819af4a539ef96f8a424b791e8df` on
  `run-v140-email-verify`, with the findings below resolved by the review commit.
- **Auditor and owner:** feature owner; repository owner accepts documented
  exceptions before merge.
- **Scope:** soft email verification at registration and resend, tenant-host
  delivery, creator and member account status, PL/EN mail and UI states,
  authorization, CLI identity output, and self-host bootstrap behavior.
- **Tool evidence:** focused auth, server, and login-page tests cover delivery
  rebasing, bounded pending contexts, provider outcomes, and both account
  surfaces. `pnpm run check` and `pnpm run smoke` remain the merge gates.
- **Manual evidence:** the route and permission inventories and the
  [self-host and tenant bootstrap guide](../self-host.md) were reconciled with the registration, login, resend,
  tenant-creation, creator-settings, and member-account journeys.
- **Finding status:** no open product-completeness finding remains in this
  scope. Verification remains soft by design and blocks only tenant creation.
- **Accepted exception:** `createTenant` reads `tenants.hasAny()` before
  authorization so the documented first-workspace waiver can be selected.
  This deliberately differs from a repository-free denial ordering. The read
  is non-mutating, `requireEmpty` keeps creation atomic, and the use-case tests
  prove a denied request does not mutate the store.
- **Blind spots:** production-provider delivery, DNS/TLS for a real custom
  domain, and inbox placement were not exercised. They remain deployment
  evidence, not repository-complete claims.
- **Due date:** feature owner re-runs this evidence at the next release audit;
  production owners supply provider and domain evidence before
  go-live.
