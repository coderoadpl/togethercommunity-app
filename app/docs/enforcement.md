# Enforcement

Together keeps the foundation boundaries while retaining stricter local defaults.
ESLint enforces `boundaries/element-types`, default-deny
`boundaries/external`, `@typescript-eslint/no-explicit-any`, and the cast and
query constraints expressed through `no-restricted-syntax`.

The local `together/query-descriptors-only` rule accepts descriptors only from
the native client seam or the bound web API. The
`together/sx-layout-only` rule reserves visual styling for the theme and keeps
its shrink-only baseline explicit.

Dependency Cruiser independently enforces `core-domain-depends-on-nothing`,
`core-server-pure`, `web-never-server-side`, `web-features-are-islands`,
`web-layout-structure-only`, and `vercel-and-neon-only-in-adapters`. Vendor
containment is reinforced by `auth-provider-sdk-only-in-adapters-auth` and
`smtp-sdk-only-in-adapters-email`.

Page chrome is split between the stateless `components/layout/AppShell.tsx`
skeleton and the stateful panel composition. Layout components own only
structure and receive content through slots. Loading, error, empty, and
not-found are page states rendered inside their stable owning skeleton, never
full-page structural replacements.

`npm run check` also verifies the npm lockfile, dead code and dependency
declarations, documentation promises, and the test suite.
