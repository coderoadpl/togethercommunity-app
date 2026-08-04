# agentproofarch upgrade plan (2026-07-28)

> Owner request 2026-07-27: adapt the whole app to the latest agentproofarch.
> Discovery artifacts (source of detail for every item id below, prywatne
> artefakty audytowe właściciela): `INVENTORY.md` (496 lines,
> all 13 ADRs + skeleton diff since the 2026-07-12 fork) and
> `IMPACT-MAP.md` (verdict ADOPT/ADAPT/SKIP/CONFLICT for every relevant item,
> with file refs and effort). ~320 upstream commits reviewed.

## Headline findings

1. **Together has NO CI at all** — ADR-0004's required-gate topology is
   missing entirely; local gates are our only net. (Stage 1 fixes this.)
2. **Enforcement layer is byte-pinned to the pre-fork skeleton** and carries
   three known rule bypasses (query-descriptors accepts any import-shaped
   specifier; sx-layout misses nested/quoted `sx:`; stale eslint-disable not
   an error) plus six enforcers that exist upstream and not here (knip,
   doc-lint, lock-lint, migration-lint, config-regression/, DOM-free island
   typecheck).
3. **No default-deny authorization** — ad-hoc `staffRole` checks across ~60
   use-cases vs upstream's capability matrix + structural probe. (Stage 3.)
4. **No HTTP security baseline** (secure headers/CSP/body-limit/CORS/CSRF)
   and public routes live inside the 2501-line `app.ts`. (Stage 2.)
5. **Atomicity hazard**: DB_DRIVER accepts neon-http while eight adapters use
   interactive transactions — including invoice/coupon/KSeF money paths.
   (Stage 2 answers and guards it.)

Where TOGETHER IS STRONGER, we keep ours (map's explicit conflicts):
`boundaries/external default: 'disallow'`, the stricter web-layout rule, our
richer e2e/visual suites, our larger ERROR_CODES union with its exit-code
numbering, our full i18n layer (upstream has none). Never regenerate
`sx-layout-baseline.json` to absorb violations the hardened rule surfaces.

## Stage 1 — provenance, toolchain, portable enforcement (THIS overnight)

No product behavior changes. Order inside the stage matters (map §8):
D1 FOUNDATION.md → T1 Node 24 + .nvmrc, D2 per-layer CLAUDE/AGENTS, D4
capability-truth sweep, T3 flake doctrine, E15 stale-exemption cleanup →
E13 native `#core`/`#adapters` codemod (before E2) → ⚠ENF hardening E1, E2,
E3, E6 (each its own commit with the surfaced-violation count; fix the
violations, never baseline them away) → new enforcers E11 lock-lint, E9 knip,
E10 doc-lint, E8 gates.test.ts → T2/A4 GitHub Actions CI (check+smoke+e2e,
SHA-pinned actions), T5 quickstart probe, T4 shared server harness → D3
architecture-doc extraction in parallel.

**Deferred out of stage 1 (deliberate):** A9 pnpm migration — package-manager
swap interacts with every worktree's node_modules symlink and is safest as
its own PR validated by the CI this stage creates.

## Stage 2 — server edge (owner answers recorded 2026-07-28)

Owner decisions: (1) the six public mutating surfaces (unsubscribe /u/*, DOI
confirm, SNS webhook, Stripe webhook, checkout session start, login/magic
link) are confirmed "wyglada okej" with stated uncertainty — therefore stage
2 MUST ship an explicit public-route manifest + a fail-closed
config-regression test (any new public mutating route breaks the gates until
consciously listed) and produce a full route table for owner review.
(2) Deployment target: Vercel CONFIRMED — stage 2 builds the full topology
(entry.vercel.ts with its enforcement carve-outs restored, environments,
remote smoke); platform login + first deploy stay with the owner.

A6+S2+S5 app.ts split into internal/public + secure headers/CSP/body-limit/
CORS + cache seam — **owner question first: confirm the list of mutating
public endpoints** (map §9). Then S3/S4/S6/S1 envelope+CLI+health+doctrine
(keep our exit codes), A12 per-origin CLI profiles, S8+E12 neon-http answer +
must-atomic probe + migration-lint, A10 tenant-creation policy, A3/T6
deployment topology (Vercel decision is on the owner's list), A7 Mailpit.

## Stage 3 — architecture (separate PRs, highest judgment)

S7 default-deny capability authorization (model → slice-by-slice →
fail-closed config-regression probe), A2 identity pass, A5+E4+E14 island
cores (rules inert + one pilot), A11 AppShell split (keep our stricter
rule), A8 visual determinism knobs, A13 visual review loop only after CI +
native baselines.

## Open questions for the owner (from map §9)

Deployment target confirmation (vercel.json exists, no entry file — entry is
already on the owner's waiting list), mutating public endpoints for stage 2,
member-aggregate parity details (A2), sx-rule fallout size (known after E3
lands).


## Executed (2026-07-28)

All three stages merged the same day, each through implement -> Opus review ->
fixes -> Fable convergence audit -> independent gate verification -> CI watch:

- Stage 1 (PR #13 + CI fix #14): provenance, codemod, enforcement hardening,
  new enforcers, GitHub Actions CI from scratch.
- Stage 2 (PR #15): server edge split + security baseline, fail-closed route
  manifests (owner decision), envelopes/CLI/health, atomicity guards, Vercel
  topology (ADR-0003/0007/0008).
- Stage 3 (PR #16): default-deny capability authorization with a code-proven
  zero-permission-change contract (docs/permission-table.md).
- Stage 3 finale (PR #17): island cores inert + checkout pilot island,
  AppShell PageState doctrine, visual determinism knobs with an audited
  one-time golden regeneration.

Deferred by plan: pnpm migration (own PR, after CI bake-in); authz follow-ups
(probe shapes, matrix rows at synthetic edges) and the coupon-UI browser e2e
gap are in the Todoist backlog. Final gates at merge: check 1345 tests /
smoke / visual 210 / e2e subs+marketing+auth+poc, CI green on every merge.

## Follow-up (2026-08-03, from parity #102 deps PR)

- Upgrade drizzle-kit to 1.x once better-auth supports drizzle-orm 1.0 (peer is
  `drizzle-orm: ^0.45.2` at better-auth 1.6.25; drizzle-kit 1.x requires the
  `drizzle-orm/_relations` export that only exists from 1.0). Unblocks esbuild
  0.25 in the drizzle chain and lets GHSA-67mh-4wv8-2f99 leave the audit
  allowlist. Details: app/docs/security.md.
