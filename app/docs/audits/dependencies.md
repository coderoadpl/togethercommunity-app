# Dependency audit

## Run contract

- **Cadence:** automated checks on every protected-branch change, advisory
  Scorecard weekly, and manual review monthly and before a release.
- **Owner:** the dependency maintainer performs the audit; the repository owner
  accepts advisories, license exceptions, and major-upgrade risk.
- **Output format:** a Markdown audit record using the fields required by the
  [roster doctrine](README.md), with one row per advisory, stale dependency,
  license issue, or provenance gap: package/path, source, reachability, decision,
  owner, due date, and evidence.
- **Standard anchor:** OpenSSF Scorecard 5.5.0 supplies dependency-update and
  license check vocabulary; [SLSA v1.2](https://slsa.dev/spec/v1.2/) supplies
  Build L1 provenance vocabulary. This audit does not claim a SLSA level.
  OSV and the GitHub Advisory Database are advisory sources, not completeness
  guarantees.

## Tool-performed checks

| Check | Evidence and limit |
| --- | --- |
| `pnpm audit --prod --audit-level=moderate` | Blocks unaccepted moderate-or-higher production advisories in CI. It sees database matches, not application reachability or compensating controls. |
| `pnpm run lock-lint` | Detects repository-defined lockfile drift. It does not establish artifact provenance. |
| `pnpm run license-lint` | Enforces the encoded permissive-license policy and documented exceptions. It cannot decide whether a new exception is acceptable. |
| OpenSSF Scorecard 5.5.0 | Adds advisory dependency-update, pinned-dependency, token-permission, and license signals. Findings require manual triage. |

## Manual checks

1. Reconcile `package.json`, the lockfile, direct imports, build tooling, and
   runtime deployment so production, development, and transitive exposure are
   distinguished.
2. Search OSV and the GitHub Advisory Database for unresolved packages and
   review every accepted item against the rationale and revisit condition in
   the authoritative [security posture](../security.md).
3. Assess exploit reachability, affected operating systems and code paths,
   available fixes, upgrade breakage, and whether an override masks a stale
   direct dependency.
4. Review package licenses and notices under Together's repository policy;
   tools cannot authorize an exception or determine clean-room suitability.
5. Check whether released artifacts carry SLSA v1.2 provenance. Describe an
   absent provenance record as a gap, not Build L1 evidence.
6. Record advisory-database coverage, private packages, and unbuilt deployment
   paths as blind spots.

