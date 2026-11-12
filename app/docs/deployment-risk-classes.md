# Deployment risk class

Together classifies a deployment by asking who is hurt, and how much, when
production is unavailable. The `SIL-0` through `SIL-3` names are deployment-risk
shorthand adapted from the
[upstream deployment-risk architecture matrix](https://github.com/coderoadpl/agentproofarch/blob/v1.4.0/website/docs/operations/risk-classes.md).
They are not Safety Integrity Levels under IEC 61508 and do not claim
functional-safety compliance or certification.

## Selected Together posture

Together's commercial hosted production is the **SIL-3-shaped** case. Paying
creators, their members, and the operating business can lose access, revenue,
trust, or contractual performance during an outage. The product remains
pre-release, but that fact does not reduce the target production risk class.

The [source matrix](https://github.com/coderoadpl/agentproofarch/blob/v1.4.0/website/docs/operations/risk-classes.md#sil-3)
reserves SIL-3 for commercial hosted production with approval-walled promotion,
deployment attestation, a separate commercial account boundary, and no
agent-held hosting credentials. Together maps that posture onto its own
requirements below. SIL-0 demo, SIL-1 local-product, and SIL-2 internal
back-office labels describe different systems; they are not rollout stages that
weaken Together's target production wall.

## Together controls

1. **Human-approved production promotion.** The topology makes `main`
   the default and production branch, and makes `staging` the integration
   trunk. The operating procedure requires the owner to approve every
   `staging` to `main` pull request and forbids an agent from approving or
   releasing its own work. The active `main-protection` ruleset requires one
   code-owner approval, dismisses stale approvals, and requires last-push
   approval. Remaining live gaps are listed below. The topology is defined by
   [deployment environments](deployment-environments.md).
2. **Separate production boundary.** Production uses its own hosting and
   database boundary with production-only credentials. Preview and staging must
   not reuse them. The owner selects a commercial hosting plan appropriate to
   the service; vendor plan names and prices are not part of this doctrine.
3. **No agent-held hosting identity.** An agent must not receive a production
   hosting login, CLI session, deployment token, database credential, or
   production secret. Project creation, linkage, environment provisioning, and
   the first deployment remain owner actions. Deployment follows the reviewed
   Git promotion through the host integration.
4. **SHA-attested deployment.** The same commit is intended to advance
   through staging and production. After each deployment, the owner must run
   `smoke:remote` with `EXPECTED_SHA` set to the approved Git SHA and retain the
   result. The `prod-smoke` workflow also invokes `smoke:remote` after successful
   Production deployment statuses with the deployment SHA, and on manual
   dispatch. The `staging-smoke` workflow invokes `smoke:staging` on staging
   pushes, a daily schedule, and manual dispatch. Optional SHA inputs and
   credential-dependent staging skips mean these monitors do not replace the
   required promotion evidence or approval wall; see
   [verification and promotion](deployment-environments.md#verification-and-promotion).

## Enforcement and review

The label alone does not enforce these requirements. A read-only GitHub API
inspection on 2026-11-12 confirmed active branch rulesets: `main-protection`
(20889929) targets `refs/heads/main`, and `staging-gates` (20889930) targets
`refs/heads/staging`. Both require pull requests, required status checks, and
merge commits only, and block branch deletion and force pushes. The main rule
requires one code-owner approval, stale-approval dismissal, last-push approval,
and resolved review threads; staging requires zero approvals. The calling
agent cannot bypass either ruleset (`current_user_can_bypass=never`).

Both branches must require up-to-date status checks and resolved review threads.
The live settings remain weaker in two places, which are open gaps rather than
waived requirements: `main-protection` has
`strict_required_status_checks_policy=false`; `staging-gates` has
`required_review_thread_resolution=false`. Staging's strict status-check policy
and main's review-thread resolution are already enabled. The approval wall
exists, but these two settings still require owner correction.

The live hosting account membership, credential boundary, and Vercel Production
Branch settings are not established by repository files or this ruleset read.
Verification of that hosting boundary, correction of the ruleset gaps,
and retained SHA attestation remain explicit owner actions in items 16–18 of the
[go-live checklist](go-live-checklist.md#16-production-branch-and-approval-wall).
Production promotions derive their version from Git history and receive immutable
tags and generated release notes through the [versioning workflow](versioning.md).
Build identity does not create a support guarantee; see
[version surfaces](version-surfaces.md).
That deferral does not authorize autonomous production deployment.

Reclassification requires a reviewed architecture decision when the deployed
system or outage harm changes. A lack of current public customers during
pre-release is not, by itself, a reason to weaken the selected production wall.
