# ADR-0008: Tenant creation policy

Status: accepted, 2026-07-28.

## Context

Local development, smoke, and end-to-end flows create isolated tenants through
the public application contract. Production tenant provisioning needs a
deliberate operator decision, but the current role model has no platform-level
staff principal distinct from tenant staff.

## Decision

`TENANT_CREATION` supports `open` and `closed`. It defaults to `open` outside
production so the documented quickstart and deterministic gates exercise the
same tenant-creation route as the product. Production refuses to boot unless
the value is explicitly `closed`.

The public auth configuration exposes whether tenant creation is enabled, and
the web application renders the creation form only when that capability is
available. The server use-case remains the enforcement boundary.

The foundation's `staff` mode is deferred to the stage 3 default-deny
authorization work because implementing it now would invent a platform
principal and silently change the meaning of tenant staff roles.

## Consequences

Production provisioning remains closed until a later authorization decision.
Development and test installations remain usable without hidden environment
overrides, while setting `TENANT_CREATION=closed` locally exercises the
production UI and server denial path.
