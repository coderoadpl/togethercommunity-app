# ADR-0012: Production tenant bootstrap

Status: accepted, 2026-08-03.

Supersedes [ADR-0008](0008-tenant-creation-policy.md).

## Context

ADR-0008 required production deployments to start with tenant creation closed.
That prevented a new self-hosted installation from completing its first-run
setup through the same application flow used in development. The role model
still has no platform-level staff principal that could provision tenants after
boot.

## Decision

`TENANT_CREATION` continues to accept `open` and `closed`. Outside production,
those values retain their literal meanings. In production, `closed` rejects all
tenant creation, while `open` selects a bootstrap mode that permits creation
only while the tenant store is empty.

The composition root translates the production environment value into the
bootstrap mode. The tenant-creation use-case checks whether any tenant exists,
and the repository enforces the empty-store precondition atomically with the
tenant and owner-grant write. Concurrent requests therefore cannot create more
than the first workspace.

The public auth configuration exposes tenant creation as available only while
bootstrap remains possible, so the web application hides the creation form
after the first workspace exists. Operators set `TENANT_CREATION=closed` after
bootstrap to make the steady-state policy explicit.

## Consequences

A fresh production installation can create its first owner and workspace
without an out-of-band provisioning command. After that first workspace,
production remains closed to public tenant signup even if the environment still
says `open`.

The setting name is less precise in production because `open` means bootstrap,
not unrestricted signup. The operational checklist must describe this mapping,
and deployments that are provisioned before launch should start with
`TENANT_CREATION=closed`.

Platform-staff provisioning remains deferred until the authorization model has
a platform principal distinct from tenant staff.
