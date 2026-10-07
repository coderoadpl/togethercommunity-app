# Dependency audit

## Run contract

- **Cadence:** automated checks on every protected-branch change, advisory
  Scorecard and Renovate weekly, and manual review monthly and before a release.
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
| `pnpm audit --prod --audit-level=moderate` | Blocks unaccepted moderate-or-higher production advisories through `check` only when a pull request changes `app/package.json` or `app/pnpm-lock.yaml`, targets `main`, or runs on a push to `main`; elsewhere the advisory `dependency-audit` job reports without blocking. It sees database matches, not application reachability or compensating controls. |
| `pnpm run lock-lint` | Detects repository-defined lockfile drift. It does not establish artifact provenance. |
| `pnpm run license-lint` | Enforces the encoded permissive-license policy and documented exceptions. It cannot decide whether a new exception is acceptable. |
| OpenSSF Scorecard 5.5.0 | Adds advisory dependency-update, pinned-dependency, token-permission, and license signals. Findings require manual triage. |
| Renovate | Groups non-major, pin, and digest updates in one weekly pull request, keeps majors separate, and performs weekly lockfile maintenance. Every pull request remains subject to the full gates and permissive-license policy. |

The repository-root Renovate configuration discovers Together's pnpm root at
`app/`. Its three-day release cooldown mirrors `minimumReleaseAge: 4320` in
`app/pnpm-workspace.yaml`. Renovate may keep at most three pull requests open at
once. The configuration remains inert until the repository owner installs and
authorizes the Renovate GitHub App.

## Manual checks

1. Reconcile `package.json`, the lockfile, direct imports, build tooling, and
   runtime deployment so production, development, and transitive exposure are
   distinguished.
2. Confirm Renovate targets the `app/` pnpm root, respects the three-day
   cooldown, and leaves major updates outside the non-major group.
3. Search OSV and the GitHub Advisory Database for unresolved packages and
   review every accepted item against the rationale and revisit condition in
   the authoritative [security posture](../security.md).
4. Assess exploit reachability, affected operating systems and code paths,
   available fixes, upgrade breakage, and whether an override masks a stale
   direct dependency.
5. Review package licenses and notices under Together's repository policy;
   tools cannot authorize an exception or determine clean-room suitability.
6. Check whether released artifacts carry SLSA v1.2 provenance. Describe an
   absent provenance record as a gap, not Build L1 evidence.
7. Record advisory-database coverage, private packages, and unbuilt deployment
   paths as blind spots.

## MinIO test-image provenance — 2026-10-02

The unaffiliated prebuilt MinIO test image was replaced with an image built in
the repository from checksum-pinned vendor server release
`RELEASE.2025-09-07T16-13-09Z` and client release
`RELEASE.2025-08-13T08-35-41Z`, the newest client release not later than the
server release. The open-source MinIO server and client projects are archived
upstream; the dependency maintainer owns future release and checksum reviews,
with no open due date.
