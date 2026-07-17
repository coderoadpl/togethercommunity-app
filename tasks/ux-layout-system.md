# Together — Reusable Layout System Proposal

**Date:** 2026-07-17
**Input:** [`tasks/ux-screen-inventory.md`](./ux-screen-inventory.md) (44 screens, 96 screenshots), `apps/web/src/theme.ts`, the `together/sx-layout-only` lint rule, and the composition idioms in `MyCoursesPage.tsx`, `PanelLayout.tsx`, `ProductsPanel.tsx`, `LoginPage.tsx`.
**Status:** migration executed (S1–S3 + panel skeleton + list-first) and visually QA'd across 7 themes — see §7.

---

## 1. Design intent

The inventory found that the whole app already gravitates toward **three page skeletons** (P1 centered card, P2 member ledger, P3 admin shell) plus a handful of recurring sub-structures (list toolbars, settings cards, empty/loading/error branches, confirm dialogs). Nothing exotic is needed — the job is to **name what already exists, build each exactly once, and make the ad-hoc copies illegal**.

Two hard constraints shape the design:

1. **The one-file theme stays the sole visual authority.** `theme.ts` owns colors, type, borders, radii and component overrides across all 7 modes; the theming spot-check proved layout survives every mode because structure already comes from styled atoms (`LedgerHeader`, `StatTile`, `EmptyStateContent`, …) exported from that file. The layout primitives therefore contain **structure only**: grid/flex/spacing/width. Every visual decision they need (rules, eyebrows, tile chrome) is consumed from the styled atoms and tokens (`theme.headerRule`, `GRID`, palette, typography) that `theme.ts` already exports. No second styling file appears; `theme.ts` gets *more* leverage, because a token change now propagates through 7 layout files instead of 44 pages.

2. **The `sx-layout-only` rule is the enforcement seed.** Today it reserves color/typography/background/border keys for `theme.ts` (baseline is already empty — zero debt). The same tiered-baseline mechanism can be extended so that *structural* sx concentrates into the layout directory the same way visual sx concentrated into the theme (§5).

Division of labor after this proposal:

| Concern | Single home |
|---|---|
| Visual language (colors, type, borders, per-theme overrides, styled atoms) | `apps/web/src/theme.ts` (unchanged role) |
| Page structure (skeletons, widths, header anatomy, rails, toolbars, state branches) | `apps/web/src/components/layout/` (new, ~7 files) |
| Feature content (forms, rows, players, discussion) | `features/**`, composed as children of layout primitives |

---

## 2. The primitives (7)

Aim was 4–7; the evidence supports exactly **three page skeletons + four shared sub-primitives**. `PageHeader` is deliberately **not** a standalone export — the inventory shows six divergent title treatments precisely because every page assembles its own header; baking the header into each skeleton (as required props, not an optional slot) is what makes divergence impossible. `EmptyState`/`LoadingState`/`ErrorState` are folded into one `StatusView` because the inventory's #6 top issue (width jumps on pending/error branches) is only fixable if all three render inside the *same* skeleton at the *same* width.

Naming/props follow the existing idioms: slots are `ReactNode`, callers pass i18n strings, `data-testid` passes through, atoms come from `theme.ts`.

### 2.1 `FocusCard` — the centered narrow flow (P1)

**Responsibility:** full-viewport centered single-column card for every unauthenticated / focused flow. Owns: viewport centering grid, card width, wordmark + eyebrow treatment, internal stack rhythm, fine-print placement, mobile padding (and clearing the floating dev chrome).

```tsx
interface FocusCardProps {
  eyebrow: ReactNode;            // "logowanie · studio", "płatność przyjęta", "404"
  children: ReactNode;           // body: fields, copy, CTA — composed by the feature
  width?: 'narrow' | 'wide';     // narrow ≈ 28rem (auth), wide ≈ 32rem (checkout, picker)
  brand?: ReactNode;             // defaults to <Wordmark>Together</Wordmark>; tenant-not-found may override
  footer?: ReactNode;            // fine print / demo creds / register link, rendered in <FinePrint> rhythm
  'data-testid'?: string;
}
```

**Standardizes:** exactly one card anatomy (brand → eyebrow → body → divider → footer), one width pair replacing today's 23/29/31/32rem spread, left-aligned text everywhere (kills the tenant-not-found deviation), the outlined-Paper variant, vertical rhythm between stacked sections.
**Renders:** login (+magic-sent), register, reset-password, checkout ×4, tenant-not-found, tenant-picker — **10 screens**.

### 2.2 `MemberPage` — the member ledger (P2 / P2a)

**Responsibility:** the member-facing page skeleton: `LedgerHeader` (h1 title, eyebrow, hairline via `theme.headerRule`), standardized utility nav (links + `NotificationBell` + `MemberAccountMenu` — same set on every page), optional breadcrumbs (promoting the lesson-player idiom app-wide), fixed width scale, optional sticky rail with correct mobile ordering.

```tsx
interface MemberPageProps {
  title: ReactNode;                       // h1 in LedgerHeader
  eyebrow: ReactNode;                     // overline under the title
  width?: 'prose' | 'wide';               // prose = 44rem (account, products); wide = 72rem (course, lesson)
  breadcrumbs?: { label: string; to: string }[];  // renders above the title; replaces ad-hoc right-links
  rail?: ReactNode;                       // sticky right column (24rem); grid 1fr/24rem, rail-first on xs
  state?: PageState;                      // see StatusView — pending/error render INSIDE this skeleton
  children?: ReactNode;
}
```

Utility nav is rendered by `MemberPage` itself (not a slot): the inventory shows the utility set drifting per page (`/my` vs `/account` vs the mislabeled `/my/products` link) — that is a bug class, not a customization point. On xs the text links collapse into `MemberAccountMenu`.

**Standardizes:** title/eyebrow/rule treatment, one nav with real hit areas and mobile collapse, breadcrumb pattern (currently on exactly one screen), the 44/72rem width pair replacing 44/52/72 (see decision D3 for the 52rem library page), rail stickiness and mobile ordering, bottom padding rhythm.
**Renders:** my-courses (all 4 state variants), my-products, product-overview, course-overview (+search, +locks), lesson player (+discussion, +video, +locked after redesign), account, course-not-found — **13 screens/states**.

### 2.3 `PanelPage` — the admin page (P3)

**Responsibility:** everything between the existing `PanelLayout` shell (AppBar + drawer stay as-is) and feature content: a mandatory page header (title, optional description, optional primary action, optional back-link) and the content stack rhythm. Fixes the inventory's #5 top issue — the panel currently has *no* page-header component and five title treatments.

```tsx
interface PanelPageProps {
  title: ReactNode;                       // one treatment for all 13 panel screens (see decision D1)
  description?: ReactNode;                // one-liner under the title
  action?: ReactNode;                     // primary action button, right-aligned; wraps below title on xs
  backTo?: { label: string; to: string }; // detail pages (course detail, member detail)
  state?: PageState;                      // pending/error inside the skeleton, width stable
  children?: ReactNode;                   // content stack (SectionCards, ListSections) with fixed gap
}
```

**Standardizes:** title level and spacing, action placement (top-right — the precondition for the list-first inversion of create forms), back-navigation (one pattern instead of "← text button" vs right-link vs nothing), section gap rhythm, 60rem width from the shell.
**Renders:** dashboard, products, courses, lessons, members, member detail, course detail, sales, integrations, settings + 5 empty-tenant variants — **18 screens**.

### 2.4 `ListSection` — index/list toolbar + collection

**Responsibility:** the one way to render a filterable collection: search + filter chips (promoting the Lessons toolbar, the best in the app), the collection body (rows or table), pagination, and the empty branch — with the toolbar auto-hidden when the collection is empty and unfiltered (inventory #41–44).

```tsx
interface ListSectionProps {
  title?: ReactNode;                       // section h2 when the list is not the whole page
  toolbar?: {
    search?: ReactNode;                    // existing <SearchField/>
    filters?: ReactNode;                   // Chip group
    actions?: ReactNode;                   // e.g. Eksportuj CSV/JSON
  };
  pagination?: ReactNode;                  // existing <ListPagination/>
  isEmpty: boolean;                        // collection empty *before* filtering
  empty: ReactNode;                        // a <StatusView state={{kind:'empty',…}}/> with CTA
  noMatches?: ReactNode;                   // filtered-to-zero message (search stays visible)
  children: ReactNode;                     // rows: Paper rows, CourseCard grid, or ResponsiveTable
}
```

Includes one shared row/table wrapper: a `ResponsiveTable` child component (plain `overflow-x: auto` scroller) fixing the clipped mobile tables (inventory #3 top issue). Unifying the five row idioms into one `EntityRow` is a follow-up inside this component's directory, not a blocker.

**Standardizes:** toolbar order and spacing, chips-next-to-search pattern, empty-vs-no-matches distinction, table overflow behavior, pagination placement.
**Used by:** panel products/courses/lessons/members lists, member-detail grants table, dashboard recent-members, my-products — **7+ collections**.

### 2.5 `SectionCard` — form / settings section

**Responsibility:** one Paper section with a consistent internal anatomy — replaces the three competing card-title styles (eyebrow-as-title, h2-in-paper, bare h2 above paper) flagged in inventory rows 26/38/39.

```tsx
interface SectionCardProps {
  title: ReactNode;                        // always h2 — eyebrows go back to being eyebrows
  description?: ReactNode;
  actions?: ReactNode;                     // footer row, right-aligned (Zapisz, Testuj połączenie)
  children: ReactNode;                     // fields / content, standardized field gap
  'data-testid'?: string;
}
```

**Standardizes:** card title level, description placement, field rhythm, action-row alignment, one-card-per-topic granularity (Integrations becomes one card per vendor, like Settings already does).
**Renders sections of:** member account, panel settings, panel integrations, grant-product form, create forms (until/if they move into dialogs per D2), lock/upsell card — **6+ screens**.

### 2.6 `StatusView` — loading / error / empty / not-found

**Responsibility:** every non-happy branch, rendered *inside* the owning skeleton (`state` prop of `MemberPage`/`PanelPage`, or `empty` slot of `ListSection`) so width and chrome never jump. Directly kills the missing-`!important` width bug class (inventory #6) by construction — pages stop hand-rolling `Container` for branches at all.

```tsx
type PageState =
  | { kind: 'ready' }
  | { kind: 'loading'; label: ReactNode }
  | { kind: 'error'; message: ReactNode; retry?: () => void }
  | { kind: 'empty'; icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }
  | { kind: 'not-found'; title: ReactNode; body?: ReactNode; action?: ReactNode };
```

The `empty`/`not-found` kinds are the member app's `EmptyStateContent` (icon + title + body + CTA) promoted to the whole app — the panel's bare-sentence empties and the full-width course-not-found paper all converge here.
**Renders:** every pending/error branch (all pages), 4 panel empty lists, member empty library, expired-member variant (with renew CTA), course-not-found.

### 2.7 `ConfirmDialog` — destructive confirmation

**Responsibility:** the single confirm pattern (title, consequence sentence, cancel + destructive confirm with pending state), on MUI `Dialog` so all 7 themes style it via existing overrides.

```tsx
interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: ReactNode;                 // sentence case, error color
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}
```

**Standardizes:** button order/casing/color, pending handling — and closes the inventory's #2 top issue: member removal gets a confirm like every other destructive action.
**Used by:** member remove (new), lesson delete, grant revoke, progress reset, post delete — **5 flows**.

**Explicitly not primitives:** the `PanelLayout` shell (already a single component — it just gains `PanelPage` inside it), the discussion module (unique, internally consistent — stays a feature), dialogs other than confirm (Bunny picker stays bespoke), stat tiles (`StatTile*` atoms already in theme.ts).

---

## 3. Screen-by-screen mapping

Verdicts from the inventory carry over; "delta" = expected pixel change when only re-skeletoning (redesign verdicts note their extra, separately-approved delta).

| # | Screen | Target composition | Migration notes | Visual delta |
|---|--------|--------------------|-----------------|--------------|
| 1 | Login | `FocusCard(narrow)` | Re-skeleton now; the tabbed member/staff redesign is a separate owner-approved step | minor alignment (redesign later: visible) |
| 2 | Login magic-sent | `FocusCard(narrow)` + swapped body | Body swap to a confirmation view (like checkout-success) | visible improvement |
| 3 | Register | `FocusCard(narrow)` | Reference P1 instance — port 1:1; becomes the FocusCard acceptance test | none |
| 4 | Reset password | `FocusCard(narrow)` | Tokenless guard = `StatusView(not-found)` inside the card | none |
| 5 | Checkout offer | `FocusCard(wide)` | Order-summary block is content, not layout | minor alignment |
| 6 | Checkout success | `FocusCard(narrow)` | Add CTA (content) | none |
| 7 | Checkout cancelled | `FocusCard(narrow)` | — | none |
| 8 | Checkout unavailable | `FocusCard(narrow)` + `StatusView(not-found)` | Gains escape-hatch action slot | minor alignment |
| 9 | Tenant not found | `FocusCard(narrow)` | Loses centered-text deviation, regains wordmark | minor alignment |
| 10 | Tenant picker/create | `FocusCard(wide)` | Field rename/copy = content changes | minor alignment |
| 11 | My courses | `MemberPage(wide?)` — see D3 | Real nav with mobile collapse; card grid unchanged | minor alignment (mobile header: visible) |
| 12 | My courses empty/expired | `MemberPage` + `StatusView(empty)` | Expired variant gets distinct message + renew CTA | visible improvement (expired) |
| 13 | Notifications popover | unchanged (P6) | Out of scope | none |
| 14 | My products | `MemberPage(prose)` + `ListSection` | Width unified with siblings; status/date = content | minor alignment |
| 15 | Product overview stub | `MemberPage(prose)` + `StatusView(empty)` | Or de-link rows (D5-adjacent product call) | visible improvement |
| 16 | Course overview | `MemberPage(wide, rail)` | The donor screen — extract, don't redesign | none |
| 17 | Course discussion search | rail module inside `MemberPage` | Unchanged; overlay idea is future work | none |
| 18 | Lesson player | `MemberPage(wide, rail, breadcrumbs)` | Block-chrome merge is content-level, separate | none (block merge later: visible) |
| 19 | Lesson discussion | feature module, unchanged | — | none |
| 20 | Lesson video block | as 18 | — | none |
| 21 | Lesson locked | `MemberPage(wide, rail)` + `SectionCard` lock/upsell card | Redesign per inventory: page chrome restored, product+price, one CTA | visible improvement |
| 22 | Course tree locks | as 16 | — | none |
| 23 | Free-preview my-courses | as 11 | Access badge = content | minor alignment |
| 24 | Staff viewing /my | as 11 + staff banner slot-content | Banner is content in the skeleton | minor alignment |
| 25 | Course not found | `MemberPage(prose)` + `StatusView(not-found)` | Kills the unbounded-width bug instance | visible improvement |
| 26 | Member account | `MemberPage(prose)` + 3× `SectionCard` | First card's eyebrow-title becomes h2 | minor alignment |
| 27 | Panel dashboard | `PanelPage` | Gains a real title; tiles + recent list unchanged (recent rows → `ListSection` later) | minor alignment |
| 28 | Panel products | `PanelPage(action: Nowy produkt)` + `ListSection` | List-first inversion; create per D2 | visible improvement |
| 29 | Product access editor | unchanged inside row | Button casing = theme/content fix | none |
| 30 | Panel courses | `PanelPage(action)` + `ListSection` | Same inversion as 28 | visible improvement |
| 31 | Panel course detail | `PanelPage(backTo)` + `ListSection` (outline) + `SectionCard` (tools) | Largest redesign; stage last (§4 S6) | visible improvement |
| 32 | Panel lessons | `PanelPage(action)` + `ListSection` | Its toolbar becomes the shared one | visible improvement |
| 33 | Lesson editor | `SectionCard` form; route move per D5 | Raw stream IDs behind picker/advanced = content | visible improvement |
| 34 | Bunny picker dialog | unchanged (P6) | — | none |
| 35 | Panel members | `PanelPage` + `ListSection(ResponsiveTable)` + `ConfirmDialog` | Confirm on remove; mobile scroll | visible improvement (mobile + confirm) |
| 36 | Panel member detail | `PanelPage(backTo)` + `SectionCard`s + `ListSection` tables | Both tables gain cards + responsiveness | minor alignment |
| 37 | Panel sales | `PanelPage` + `StatusView(empty)` | Or hide nav item | minor alignment |
| 38 | Panel integrations | `PanelPage` + `SectionCard` per vendor | One card per vendor | visible improvement |
| 39 | Panel settings | `PanelPage` + `SectionCard`s | Already the target shape | none |
| 40 | Panel dashboard empty | `PanelPage` + `StatusView(empty)` w/ first-run checklist content | Checklist copy = content, owner review | visible improvement |
| 41–44 | Panel empty lists ×4 | `ListSection` empty branch (`isEmpty` hides toolbar) | CTA into create flow | visible improvement |

Coverage: **FocusCard 10 · MemberPage 13 · PanelPage 18 · ListSection 7+ collections · SectionCard 6+ screens · StatusView all branches · ConfirmDialog 5 flows.** Every inventoried screen maps to a primitive; the only unmapped surfaces are the intentionally-unique modules (discussion, notifications popover, Bunny picker).

---

## 4. Migration plan

**Regression harness (used at every stage):** `scripts/theme-screenshots.ts` + `scripts/parity-screenshots.ts` already boot the real server and capture themed screenshots with playwright-core; `scripts/visual-diff.mjs` already diffs via pixelmatch (threshold 0.1). Procedure per stage: capture goldens *before* the stage (screens in scope × desktop/mobile × Shadcn + 2 contrast themes: Logbook, Scoreboard), migrate, re-capture, diff. **"delta: none" screens must diff clean; "minor alignment" diffs are eyeballed against the inventory's expectation; "visible improvement" screens get before/after pairs for owner sign-off.** Because primitives consume only theme tokens and atoms, a green diff in 3 themes plus a spot-check in the other 4 is sufficient evidence that all modes survived — same method the inventory used.

- **S0 — primitives + harness (no page changes).** Build the 7 components in `apps/web/src/components/layout/`, unit-render them, extend `theme-screenshots.ts`'s screen list to cover the canonical set (it currently covers a subset). Zero visual risk.
- **S1 — `StatusView` + `ConfirmDialog` (bug-fix stage).** Replace all ad-hoc pending/error branches; add member-remove confirm. Fixes top issues #2 and #6 with tiny diffs confined to branch states. Verify: error/loading screenshots now match happy-path width; smoke + check stay green.
- **S2 — `FocusCard` (10 screens, lowest risk).** Port register (reference) first and pixel-diff to near-zero; then the rest. Auth flows re-verified via `scripts/auth-e2e.ts`.
- **S3 — `MemberPage` (13 screens).** Extract from course-overview (the donor), port lesson player next (hardest: rail + breadcrumbs + footer bar), then the simple pages. Mobile header collapse per D4.
- **S4 — `PanelPage` + `SectionCard` (18 screens, skeleton only).** Every panel page gains the header; settings/integrations/account re-sectioned. No list inversion yet — this stage is deliberately low-controversy so diffs stay reviewable.
- **S5 — `ListSection` + list-first inversion (products, courses, lessons, members).** The biggest intentional visual change; gated on D2. Before/after pairs for owner approval; CLI-driven smoke (`npm run smoke`) plus the poc-e2e script confirm create/edit flows still work.
- **S6 — redesigns.** Locked-lesson upsell, course-detail outline, dashboard first-run checklist, login hierarchy. Each is its own reviewed change on top of a now-stable skeleton.

Stages are independent merges; `npm run check` + `npm run smoke` gate each. Rollback = revert one stage.

---

## 5. Enforcement

The repo's spirit: conventions are lint rules with shrink-only baselines, layering is dependency-cruiser, "done" is a machine gate. Same treatment here, incrementally:

1. **Evolve `together/sx-layout-only` → tiered key sets (S0/S1).** The rule already classifies keys and carries a shrink-only baseline (currently `{}` — visual debt is fully paid). Add a second tier: **structural keys** (`display`, `grid*`, `flex*` on containers, `position: sticky|fixed`, `maxWidth`/`width`, `columns`) become reserved for `apps/web/src/components/layout/**` (and `theme.ts`); plain spacing (`p*`, `m*`, `gap`, `alignItems` on leaf stacks) stays legal everywhere. Snapshot current usage into `sx-structural-baseline.json` (same generator pattern), wire it as a second option to the existing rule. Each migration stage lowers the baseline; the rule already errors on stale (too-high) baselines, so the ratchet cannot rot. End state: raw structural sx outside the layout directory = lint error with an empty baseline, exactly like visual sx today.
2. **`no-restricted-imports` for skeleton components (S2+).** `Container`, `AppBar`, `Drawer`, `Toolbar` from `@mui/material` become importable only in `components/layout/**` (and `PanelLayout.tsx` until it moves there) — the same ban-list mechanism the config already uses for HTTP globals and query hooks. This makes "hand-rolled page skeleton" unrepresentable, not just discouraged.
3. **dependency-cruiser rules (S0).** In `.dependency-cruiser.cjs`: `components/layout/**` may depend only on `@mui/*`, `react`, and `theme.ts` — never on `features/**`, `api.ts`, or `@core/*` (layout stays data-free and i18n-free; callers pass strings). Optionally: `features/**` may not import from other feature directories' layout-ish files, preventing sibling-copy drift.
4. **Screenshot diff in CI (S1+).** Add `npm run visual`: boot via the existing screenshot-script harness, capture the canonical screen set (3 themes × 2 viewports), pixelmatch against committed goldens under `tasks/visual-goldens/`, fail over threshold. Runs as a separate CI job (it needs the DB like `smoke` does); goldens update via an explicit `npm run visual:update` in the migrating PR, so every visual change is a reviewed artifact. Not part of `check` (keeps the static gate fast and deterministic).
5. **What is deliberately *not* enforced:** which primitive a page picks (taste, reviewable in PRs), copy/casing (i18n review), and pixel-perfection across all 7 themes on every PR (goldens cover 3; the rest are release spot-checks). Non-utopian on purpose — the ratchet + import bans catch the drift that actually happened historically.

---

## 6. Owner decision points

- **D1 — Panel page-title treatment.** Member pages use the ledger h1 + eyebrow + hairline; the panel today has five treatments and often no title. Options: (a) panel adopts the full ledger header (one title language app-wide), (b) panel gets a quieter h1-without-eyebrow variant. **Recommendation: (b)** — one `PanelPage` header with h1 + optional description, no eyebrow/rule; the ledger treatment stays the member-facing signature, the panel reads as a tool. Both are the same component API either way; this is purely visual taste.
- **D2 — Create flows: dialog vs collapsible vs always-open form.** Today create forms permanently occupy the top of every panel list (top issue #1). **Recommendation: header action ("Nowy produkt") opening a `Dialog`** for products/courses/lessons — smallest primitive surface, mobile-friendly, and the confirm-dialog theming already exists in all 7 modes. Collapsible-under-header is the fallback if you dislike modals for multi-field forms.
- **D3 — Width scale (density).** Proposal collapses 7 widths to 4 tokens: focus 28 / wide-focus 32 (FocusCard), prose 44, panel 60, wide 72. Open call: **my-courses currently sits at 52rem** — join `wide` (72rem, 3-column card grid on xl) or `prose`+ (stay ~44–52, 2 columns)? **Recommendation: wide 72 with a 3-up grid** — the library is a browsing surface and the card component can carry it; kills the last odd width.
- **D4 — Member mobile navigation.** The ledger header's text links collapse poorly on 390px. Options: (a) fold all utilities into `MemberAccountMenu` on xs (bell stays visible), (b) bottom tab bar, (c) hamburger drawer like the panel. **Recommendation: (a)** — two nav destinations don't justify a drawer or tab bar; revisit only if member IA grows.
- **D5 — Lesson editing: in-list swap vs dedicated route.** Today editing swaps the row into a mega-form and loses scroll/context. **Recommendation: dedicated route** (`/panel/lessons/:id`) rendered as `PanelPage(backTo)` + `SectionCard`s — it reuses the primitives with zero new layout, gives shareable URLs, and fixes the lost-scroll problem. Dialog is wrong here: the block builder is too deep for a modal.
- **D6 — Button casing (small, but blocks copy churn during migration).** Lowercase ("utwórz produkt") vs sentence case ("Zapisz") are mixed on the same screens. **Recommendation: sentence case everywhere**, set once in `theme.ts` typography/button per mode — one-file-theme handles it; no per-screen edits.

---

*Prepared from the 2026-07-17 inventory; no code was changed. Implementation starts only after D1–D6 are decided, in the stage order of §4.*

---

## 7. Migration executed (status — 2026-07-17)

D1–D6 are resolved (see [`tasks/ux-decisions.md`](./ux-decisions.md)); the migration
was implemented on `poc-together` and closed with a final visual-QA pass across
all 7 theme modes.

### Per-stage summary

- **S0 — primitives + harness — DONE** (`a891cf9`). Layout components in
  `apps/web/src/components/layout/`, the 4 width tokens (D3), sentence-case
  button typography (D6, `textTransform: 'none'` per mode in `theme.ts`), and the
  `npm run visual` pixelmatch harness (3 themes × 2 viewports, goldens in
  `tasks/visual-goldens/`).
- **S1 — StatusView + ConfirmDialog — DONE** (`93f67d8`). All ad-hoc
  pending/error/empty branches route through `StatusView`; destructive actions
  (member remove, progress reset, lesson/post delete) go through `ConfirmDialog`.
  QA hardening: `ConfirmDialog` now ignores Escape/backdrop while its mutation is
  in flight (no dismiss-mid-request; cancel is already disabled when pending).
- **S2 — FocusCard — DONE** (`93f67d8`). Auth + checkout screens (login, register,
  reset, magic-link-sent, checkout offer/success/cancelled/unavailable, tenant
  not-found, tenant picker) on `FocusCard(narrow|wide)`.
- **S3 — MemberPage + bottom tab bar — DONE** (`93f67d8`, D4). Member surface on
  `MemberPage`; xs gets the persistent 4-destination bottom tab bar
  (courses / products / notifications+badge / account). QA hardening: bottom nav
  and page bottom-padding now honour `env(safe-area-inset-bottom)`; `MemberPage`
  gained a `mobileRail` prop so the lesson player stacks the lesson *before* the
  curriculum rail on xs (`after`) while course overview keeps the progress rail
  first (`before`); the notification tab bell renders at default `SvgIcon` size so
  its label baseline matches sibling tabs.
- **S4 — PanelPage + SectionCard — DONE** (`8651bab`). Quiet h1 header (D1); panel
  pages re-sectioned into `SectionCard`s. Create-form section titles unified on a
  single `detailsHeading` string per kind.
- **S5 — ListSection + list-first + create subpages — DONE** (`6da5706`, D2/D5).
  Panel lists are list-first; `+ Dodaj` navigates to dedicated
  `/panel/<kind>/new` create subpages; lesson editing on the deep-linkable
  `/panel/lessons/:id` route. Course history moved from an `Alert` to a quiet
  `FinePrint` note + a `StatusView(empty)` with body copy.
- **S6 — redesigns — DONE** (locked-lesson upsell: page chrome + product/price +
  single CTA + curriculum rail). Dashboard first-run checklist and course-detail
  outline redesign remain as follow-ups (see remaining work).

### Enforcement status

- `together/sx-layout-only` — structural + visual tiers active, baselines empty
  (zero debt). Raw structural sx outside `components/layout/**` + `theme.ts` errors.
- `no-restricted-imports` for skeleton MUI (`Container`/`AppBar`/`Drawer`/`Toolbar`)
  scoped to the layout directory; dependency-cruiser keeps `components/layout/**`
  data- and i18n-free.
- `npm run visual` is the reviewed-golden gate (3 themes × 2 viewports, 78 shots);
  goldens are updated only via `npm run visual:update` with the change that caused
  them. Final QA re-ran green: `npm run check` + `npm run smoke` + `npm run visual`
  all pass; a manual walk of the 4 themes the goldens don't cover (logbook,
  quiet-studio, signal-mono, steady-frame) confirmed member + panel screens hold
  on desktop 1440 and mobile 390 with no per-theme layout breaks, tab-bar overlap,
  or dev-chrome collisions.

### Remaining work (deferred)

- **Storybook + Lost Pixel (OSS) spike** (decision point 2/3) — not started; the
  in-repo `npm run visual` harness stands in for now. Confirm Lost Pixel in a
  short spike before adopting; expand goldens toward atomic-design stories in
  mobile+desktop from day one.
- **Deferred redesigns:** dashboard first-run onboarding checklist (its own core
  domain + isolated UI per decision 6), panel course-detail outline redesign, and
  the inline module-create form on panel course detail (still top-of-list; not a
  D2 create-subpage yet).
- **A11y runtime scanning** (axe-core in the screenshot pipeline) — lowest owner
  priority, not started.
- **PL/EN terminology glossary** — microcopy aligned to sentence case during the
  refactor; the standalone glossary artifact is still pending.
