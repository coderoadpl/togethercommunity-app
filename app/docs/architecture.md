# Architecture

Together uses a layered TypeScript architecture. `core/domain` contains pure
domain types and rules; `core/server` contains use cases and ports. Adapters
implement those ports, and server composition wires them together.
`core/contract` defines the shared HTTP boundary. Web and CLI request/response
calls go through `core/client`; neither client imports server use cases or
database adapters. See [the repository rules](../CLAUDE.md) for the enforced
layer boundaries and required verification gates.

## CLI-first verification

Verify product capabilities through the CLI first, using its JSON envelopes and
taxonomy exit codes. Add resource support in this order: domain schema, contract
route, port and use case, adapter repository, server route, client method, CLI
command, then web page. Runtime verification uses `pnpm run smoke`; completion
also requires the static `pnpm run check` gate.

The current CLI parity gap is **103 of 238 API client actions**; CLI code calls
135 actions. Regenerate the inventory after client or command changes:

```bash
pnpm run cli-parity
```

The report lists every method returned by `createApiClient` in
`core/client/http.ts`, the HTTP client consumed by the web action bindings, and
whether a TypeScript-resolved call exists in non-test CLI source. Missing
methods are grouped by the first API path segment after `/api/`. Aliases and
calls in CLI helper files count; strings, uncalled references, and unrelated
methods with the same name do not. This is a static call inventory, not proof of
runtime coverage or a comparison of command options. Auth-port methods, query
descriptors, and cache invalidation helpers are outside this API method table.
Missing methods are report-only and do not cause a nonzero exit status.

See [CLI usage and lesson preview commands](cli.md).
