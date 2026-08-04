# UX phase — owner decisions (2026-07-17)

> Status: accepted by the owner in conversation. This file records the UX
> implementation phase. The Lost Pixel and replacement story-shot experiments
> were later retired; current Storybook and pixel policy lives in
> `app/docs/storybook.md`.

## Accepted scope (6 points, owner-amended)

1. **States as part of the layout kit** — `EmptyState` / `LoadingState` /
   `ErrorState` / `PageHeader` are first-class members of the layout-primitive
   set, not per-feature ad-hoc code.
2. **Machine-enforced conventions + component workshop** — evolve the
   sx-layout lint rule so raw layout `sx` is only allowed inside the layout
   components directory; think through **atomic design** as the organizing
   model for the component catalog; add **Storybook** plus an open-source,
   self-hosted Chromatic-style visual regression tool. Owner leaning
   (2026-07-17): **Lost Pixel (OSS mode) is the preferred candidate** — still
   confirm with a short spike before committing (fallbacks: Loki,
   storycap+reg-suit); baselines stored in-repo; we already have
   playwright-core + pixelmatch. This visual-regression candidate was later
   retired; Storybook remains the component workshop.
3. **Mobile-first is mandatory** — route visual tests run in both mobile and
   desktop viewports; stories expose responsive layout for manual review.
4. **A11y runtime scanning** — accepted but explicitly LOWEST priority of the
   six (MUI's built-in a11y does a lot already); extend the permissively licensed
   in-house scan to the screenshot/Storybook pipeline when the rest is done.
5. **PL/EN terminology glossary** — accepted; produce the glossary and align
   microcopy during the layout refactor.
6. **Creator first-run onboarding** — accepted with an architectural
   constraint: onboarding is its **own domain concept in core** (own
   use-cases/state, separate from courses/products domains) and a **separate
   UI layer** (isolated feature module), so it can be changed or dropped
   wholesale without touching anything else.

## Owner-preferred process

- Auditor walks all screens first (done by the UX audit workflow), layout
  primitives are designed from that evidence, THEN screens converge on a
  small set of reusable layout components ("should be a few of them for the
  whole app").
- Implementation is gated on: (a) owner review of `ux-layout-system.md`
  decision points, (b) audit-r3 fix loop completion (avoid refactor collisions).

## Layout-system decision points D1-D6 — RESOLVED (owner, 2026-07-17)

- **D1 Panel page titles:** quiet h1 (title + description + action, no eyebrow);
  the ledger header stays the member-side signature. (per recommendation)
- **D2 Create flows:** dedicated **create subpages** (`/panel/<kind>/new`) —
  NOT dialogs. Lists become list-first; the header "+ Dodaj" action navigates
  to the create page. (owner overrode the dialog recommendation)
- **D3 Width scale:** collapse to 4 tokens (28/32 focus, 44 prose, 60 panel,
  72 wide); "Moje kursy" moves to wide 72rem with a 3-up card grid. (per rec)
- **D4 Member mobile nav:** **bottom tab bar** on xs (owner choice over the
  account-menu fold) — persistent bottom navigation for member destinations
  (courses / products / notifications / account), notification badge on the
  bell tab; floating theme/language dev chrome must stop overlapping content.
- **D5 Lesson editing:** dedicated route `/panel/lessons/:id` (PanelPage +
  SectionCards), deep-linkable; consistent with D2. (per recommendation)
- **D6 Button casing:** sentence case everywhere, set once per theme mode in
  theme.ts (a theme MAY override deliberately, default is consistency). (per rec)

## Import decision — expiresAt = null (owner, 2026-07-17)

Non-issue: the legacy schema has `expiresAt` required, and the real data
confirms 0/780 enrollments with null. Current importer behavior stays; the
production-import gate on this question is LIFTED. (Defensive posture: the
importer already records an anomaly if such a row ever appears.)

## Next features sprint (after the UX refactor) — owner pick

**Subscriptions / recurring payments** (FR-33 + product types). Spaces/feed
and tenant branding stay in the backlog for the sprint after.

## Execution order (owner: "your preferred order, stick to the list")

1. Audit-r3 MUST/SHOULD fixes via model routing (separate track, first).
2. Layout primitives + states kit (points 1 + owner review of proposal).
3. Storybook + self-hosted visual regression, stories in mobile+desktop
   viewports from day one (points 2 + 3); atomic-design catalog structure.
4. Terminology glossary + microcopy alignment during the refactor (point 5).
5. Creator onboarding as isolated core domain + UI layer (point 6).
6. A11y runtime scans (point 4, last by owner decision).
