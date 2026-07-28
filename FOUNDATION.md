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
- The Vercel platform-entry exemptions stay absent until a real platform entry
  is introduced and reviewed.
