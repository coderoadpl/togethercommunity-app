# UX phase — owner decisions (2026-07-17)

> Status: accepted by the owner in conversation. This file is the contract for
> the UX implementation phase. It complements `tasks/ux-screen-inventory.md`
> and `tasks/ux-layout-system.md` (both produced by the UX audit workflow).

## Accepted scope (6 points, owner-amended)

1. **States as part of the layout kit** — `EmptyState` / `LoadingState` /
   `ErrorState` / `PageHeader` are first-class members of the layout-primitive
   set, not per-feature ad-hoc code.
2. **Machine-enforced conventions + component workshop** — evolve the
   sx-layout lint rule so raw layout `sx` is only allowed inside the layout
   components directory; think through **atomic design** as the organizing
   model for the component catalog; add **Storybook** plus an open-source,
   self-hosted Chromatic-style visual regression tool (candidates: Lost Pixel
   OSS mode, Loki, storycap+reg-suit — pick via a short spike, baselines
   stored in-repo; we already have playwright-core + pixelmatch).
3. **Mobile-first is mandatory** — Storybook stories and visual tests run in
   BOTH mobile and desktop viewports for every story.
4. **A11y runtime scanning** — accepted but explicitly LOWEST priority of the
   six (MUI's built-in a11y does a lot already); axe-core scan hooked into the
   screenshot/Storybook pipeline when the rest is done.
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

## Execution order (owner: "your preferred order, stick to the list")

1. Audit-r3 MUST/SHOULD fixes via model routing (separate track, first).
2. Layout primitives + states kit (points 1 + owner review of proposal).
3. Storybook + self-hosted visual regression, stories in mobile+desktop
   viewports from day one (points 2 + 3); atomic-design catalog structure.
4. Terminology glossary + microcopy alignment during the refactor (point 5).
5. Creator onboarding as isolated core domain + UI layer (point 6).
6. A11y runtime scans (point 4, last by owner decision).
