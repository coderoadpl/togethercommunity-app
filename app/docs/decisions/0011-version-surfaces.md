# ADR-0011: Version surfaces

Status: accepted, 2026-07-31.

## Context

Together already exposes server build identity through the health endpoint. The
product also needs visible identity surfaces so a user or operator can
distinguish the browser bundle, CLI source version, and connected server build.

agentproofarch ADR-0014 provides the pattern: keep the semantic version in one
manifest, inject browser build identity at build time, and compare browser and
server identity where a live server check is appropriate.

## Decision

`app/package.json` remains the single source for the application semantic
version. Server, web, and CLI surfaces read or receive that value from the
manifest path that already belongs to their layer.

The login screen shows a discreet browser bundle stamp from build-time
constants only. It performs no fetch. When `APP_COMMIT_SHA` is unavailable, the
stamp shows only the semantic version.

The signed-in settings surface shows the browser version and short commit SHA
alongside the server version and SHA returned by the existing health action. A
visible warning appears when the browser and server identities differ. The
health response shape is unchanged.

The CLI `--version` flag and `version` command print only the semantic version.
The CLI does not display a commit SHA because it runs from source and has no
separate build attestation. The server SHA remains available through the
existing health command.

## Deferred

Release-cut procedure is deferred to the first public release and tracked in
the backlog. That procedure includes reviewed version bumps, changelog markers,
and release tags. Until that decision is made, the version remains `0.1.0` and
only these surfaces ship.
