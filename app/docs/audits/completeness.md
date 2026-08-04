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

Completeness is measured against Together's own
[post-convergence product backlog](../../../tasks/audit-convergence-r4.md#complete-accumulated-backlog-index-post-convergence-roadmap),
[accepted parity scope](../../../tasks/mvp-parity.md), and
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

