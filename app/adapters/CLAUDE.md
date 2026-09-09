# adapters/ — rules for agents

The full repository rules live in [`../CLAUDE.md`](../CLAUDE.md). This file is
the one-screen guide for changes under `adapters/`.

## What this layer is

Concrete implementations of server and client ports: persistence, authentication,
cryptography, email, invoicing, notifications, payments, scheduling, storage,
and video delivery. Vendor SDKs and infrastructure details stay here.

## What it may import

- `core/domain` and ports from `core/server` or `core/client`. The auth client
  adapter implements `AuthClientPort` and imports its result types from
  `core/client`; this is an inward dependency.
- Infrastructure packages allowed for the specific adapter by the external
  dependency allowlists.
- Never `apps/**`. The reverse edge, `core/client` importing adapters, is
  prohibited by `core-client-never-server-side` in `.dependency-cruiser.cjs`.

## What may import it

- `apps/server/src/composition.ts` wires runtime server adapters and delegates
  realtime transport selection and construction to `realtime-transport.ts`.
  The import gates allow server modules to import adapters; they do not enforce
  construction exclusively in `composition.ts`.
- The web API module and CLI context may construct the auth client adapter.
- Database migration, seed, import, and gate scripts may compose operational
  adapters where the dependency rules permit it.

## Hard rules

- Implement ports without adding product behavior to adapters.
- No `any`. No `as` except `as const`.
- Parse external input before returning it to core.
- Keep vendor SDKs inside their owning adapter directories.

## Database runtime and migrations

`adapters/db/client.ts` retains both driver branches, but server environment
validation accepts only `node-postgres` because runtime repositories require
interactive transactions.

The SHA-256 literal in `drizzle/0105_record_skipped_0080.sql` records the exact
bytes of `0080_next_martin_li.sql` in Drizzle migration history; preserve those
bytes because `migration-lint` does not verify this hash.

## Verify this layer

```bash
pnpm run typecheck
pnpm run lint
pnpm run depcruise
pnpm run test
```
