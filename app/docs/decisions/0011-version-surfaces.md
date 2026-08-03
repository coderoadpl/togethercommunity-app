# ADR-0011: Version surfaces

Status: accepted, 2026-07-31.

## Context

[ADR-0009](0009-release-versioning-and-version-surfaces.md) decides Together's
release versioning policy, single version source, build identity surfaces, and
deferred release hygiene. This ADR records the implementation refinements made
after that decision so the browser, CLI, settings, and visual-regression
behavior stay tied back to ADR-0009 instead of becoming a second independent
versioning policy.

agentproofarch ADR-0014 provides the pattern: keep the semantic version in one
manifest, inject browser build identity at build time, and compare browser and
server identity where a live server check is appropriate.

## Decision

ADR-0009 remains authoritative. `app/package.json` remains the single source for
the application semantic version. Server, web, and CLI surfaces read or receive
that value from the manifest path that already belongs to their layer.

The login screen shows a discreet browser bundle stamp from build-time
constants only. It performs no fetch. When `APP_COMMIT_SHA` is unavailable, the
stamp shows only the semantic version.

The signed-in settings surface shows the browser version and short commit SHA
alongside the server version and SHA returned by the existing health action. A
visible warning appears when the browser and server identities differ. The
health response shape is unchanged. If either side reports `unknown` for the
commit SHA, the settings comparison treats the SHA as unverifiable instead of
stale.

The CLI `--version` flag and `version` command print only the semantic version.
The CLI does not display a commit SHA because it runs from source and has no
separate build attestation. The server SHA remains available through the
existing health command. This intentionally changes the human `version` command
from `together/<version>` to the bare semantic version.

The visual harness masks the browser build stamp for every route capture.
Version bumps therefore do not change goldens unless the version surface's
layout or presence changes.

## Deferred

Release-cut procedure is deferred to the first public release and tracked in
the backlog. That procedure includes reviewed version bumps, changelog markers,
and release tags. Until that decision is made, the version remains
<!--release-version-->`0.1.0`<!--/release-version-->
and only these surfaces ship.
