# Product-completeness audit

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
backlog (maintained in the owner's private archive), the
[accepted parity scope](../../../tasks/mvp-parity.md), and the
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
- **Manual evidence:** the route and permission inventories, ADR 0012, and the
  self-host guide were reconciled with the registration, login, resend,
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
- **Due date:** feature owner re-runs this evidence at the next release audit or
  by 2026-09-04; production owners supply provider and domain evidence before
  go-live.
