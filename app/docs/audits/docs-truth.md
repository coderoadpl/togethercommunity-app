# Documentation-truth audit

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

1. Select every changed or high-risk claim and trace it to executable code,
   configuration, a test, or a named owner decision at the audited commit.
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

