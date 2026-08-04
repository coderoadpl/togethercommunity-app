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
trust, or contractual performance during an outage. The repository remains
private and the product remains pre-release, but those facts do not reduce the
target production risk class.

The [source matrix](https://github.com/coderoadpl/agentproofarch/blob/v1.4.0/website/docs/operations/risk-classes.md#sil-3)
reserves SIL-3 for commercial hosted production with approval-walled promotion,
deployment attestation, a separate commercial account boundary, and no
agent-held hosting credentials. Together maps that posture onto its own
requirements below. SIL-0 demo, SIL-1 local-product, and SIL-2 internal
back-office labels describe different systems; they are not rollout stages that
weaken Together's target production wall.

## Together controls

1. **Human-approved production promotion.** The target topology makes `main`
   trunk and staging, and sources production only from the `production` branch.
   The operating procedure requires the owner to approve every `main` to
   `production` pull request and forbids an agent from approving or releasing
   its own work. This is a procedural commitment until the repository can
   enforce the wall. The topology is defined by
   [ADR-0003](decisions/0003-vercel-environments.md).
2. **Separate production boundary.** Production uses its own hosting and
   database boundary with production-only credentials. Preview and staging must
   not reuse them. The owner selects a commercial hosting plan appropriate to
   the service; vendor plan names and prices are not part of this doctrine.
3. **No agent-held hosting identity.** An agent must not receive a production
   hosting login, CLI session, deployment token, database credential, or
   production secret. Project creation, linkage, environment provisioning, and
   the first deployment remain owner actions. Deployment follows the reviewed
   Git promotion through the host integration.
4. **Manually attested deployment.** The same commit is intended to advance
   through staging and production. After each deployment, the owner must run
   `smoke:remote` with `EXPECTED_SHA` set to the approved Git SHA and retain the
   result. The command currently permits the variable to be omitted and no
   workflow invokes it, so this is a manual post-deployment attestation step,
   not an automated acceptance gate; see
   [verification and promotion](decisions/0003-vercel-environments.md#verification-and-promotion).

## Enforcement and review

The label does not enforce these requirements. Earlier on 2026-08-04,
Together's repository was prepared for public visibility; GitHub enforces rulesets and
branch protection on public repositories on the Free plan. The remote still has
no `production` branch and no ruleset, so the owner-approval wall remains a
procedural commitment, not a technically enforced control, until the owner
creates the production branch and its ruleset.

The live hosting account membership, credential boundary, and Vercel Production
Branch setting are also not established by repository files. Creation of the
branch and approval wall, verification of the hosting boundary, and manual SHA
attestation remain explicit owner actions in items 16–18 of the
[go-live checklist](go-live-checklist.md#16-production-branch-and-approval-wall).
Together's release-cut and immutable-tag machinery remains deferred until the
first public supported release under the
[release-versioning decision](decisions/0009-release-versioning-and-version-surfaces.md).
That deferral does not authorize autonomous production deployment.

Reclassification requires a reviewed architecture decision when the deployed
system or outage harm changes. A lack of current public customers during
pre-release is not, by itself, a reason to weaken the selected production wall.
