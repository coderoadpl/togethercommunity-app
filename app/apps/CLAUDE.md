# apps/ — rules for agents

The full repository rules live in [`../CLAUDE.md`](../CLAUDE.md). This file is
the one-screen guide for changes under `apps/`.

## What this layer is

The deliverable edges: the Hono server, React SPA, and command-line client.
These modules compose and deliver behavior; domain rules remain in core.

## What it may import

- `apps/server` imports server use-cases, contract types, and adapters through
  the enforced composition graph.
- `apps/web` and `apps/cli` import `core/client` and `core/contract`, plus the
  auth client adapter at their approved construction sites.
- Web and CLI never import `core/server` or database adapters.
- Nothing in `core/` or `adapters/` imports `apps/`.

## Hard rules

- Routes parse against the contract, invoke use-cases, and map results without
  owning business rules.
- Web features consume bound client actions from `apps/web/src/api.ts`; direct
  HTTP and client construction elsewhere are forbidden.
- Layout code remains structure-only and keeps Together's strict layout
  boundary.
- Verify product capabilities through the CLI first; use browser and visual
  checks when rendered behavior is in scope.

## Verify this layer

```bash
pnpm run typecheck
pnpm run lint
pnpm run depcruise
pnpm run test
```
