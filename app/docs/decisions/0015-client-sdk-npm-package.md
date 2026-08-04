# ADR-0015: Client SDK npm package

Status: accepted, 2026-08-04.

## Context

The mobile split currently carries a vendored snapshot of the client core.
That mobile application and third-party integrations need the same surface as
an installable, versioned artifact. ADR-0009 deliberately deferred release
machinery for the application.

## Decision

Together publishes `app/packages/client-sdk` as a public npm package containing
the client, contract, domain, and authentication client adapter. It never
contains `core/server`. The package is ESM-only and provenance-attested.

The SDK follows an independent strict-SemVer line. `sdk-v*` tags release it
through npm trusted publishing without a long-lived npm token. The first
publish and trusted-publisher configuration remain owner actions.

This ADR amends nothing in ADR-0009. The application still has no tag workflow
or automated version bump. The `sdk-v*` tags version only the SDK package.

## Consequences

The `check` gate builds the SDK through its configuration-regression test. The
standalone mobile repository will replace its vendored snapshot in a follow-up:
once the first SDK version is live, its core synchronization script becomes a
normal package dependency.
