# Foundation provenance

Together derives from the `demo/` reference application in
[`chomamateusz/agentproofarch`](https://github.com/chomamateusz/agentproofarch).

- Fork commit: `9b4bcd560ac38bb2a98334d31c60f189a98bd9a9`
- Fork date: 2026-07-12
- Current upgrade target: `5a82eb5d2f00b856e3da0ef50b19e7aa0d6c9de1`
- Upgrade target date: 2026-07-27

The product owns its source and domain model. The portable foundation artifact is
kept synchronized by reviewing upstream changes to these paths:

- `app/eslint.config.js`
- `app/eslint-plugin-together/`
- `app/.dependency-cruiser.cjs`
- `app/tsconfig*.json`
- `app/package.json` gate scripts
- `app/scripts/doc-lint.ts`
- `app/scripts/smoke*.ts`
- `app/config-regression/`
- `.github/workflows/`
- `app/CLAUDE.md` and the layer-local agent instructions

## Deliberate divergences

- The foundation's `todos` example was replaced by Together's product domain,
  including marketing, invoicing, coupons, community, commerce, and KSeF
  slices.
- Lifecycle-bearing records use current-state projections with append-only
  events. Scheduler runs remain operational telemetry.
- Together keeps its own hand-written `playwright-core` e2e suites instead of
  the upstream Playwright test-runner suite.
- Together keeps its own multi-theme, multi-viewport visual harness and
  repository goldens instead of upstream's Playwright snapshot harness.
- Together has a first-class Polish and English i18n layer; upstream has not
  fired its i18n trigger.
- Together keeps `boundaries/external` default-deny with explicit per-layer
  allowlists instead of upstream's default-allow policy.
- Together keeps the stricter web-layout boundary: layouts may import only
  layout and theme code, not web UI or library layers.
- Together deliberately serves tenant marketing pages instead of adopting the
  upstream headless-only public-surface decision.
- Together rejects the upstream `core/server` to `core/contract` relaxation;
  `core/contract` remains the bridge between server and clients, not a server
  dependency.
- Together keeps its larger `ERROR_CODES` union and existing exhaustive CLI
  exit-code numbering.
- The Vercel platform-entry exemptions apply only to
  `apps/server/src/entry.vercel.ts`; all other app and core paths remain under
  vendor containment.
- Together temporarily uses `strict-peer-dependencies=false` because
  `better-call@1.3.7` and `@better-auth/core@1.6.23` peer-require zod 4 while
  the product remains on zod 3. pnpm may resolve peers automatically, but it
  must not fail this known conflict while the lockfile pins zod 3 for those
  packages. The setting does not approve new peer conflicts. Remove it when
  Together migrates to zod 4 or the auth dependency graph no longer requires
  it, and review peer warnings on every dependency change until then.
- pnpm does not run dependency build scripts. The empty
  `onlyBuiltDependencies` allow-list is intentional; `esbuild`, `msw`,
  `unrs-resolver`, and `odiff-bin` are recorded in `ignoredBuiltDependencies`
  so changes to the blocked set require review. The visual suite uses
  `pixelmatch`; selecting lost-pixel's odiff engine also requires explicitly
  approving and rebuilding `odiff-bin`.
- pnpm rejects releases younger than three days. The override versions excluded
  from that delay preserve the reviewed npm resolution set during migration.
  Remove an exclusion together with its override once the direct or transitive
  constraint resolves to an equally reviewed safe version.
