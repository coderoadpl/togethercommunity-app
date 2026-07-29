# core/ — rules for agents

The full repository rules live in [`../CLAUDE.md`](../CLAUDE.md). This file is
the one-screen guide for changes under `core/`.

## What this layer is

Pure TypeScript containing the domain model, server use-cases and ports, the
wire contract, and the typed HTTP client. It has no infrastructure, framework,
or I/O implementation.

## What it may import

- `core/domain` imports zod only.
- `core/server` imports `core/domain` and its own server modules. It does not
  import `core/contract`.
- `core/contract` imports `core/domain` only and is the bridge between server
  and clients.
- `core/client` imports `core/domain`, `core/contract`, and its own modules.
- Nothing in `core/` imports `adapters/` or `apps/`.

## Hard rules

- No `any`. No `as` except `as const`. Parse boundary input with zod.
- Expected domain and application failures return `Result<T, AppError>`.
- New error kinds update `ERROR_CODES` and both exhaustive HTTP and CLI
  mappings without renumbering existing exit codes.
- Every tenant-scoped use-case takes `ctx: { identity }` first.
- Every tenant-scoped repository method requires `tenantId`.

## Verify this layer

```bash
pnpm run typecheck
pnpm run lint
pnpm run depcruise
pnpm run test
```
