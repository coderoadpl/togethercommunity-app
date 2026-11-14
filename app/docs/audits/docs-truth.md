# Documentation-truth audit

## Purpose

Check concrete documentation claims against current implementation and cited
evidence, keeping intended future behavior distinct from shipped behavior.

## Run contract

- **Cadence:** monthly, before a release, and after a change to documented
  architecture, operations, security, routes, permissions, or commands.
- **Owner:** the repository owner is accountable; the author of the affected
  feature performs the claim review.
- **Output format:** a Markdown audit record using the fields required by the
  [roster doctrine](README.md), with a claim/evidence/finding table and links to
  correction pull requests or backlog items.
- **Standard anchor:**
  [ISO/IEC/IEEE 26514:2022](https://www.iso.org/standard/77451.html) supplies
  documentation lifecycle and information-quality vocabulary. Diataxis supplies
  a repository-specific content-organization lens. Neither is a conformance
  target for this audit.

## Tool-performed checks

| Check | Evidence and limit |
| --- | --- |
| `pnpm run doc-lint` | Detects broken local Markdown links, stale counted test-file claims, missing documented enforcers, leaked delimiters, and environment/example drift covered by the script. It does not validate prose claims. |
| `pnpm run check` and `pnpm run smoke` | Prove the current static and runtime gates only; they do not prove that a document describes those gates accurately. |
| `pnpm run test` | Includes generated [route table](../route-table.md) drift detection; passing tests do not validate surrounding prose. |
| `pnpm run permissions:check` | Detects drift in the generated [permission table](../permission-table.md); it does not judge whether surrounding explanations are sufficient. |

## Manual checks

Choose and label the run mode before collecting evidence:

- **Full claim inventory:** use for recurring monthly and release audits.
  Inventory concrete claims throughout repository documentation and instruction
  files, including README and release notes, commands, flags, paths, routes,
  environment variables, counts, versions, instruction mirrors, and built or
  deferred assertions. Track each claim's evidence and result; an unreviewed
  inventory item prevents calling the run complete.
- **Partial change-focused audit:** review changed/high-risk claims and declare
  the sample and exclusions. This mode is useful after a bounded change but is
  not a substitute for the recurring full inventory.

1. Select claims according to the declared mode and trace each to executable
   code, configuration, a test, or a named owner decision at the audited commit.
2. Compare operational and security claims with the authoritative
   [security posture](../security.md), [route table](../route-table.md),
   [permission table](../permission-table.md), and
   [go-live checklist](../go-live-checklist.md). Link corrections to those
   documents; do not restate their inventories here.
3. Verify commands, paths, environment names, expected exit codes, and stated
   gate membership against the repository rather than prior audit prose.
4. Classify each document as explanation, procedure, reference, or learning
   material using the Diataxis lens, and flag mixed purposes only when they make
   the document unsafe or difficult to use.
5. Record sampled claims and unreviewed files as blind spots. Structural lint
   success must never be reported as documentation truth.
6. Read cited pull requests and owner decisions and verify the artifact identity,
   state, and claimed effect against current implementation. Reconcile
   instruction mirrors and built/deferred backlog assertions without importing
   upstream product scope or treating an unavailable source as evidence.
7. Check live correction/errata blocks against the exact statements they claim
   to correct. Keep dated historical evidence distinguishable from current
   behavior and clearly labeled future intent separate from implemented facts.

## Finding criteria

- A concrete claim about a command, flag, path, route, environment key, count,
  version, gate, or capability contradicts current code/configuration or the
  cited owner decision at the audited commit.
- A built/deferred assertion or correction/errata block no longer matches its
  claimed target, or a cited PR/decision supports a different state or effect.
  Cite the referring text and the conflicting evidence.
- An instruction mirror or normative document contradicts its authoritative
  source without an explicit, applicable decision resolving the difference.

Clearly labeled future intent is not a truth defect merely because it is not
implemented. Diataxis-only organization issues are style notes, not truth
findings; if organization makes an instruction unsafe, identify the concrete
misleading claim or procedure rather than citing shape alone. Unavailable
evidence is unverified, not an inferred contradiction.

## Known blind spots

- This audit starts from written claims and cannot discover every capability
  nobody documented; [completeness](completeness.md) supplies the absence lens.
- Structural lint and executable tests cannot validate all prose, decision
  rationale, or external settings. A technically true statement may still omit
  context that requires human review.
- A partial audit cannot establish truth for unreviewed files or claims. Even a
  full inventory is bounded by identified claims, accessible evidence, and the
  audited commit rather than future behavior.

