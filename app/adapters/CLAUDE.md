# adapters/ — rules for agents

The full repository rules live in [`../CLAUDE.md`](../CLAUDE.md). This file is
the one-screen guide for changes under `adapters/`.

## What this layer is

Concrete implementations of server ports: persistence, authentication,
cryptography, email, invoicing, notifications, payments, scheduling, storage,
and video delivery. Vendor SDKs and infrastructure details stay here.

## What it may import

- `core/domain`, `core/server` ports, and contract types needed at an external
  boundary.
- Infrastructure packages allowed for the specific adapter by the external
  dependency allowlists.
- Never `apps/**` and never `core/client`.

## What may import it

- `apps/server/src/composition.ts` wires runtime server adapters.
- The web API module and CLI context may construct the auth client adapter.
- Database migration, seed, import, and gate scripts may compose operational
  adapters where the dependency rules permit it.

## Hard rules

- Implement ports without adding product behavior to adapters.
- No `any`. No `as` except `as const`.
- Parse external input before returning it to core.
- Keep vendor SDKs inside their owning adapter directories.

## Verify this layer

```bash
pnpm run typecheck
pnpm run lint
pnpm run depcruise
pnpm run test
```
