# Foundation provenance

Together derives from the `demo/` reference application in
[`coderoadpl/agentproofarch`](https://github.com/coderoadpl/agentproofarch).

- Fork commit: `9b4bcd560ac38bb2a98334d31c60f189a98bd9a9`
- Fork date: 2026-07-12
- Current upgrade target: `19d31b1cf6cffe35fda45bf989429e0f4e3e7ef0`
- Upgrade target date: 2026-08-05

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
- `.github/CODEOWNERS`
- `renovate.json`
- `app/knip.json`

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
  `onlyBuiltDependencies` allow-list is intentional; `esbuild`, `msw`, and
  `unrs-resolver` are recorded in `ignoredBuiltDependencies` so changes to the
  blocked set require review. The visual suite compares PNGs with `pixelmatch`,
  which needs no native build step; adopting a native comparison engine would
  require an owner decision and a new `ignoredBuiltDependencies` review.
- pnpm rejects releases younger than three days. The override versions excluded
  from that delay preserve the reviewed npm resolution set during migration.
  Remove an exclusion together with its override once the direct or transitive
  constraint resolves to an equally reviewed safe version.
- Together derives release versions from promotion and merge history
  (`app/docs/versioning.md`) instead of upstream's human release cut, manifest
  version source, and documentation snapshots. Together's 0.x HTTP API makes no
  compatibility promise (`app/docs/version-surfaces.md`), so upstream's
  additive-only v1 rule is not adopted.
- Together does not adopt upstream's leading-gitmoji pull request title rule:
  the release-notes generator (`app/scripts/changelog.ts`) groups pull requests
  by a leading `feat:`, `fix:`, `ui:`, `docs:` or `ci:` prefix and lists every
  other title in a catch-all section.
- The password floor is 15 characters (`app/core/domain/password.ts`,
  `app/docs/security.md`), stricter than upstream's 12, because second-factor
  enrolment is optional.
- A self-hosted instance may create its first workspace before the creator's
  address is verified (`app/docs/self-host.md`); upstream denies workspace
  creation to every unverified address.
