# Together — Full UX Screen Inventory

**Date:** 2026-07-17
**Method:** All routes enumerated from code (`apps/web/src/main.tsx` route tree + feature components), then every screen walked in headless Chrome (playwright-core) against the live dev seed at `studio.localhost:48730`. Every screen captured at **desktop 1440×900** and **mobile 390×844** in the default **Shadcn** theme; 4 representative screens additionally captured in 2 contrasting themes (Material, Scoreboard). Mutable states (fresh signup, tenant creation, empty panel) exercised on a throwaway tenant **`ux-audit-dvn2b5`** — demo tenants were kept read-only (no saves, no confirmed destructive actions).
**Coverage:** 44 distinct screens/views, 96 screenshots. Zrzuty ekranu znajdują się w prywatnym archiwum właściciela i nie są częścią repozytorium; poniżej pozostają ustalenia tekstowe per ekran.
**Goal:** evidence base for converging the app on a small set of repeatable layout components.

---

## The implicit layout patterns found today

| # | Pattern (name given here) | Description | Screens using it | Count |
|---|---------------------------|-------------|------------------|-------|
| P1 | **Centered narrow card** | Full-viewport grid, one outlined Paper (23–32rem), Wordmark + eyebrow + stacked content | login, magic-sent, register, reset-password, checkout ×4, tenant-not-found, tenant-picker | **10** |
| P2 | **Ledger page** (member) | `LedgerHeader`: h1 + right-aligned utility links/bell/avatar, overline eyebrow, hairline rule; content below in a `Container` | my-courses (+3 state variants), my-products, product-overview, account, course-overview, lesson-player | **10** |
| P2a | **Ledger + sticky rail** | P2 with 2-col grid `1fr / 24rem`, sticky right rail (progress, search, curriculum) | course-overview, course-search, lesson-player, lesson-discussion, lesson-video, course-locks | **6** (subset of P2 pages) |
| P3 | **Admin shell** | Fixed AppBar (tenant swatch + name) + 248px permanent drawer + centered 60rem outlet | all 13 panel screens + 5 empty-tenant variants | **18** |
| P3a | **Form-first stack** (variant of P3) | Create-form Paper at top, list/section h2 below, rows as Paper cards | panel-products, panel-courses, panel-lessons, panel-course-detail, member-detail (grant form) | **5** |
| P3b | **Single-paper page** (variant of P3) | One big Paper with internal h2 + everything inside | panel-members, panel-sales, panel-integrations, panel-settings | **4** |
| P4 | **Bare status container** | Loading/error rendered as lone `Typography h2` or `Alert` in a Container of *inconsistent* width | every page's pending/error branch; visible on member-course-not-found | many |
| P5 | **Full-width lock banner** | One-off: LockedView renders a single wide Paper glued to the top, no page header | member-lesson-locked | **1** |
| P6 | **Dialog / popover layer** | MUI Dialog for confirms (revoke, reset progress, delete lesson) + Bunny picker; Menu popovers (notifications, user menu, member account menu) | bunny-picker, notifications-popover, confirm dialogs | ~6 |

The product effectively has **three page skeletons** (P1, P2, P3) plus ad-hoc deviations. Convergence target: formalize exactly these three as components (`AuthCard`, `MemberPage(header, rail?)`, `PanelPage(title, actions)`), one `ListSection` (search + filter + rows/table + pagination), one `EmptyState`, one `StatusView` (loading/error), one `ConfirmDialog`.

---

## Screen-by-screen inventory

### 1. Login — `/login`
- **Anatomy (top→bottom):** floating language toggle + theme Autocomplete (fixed, top-right); centered outlined Paper 23rem; "Together" wordmark h1; eyebrow "logowanie · przestrzeń …"; email + password labeled inputs; contained submit ("zaloguj się", lowercase); outlined passkey button; divider; magic-link intro fine-print; magic-link email input + **text-variant** submit; divider; demo credentials; register link.
- **Pattern:** P1 centered narrow card.
- **Assessment:** Three auth methods + demo creds + register in one column with no visual grouping — the eye has to read everything to find the right path. Magic link (the primary member path!) is below the fold of attention and its submit is a low-affordance text button. Lowercase primary label breaks button-casing convention used elsewhere ("Zapisz", "Kontynuuj naukę"). Focus rings are visible (MUI default); labels properly bound via `htmlFor`. Mobile: fine, but dev chrome overlaps the card top.
- **Verdict:** **redesign** — split member (magic link) vs staff (password) into tabs or a primary/secondary hierarchy; one contained CTA per view.

### 2. Login, magic-link-sent state
- **Anatomy:** as above + caption "link sent" + dev-only "Otwórz magiczny link" link in fine print.
- **Pattern:** P1.
- **Assessment:** Success feedback is a caption-sized whisper below a text button — easy to miss that anything happened. No disabled/sent state on the button, no resend timer.
- **Verdict:** **align-to-pattern** — swap the whole card body for a clear "check your inbox" confirmation view (like checkout-success does).

### 3. Register — `/register`
- **Anatomy:** P1 card; wordmark; eyebrow; name/email/password; contained submit; divider; sign-in link.
- **Pattern:** P1 — the cleanest instance.
- **Assessment:** Good hierarchy, single CTA. No password requirements hint (reset page enforces 8 chars — registration should say so). No error summary until submit.
- **Verdict:** **keep-as-is** (add password hint); use this as the P1 reference implementation.

### 4. Reset password — `/reset-password`
- **Anatomy:** P1 card; intro fine print; new password + confirm; contained submit; success branch swaps body for title + "go to login" CTA.
- **Pattern:** P1.
- **Assessment:** Solid. Arriving without a token still shows the full form and only errors on submit — wasted effort; should detect missing token upfront.
- **Verdict:** **keep-as-is** (guard the tokenless state).

### 5. Checkout — `/checkout/product-js-full`
- **Anatomy:** P1 card 31rem; wordmark; eyebrow "płatność · tenant"; product title (CardTitle), description, price as h2 `DataValue`; email field; contained secondary-color CTA ("Symuluj płatność (dev)").
- **Pattern:** P1.
- **Assessment:** Clear, single job. But zero trust scaffolding for a purchase page: no seller identity beyond eyebrow, no terms, no "what happens next". Price has no visual anchor to the CTA. Dev-mode label leaks into the CTA copy.
- **Verdict:** **align-to-pattern** — keep P1, add order-summary block (what you get, price, then CTA).

### 6. Checkout success — `?status=success`
- **Anatomy:** P1 card; eyebrow "płatność przyjęta"; title "Sprawdź swoją skrzynkę e-mail"; explanatory body.
- **Pattern:** P1. **Assessment:** Right pattern, good copy; missing a success icon and any next-step link (e.g. "otwórz /login"). Dead end.
- **Verdict:** **keep-as-is** + add CTA.

### 7. Checkout cancelled — `?status=cancelled`
- **Anatomy:** P1 card + "Spróbuj ponownie" contained retry button.
- **Pattern:** P1. **Assessment:** Fine. **Verdict:** **keep-as-is**.

### 8. Checkout unavailable — unknown product
- **Anatomy:** P1 card; tenant eyebrow; "Oferta niedostępna" + body; **no action**.
- **Pattern:** P1. **Assessment:** Dead end — no link to the tenant's offer/login. **Verdict:** **align-to-pattern** (add escape hatch).

### 9. Tenant not found — unknown subdomain
- **Anatomy:** P1 card 32rem, center-aligned text (only P1 instance with centered text, no wordmark); "404" eyebrow; title; body; hint.
- **Pattern:** P1 (deviant: centered, no brand).
- **Assessment:** Friendly, but drops the Together wordmark every other P1 card has, and is the only centered-text card. No action offered.
- **Verdict:** **align-to-pattern** — same card anatomy as the rest of P1.

### 10. Tenant picker / create (apex, after signup)
- **Anatomy:** P1 card 29rem; h1 "Wybierz przestrzeń"; eyebrow; (tenant list when any); "Utwórz przestrzeń" h2; name + **"slug"** inputs; caption URL preview; contained submit (disabled until name).
- **Pattern:** P1.
- **Assessment:** For a brand-new creator this is the whole onboarding — and it asks for a "slug" (developer jargon) with an empty-string caption placeholder. Disabled-until-valid button gives no reason when disabled. List + create-form mix in one card is fine at this scale.
- **Verdict:** **align-to-pattern** — rename field ("adres przestrzeni"), always-visible URL preview, welcome copy.

### 11. My courses — `/my` (active member)
- **Anatomy:** LedgerHeader: h1 "Moje kursy" + right utilities (text links "Moje produkty", "Start", notification bell, avatar menu); eyebrow "biblioteka kursów"; hairline; 2-col card grid; CourseCard = cover image / initials fallback, h2 title, completion Chip, description.
- **Pattern:** P2 ledger page (52rem).
- **Assessment:** The card component is strong (cover, chip, hover). But the "header as nav" idiom is weak: plain text links with ~24px hit areas act as the app's primary navigation, and "Start" (→ `/`) is meaningless to members. Mobile: h1 wraps under the floating dev chrome and "Moje produkty" wraps to two lines — the header collapses poorly. Completion chip fires one `courseStructure` query per card (N+1).
- **Verdict:** **align-to-pattern** — extract a real `MemberHeader` component with proper nav affordances and mobile behavior; keep the grid + card.

### 12. My courses — empty (expired member sees the same)
- **Anatomy:** P2 header; elevated Paper with `EmptyStateContent`: icon, h1-styled "Brak kursów", body.
- **Pattern:** P2 + the good EmptyState.
- **Assessment:** Best empty state in the app. **However** an *expired* member gets the identical generic message — nothing says "your access expired on X, renew here". Lost renewal revenue and confusing ("I paid!").
- **Verdict:** **keep-as-is** visually; **redesign the expired variant** (distinct message + renew CTA). This EmptyState should become the shared component.

### 13. Notifications popover (member)
- **Anatomy:** bell IconButton with badge; Menu: "Powiadomienia" label; items = bold actor+context line, 3-line preview, date, unread dot; footer "Oznacz wszystkie jako przeczytane".
- **Pattern:** P6 popover.
- **Assessment:** Solid. Preview truncates mid-word without ellipsis; items are large — fine. Works on mobile as a Menu (acceptable).
- **Verdict:** **keep-as-is**.

### 14. My products — `/my/products`
- **Anatomy:** P2 header (44rem — narrower than my-courses' 52rem); List of ListItemButton rows: bold title, price `DataValue` · description.
- **Pattern:** P2 ledger page.
- **Assessment:** Rows navigate to a "coming soon" page (see 15) — a click that buys nothing. Width differs from sibling page for no reason. Price-first secondary line reads like a receipt; purchase date and status (active/expired) are absent — the one thing a member would come for.
- **Verdict:** **align-to-pattern** — unify width with `/my`, add grant status/date, link somewhere useful (or drop the link).

### 15. Product overview — `/my/course/:productId`
- **Anatomy:** P2 header (title = product name, right link "Moje produkty"); one Paper: "Treść kursu już wkrótce" + body.
- **Pattern:** P2 + placeholder card.
- **Assessment:** A whole routed page that is a permanent stub. Header right-link says "Moje produkty" but `href` goes to `/my` (my-courses) — mislabeled navigation.
- **Verdict:** **redesign or remove** — either link products to their real course(s) or don't make rows clickable.

### 16. Course overview — `/my/courses/course-js`
- **Anatomy:** P2 header (h1 = course name, right "Moje kursy", eyebrow "program kursu"); 3 stat tiles (lessons / duration / % complete); 2-col grid: left = cover image + "O kursie" Paper; right sticky rail = progress card (eyebrow, "2 z 8", %, progress bar, contained "Kontynuuj naukę"), discussion search card, curriculum card (course tree with per-lesson duration + completion icons).
- **Pattern:** P2a ledger + sticky rail (72rem).
- **Assessment:** This is the strongest screen in the member app — clear hierarchy, real information scent, one obvious CTA. Mobile ordering is correct (rail first). Weak spots: stat tiles duplicate the % shown 2cm below in the rail; on mobile three full-width tiles cost 500px of scroll before content; back-nav is a right-aligned text link (inconsistent with lesson player's breadcrumbs).
- **Verdict:** **keep-as-is** — and promote its header+rail grid to the canonical `MemberPage` component; compress stat tiles on mobile.

### 17. Course discussion search (state of 16)
- **Anatomy:** rail search card expands: hits grouped by lesson (bold lesson-name heading), author, highlighted match, clear (×) button.
- **Pattern:** P2a rail module.
- **Assessment:** Good feature; results are trapped inside a 24rem rail column — long previews get cramped; group headings are links but look like plain bold text (no affordance).
- **Verdict:** **align-to-pattern** — results could overlay/expand; make lesson headings look clickable.

### 18. Lesson player — `/my/courses/…/lessons/…`
- **Anatomy:** P2 header + **breadcrumbs** (course / module / chapter / lesson — the only breadcrumbs in the app); h1 lesson name; right "Wróć do kursu"; left column = content blocks, each its own Paper with an eyebrow block-type label ("osadzenie", "lektura"); LessonFooterBar: outlined "oznacz jako ukończoną" + contained "Ukończ i przejdź dalej" + next-lesson link/Chip; discussion section below; right sticky rail = curriculum card.
- **Pattern:** P2a.
- **Assessment:** Very good bones. Issues: every content block is a separate card with a technical-ish eyebrow — a lesson with video+text+link reads as three disconnected boxes rather than one lesson; completion CTA duo at the *bottom* only (long lessons: no affordance at top); breadcrumbs exist only here (inconsistent).
- **Verdict:** **align-to-pattern** — merge blocks into one content card (or remove per-block chrome), keep footer bar; standardize breadcrumbs across member detail pages.

### 19. Lesson discussion (state of 18)
- **Anatomy:** "Dyskusja" h-styled title + eyebrow; search field; composer Paper (multiline + disabled-until-text contained "Opublikuj"); threads as outlined boxes: author, relative date, body, text-button actions (Odpowiedz/Edytuj/Usuń), indented replies, deleted-post placeholder, "Obserwuj wątek" toggle with reply count, load-more.
- **Pattern:** discussion module (unique but internally consistent).
- **Assessment:** Feature-complete and readable; author chip for creator; deleted state handled. Composer-first ordering pushes content down; "Usuń" on own posts opens a confirm dialog (good). Text-button action row wraps fine on mobile.
- **Verdict:** **keep-as-is**.

### 20. Lesson player — Bunny video block
- **Anatomy:** as 18; video block renders player/placeholder ("wideo" eyebrow), plus skeleton while loading.
- **Pattern:** P2a. **Assessment:** Placeholder state communicates missing stream config decently. **Verdict:** **keep-as-is**.

### 21. Lesson locked — no access
- **Anatomy:** single full-width Paper at viewport top: lock icon, "Treść zablokowana" title, one-line body, three buttons — contained "Odblokuj dostęp" (→ checkout), outlined "Wróć do kursu", outlined "Przeglądaj kursy". No page header, no breadcrumbs, no rail.
- **Pattern:** P5 one-off.
- **Assessment:** The paywall moment — and it's the least designed screen: stretches edge-to-edge at 1440px, floats in dead space, drops all navigation chrome, gives zero information about *what* you'd unlock (product name, price, what's included). Two escape buttons vs one buy button dilutes the CTA.
- **Verdict:** **redesign** — render inside the normal lesson layout (header + rail intact), lock card centered with product name + price + single primary CTA.

### 22. Course tree with lock states (module-access member)
- **Anatomy:** as 16, curriculum tree shows: accessible lessons plain, locked lessons greyed + lock icon + inline "Odblokuj dostęp" link, module/chapter-level lock icons.
- **Pattern:** P2a.
- **Assessment:** Three lock granularities read clearly. "Kontynuuj naukę" CTA correctly targets first accessible lesson. Inline unlock links per-lesson get repetitive in a long tree.
- **Verdict:** **keep-as-is**.

### 23. My courses — free-preview member
- **Anatomy/Pattern:** P2, one course card ("Nierozpoczęty").
- **Assessment:** No signal that this is a *preview* with most content locked — the upsell surface is wasted. **Verdict:** **align-to-pattern** (add access-level badge on card).

### 24. `/my` as staff (creator browsing member app)
- **Anatomy/Pattern:** P2 grid; staff sees all tenant courses, all "Nierozpoczęty"; no link back to `/panel`.
- **Assessment:** Works as course preview, but there's no "you're viewing as staff" context and no way back to the panel except the "Start" link.
- **Verdict:** **align-to-pattern** (staff banner + panel link).

### 25. Course not found — `/my/courses/bad-id`
- **Anatomy:** lone Paper glued top-left: "Nie znaleziono kursu", body, "Wróć do moich kursów" link.
- **Pattern:** P4 bare status container.
- **Assessment:** Renders **full-width** (~1150px) because the error branch's `Container sx maxWidth` lacks the `!important` used on happy paths — evidence of the width-jump bug class affecting all loading/error branches. No page header.
- **Verdict:** **align-to-pattern** — one shared `StatusView` inside the standard member layout.

### 26. Member account — `/account`
- **Anatomy:** P2 header (44rem, right links "Moje kursy"/"Start" — no bell/avatar here, unlike `/my`); stack of Papers: "Zalogowano jako" (eyebrow + email), "Hasło" (h2 + body + outlined action), "Płatności" (h2 + body + contained external link).
- **Pattern:** P2, settings-card stack.
- **Assessment:** Clean. Inconsistencies: first card uses eyebrow-as-title while the other two use h2; header utility set differs from sibling pages; password-reset success is a caption.
- **Verdict:** **align-to-pattern** (one card-title style; same header utilities everywhere).

### 27. Panel dashboard — `/panel`
- **Anatomy:** admin shell (AppBar: tenant swatch+name+wordmark, inline lang/theme (hidden on xs), bell, user menu; drawer nav 8 items w/ icons); content: h2 "Przegląd"; 4 stat-tile buttons (icon, big number, label, sub-detail); "Najnowsi uczestnicy" Paper: h2 + "wszyscy uczestnicy" text button, member rows (name, email, date, "Zarządzaj" text action).
- **Pattern:** P3 admin shell.
- **Assessment:** Good overview page; tiles are real buttons with aria-labels. Page title is an h2 (member pages use h1) — the panel has no page-header component at all. Recent-member rows use a third list idiom (bordered ListItems). Mobile: title+action wrap awkwardly; tiles stack fine.
- **Verdict:** **keep-as-is** structurally; introduce a `PanelPageHeader` and reuse the member-row list component from Members.

### 28. Panel products — `/panel/products`
- **Anatomy:** **"Nowy produkt" create form Paper first** (title/description/price+currency/help text/full-width contained lowercase "utwórz produkt"); then "Produkty" h2 + search field; product rows as Papers: h2 title, warning chip (access issues), publish text-button, price·status·access-count meta line, date, "edytuj dostęp" toggle, collapsible access editor.
- **Pattern:** P3a form-first stack.
- **Assessment:** The page's actual job (see & manage products) starts ~560px down; on a tenant with 20 products the creation form permanently occupies the prime slot. No page title (form h2 acts as one). Publish is a text button — the most consequential action on the row has the least prominent style. Access-issue chip is good.
- **Verdict:** **redesign the skeleton** — list-first with page header + "Nowy produkt" button (dialog or collapsible), rows via a shared `EntityRow`.

### 29. Product access editor (state of 28)
- **Anatomy:** inside row: divider; "Dostęp" eyebrow; access items as outlined boxes with "usuń" text action; "tryb zaawansowany" switch + explainer; course select + "dodaj pełny dostęp do kursu"; disabled "zapisz dostęp".
- **Pattern:** inline expanding editor.
- **Assessment:** Powerful and dense; advanced-mode explainer text is good. All-lowercase text buttons ("usuń", "zapisz dostęp") again; disabled save gives no reason; nesting an editor inside a list row makes the page jump.
- **Verdict:** **align-to-pattern** — fine as collapse, but standardize buttons and give save an enabled state explanation.

### 30. Panel courses — `/panel/courses`
- **Anatomy:** P3a: "Nowy kurs" form Paper (name, description, image URL) with disabled full-width submit; "Kursy" h2 + search; course rows (title, "N moduły", date, "zarządzaj" text action).
- **Pattern:** P3a.
- **Assessment:** Same form-first inversion as products. Rows are sparse — no cover thumbnail (the member side has covers; admins see none), no lesson counts, no publish state.
- **Verdict:** **redesign skeleton** with 28 (same `ListSection`).

### 31. Panel course detail — `/panel/courses/:id`
- **Anatomy:** back text-button "← wszystkie kursy" + h2 title inline; then a *stack of tool Papers*: "Nowy moduł" (title/prefix/disabled submit), "Podepnij istniejący moduł" (select+button), "Historia zmian" Paper containing an **Alert rendered in error-red for an informational note** + caption; "Moduły" h2; module cards = editable title/prefix inputs + reorder arrows + "odepnij moduł" + chapters with per-chapter content lists, add-content selects, "usuń" actions everywhere.
- **Pattern:** P3a taken to the extreme (edit-in-place everywhere).
- **Assessment:** The most complex screen in the product and the least hierarchical: three creation/attachment tools precede the actual curriculum; every module renders its full editing chrome permanently (dozens of inputs on screen at once); versions box cries wolf in red. Back-nav pattern (left arrow text button) exists only here and in member detail. Reorder via tiny arrow tooltips.
- **Verdict:** **redesign** — curriculum outline first (read view, drag/kebab per row), creation/attach as secondary actions, edit-on-demand.

### 32. Panel lessons — `/panel/lessons`
- **Anatomy:** P3a: "Nowa lekcja" form (name, duration, block builder w/ type select + "dodaj blok", disabled submit); "Lekcje" h2 + search + **type filter chips** (wszystkie/Wideo/Osadzenie/PDF/Odnośnik/HTML); lesson rows: title, "N bloki · date", "edytuj"/"usuń" text actions.
- **Pattern:** P3a.
- **Assessment:** Filter chips + search are the right idea (best list toolbar in the panel — yet not reused on other lists). Same form-first inversion; "usuń" does confirm via dialog (inconsistent with Members' unconfirmed remove).
- **Verdict:** **align-to-pattern** — list-first; promote this toolbar (search+chips) into the shared `ListSection`.

### 33. Panel lesson editor (state of 32)
- **Anatomy:** row swaps to "Edytuj lekcję" form Paper: name, duration+helper; "Bloki treści" eyebrow; block cards (outlined) with type eyebrow + reorder/delete text actions; video block: "Wybierz z Bunny Stream" button + raw **`storageKey` / `streamVideoId` / `streamLibraryId` / `streamCollectionId`** inputs; html block: edit/preview tabs + formatting toolbar; footer "zapisz"/"gotowe".
- **Pattern:** inline mega-form.
- **Assessment:** Functional but developer-grade: four untranslated camelCase identifiers exposed to a course creator; block chrome is heavy; no breadcrumb/title context that you're inside lesson X of the list page (scroll position lost on "gotowe").
- **Verdict:** **redesign fields** (hide IDs behind the picker / "advanced"), keep block model; consider a dedicated route instead of in-list swap.

### 34. Bunny video picker dialog
- **Anatomy:** modal Dialog: title, search field, unconfigured-state explainer + "Przejdź do Integracji" link + fallback hint; lowercase "anuluj" text button right-aligned.
- **Pattern:** P6 dialog.
- **Assessment:** Unconfigured state is genuinely helpful (explains + links to fix). Casing again ("anuluj" vs "Zapisz" elsewhere).
- **Verdict:** **keep-as-is**.

### 35. Panel members — `/panel/members`
- **Anatomy:** P3b single Paper: h2 "Uczestnicy" + outlined "Eksportuj CSV"/"Eksportuj JSON"; search + grant-filter chips (wszyscy/aktywny/wygasły); dense Table (email, name, product count, created, actions "Zarządzaj" + red "Usuń"); pagination.
- **Pattern:** P3b full-width table page.
- **Assessment:** The only real table in the app and it works well on desktop. Two critical flaws: **"Usuń" removes a member immediately with no confirmation dialog** (compare: lesson delete and grant revoke both confirm); on mobile the table clips columns with no horizontal-scroll affordance — actions are off-screen.
- **Verdict:** **align-to-pattern** — add confirm dialog (shared `ConfirmDialog`), wrap table in `overflow-x` scroller or collapse to cards on xs.

### 36. Panel member detail — `/panel/members/:id`
- **Anatomy:** back "← wszyscy uczestnicy" + h2 title = **raw email**; joined date; "Aktywność edukacyjna" h2 + last-activity + learning table (course, progress bar, last lesson, activity, "Resetuj postęp") — **bare on background, not in a Paper**; "Przyznaj produkt" form Paper (product select + expiry + disabled "przyznaj"); "Przyznane produkty" h2 + grants table (product, window, source, status Chip, "odnów"/"odbierz" text actions); confirm Dialogs for reset & revoke.
- **Pattern:** P3 detail (mixed P3a/P3b).
- **Assessment:** All the right data. Title should be display name (email as fallback); the two tables live at different elevation levels (one bare, one after a form) — no consistent sectioning; destructive actions are lowercase text buttons; confirm dialogs exist here (good) highlighting the Members-list gap. Mobile tables clip like 35.
- **Verdict:** **align-to-pattern** — consistent section cards, humanized title, shared table responsiveness.

### 37. Panel sales — `/panel/sales`
- **Anatomy:** P3b: one Paper, h2 "Sprzedaż", body "Już wkrótce."
- **Pattern:** P3b placeholder.
- **Assessment:** Honest placeholder; nav item leads to a two-word page. **Verdict:** **keep-as-is** (or hide nav item until real).

### 38. Panel integrations — `/panel/integrations`
- **Anatomy:** P3b: one long Paper: h2 + intro; "Stripe" eyebrow section (2 secret fields, each: label + status Chip "nie ustawiono", input, disabled "Zapisz"; webhook URL + helper); "Bunny Stream" eyebrow section (API key secret, library ID + save, "Testuj połączenie" + hint).
- **Pattern:** P3b settings form.
- **Assessment:** Secret handling (masked previews, status chips) is genuinely good. One giant Paper = no visual separation between two unrelated vendors; six disabled buttons at rest; eyebrow-as-section-title again.
- **Verdict:** **align-to-pattern** — one card per integration, shared `SettingsSection` component with account/settings pages.

### 39. Panel settings — `/panel/settings`
- **Anatomy:** two Papers: "Portal płatności" (h2, body, URL input, outlined "Zapisz") and "Bezpieczeństwo" (h2; "Klucze dostępu" eyebrow + passkey name + outlined add; "Uwierzytelnianie dwuskładnikowe" eyebrow + password + enable button; TOTP verify flow when enabled).
- **Pattern:** P3b settings cards.
- **Assessment:** The card-per-topic layout here is what Integrations should be — but Settings vs Integrations split is arbitrary (billing portal URL is "settings", Stripe keys are "integrations"). Save shows caption-level success feedback.
- **Verdict:** **keep-as-is** layout; merge/clarify IA with Integrations; standardize success feedback (snackbar).

### 40. Panel dashboard — empty tenant
- **Anatomy:** four tiles all "0"; recent members Paper with one-line "Brak uczestników…".
- **Pattern:** P3.
- **Assessment:** A brand-new creator lands on four zeros and no guidance. This is *the* onboarding moment — no "create your first course" checklist/CTA.
- **Verdict:** **redesign** — first-run checklist (create course → add lesson → create product → share checkout link).

### 41. Panel products — empty
- **Anatomy:** create form; "Produkty" h2 + search (searching nothing); bare text "Nie masz jeszcze żadnych produktów."
- **Pattern:** P3a.
- **Assessment:** Bare-sentence empty state vs member app's icon EmptyState — the pattern exists in the codebase and isn't used here. Search field rendered for an empty collection.
- **Verdict:** **align-to-pattern** — shared EmptyState with CTA into the create flow.

### 42. Panel courses — empty
- Same as 41 for courses ("Brak kursów. Utwórz pierwszy kurs powyżej." — at least points at the form). **Verdict:** **align-to-pattern**.

### 43. Panel lessons — empty
- Same as 41; filter chips render over an empty list. **Verdict:** **align-to-pattern**.

### 44. Panel members — empty
- Export buttons + search + filters all rendered for zero members; one-line empty text. **Verdict:** **align-to-pattern** (hide toolbar when empty, EmptyState with "share your checkout link" CTA).

---

## Theming spot-check (layout survival)

Captured in Material and Scoreboard for: login, my-courses, lesson player, panel dashboard (zrzuty w prywatnym archiwum właściciela).

**Finding:** layout survives all 7 modes intact — structure comes from shared styled primitives (`LedgerHeader`, `StatTile`, `CourseCardRoot`…), themes only swap tokens (type, borders, radii, underlines). This is a real asset: converging on layout components will not fight the theming system. Minor: Scoreboard's uppercase chips ("W TRAKCIE") and Material's underlined links change perceived hierarchy slightly; dev theme switcher overlaps page headers in every non-panel theme.

---

## Cross-screen inconsistency table

| # | Concern | Observed variants | Evidence (screens) |
|---|---------|-------------------|--------------------|
| 1 | **Page title treatment** | (a) h1 in LedgerHeader (member); (b) h2 plain ("Przegląd"); (c) h2 inside Paper (Members, Sales, Integrations); (d) *no page title* — create-form h2 stands in (Products, Courses, Lessons); (e) back-link + h2 inline (Course detail, Member detail); (f) Wordmark+CardTitle (auth) | 11, 27, 35, 28, 31, 1 |
| 2 | **Content width** | 23 / 29 / 31 / 32rem (P1 cards); 44 / 52 / 72rem (member); 60rem (panel); **unbounded** in error/loading branches (missing `!important` on Container sx) | 14 vs 11 vs 16; bug visible in 25 |
| 3 | **Back navigation** | right-aligned text link (member pages); breadcrumbs + right link (lesson player only); left "← …" text button (panel details); none (locked view) | 16, 18, 31, 36, 21 |
| 4 | **Breadcrumbs** | exist on exactly one screen | 18 |
| 5 | **Button casing** | lowercase PL ("zaloguj się", "utwórz produkt", "edytuj", "usuń", "anuluj") vs sentence case ("Zapisz", "Zarządzaj", "Eksportuj CSV", "Kontynuuj naukę") — both on the same screens | 28, 31, 34, 35 |
| 6 | **Destructive-action pattern** | Members row "Usuń" = instant mutation, **no confirm**; lesson delete / grant revoke / progress reset = confirm Dialog; post delete = confirm Dialog | 35 vs 32, 36, 19 |
| 7 | **List/row idiom** | Paper card rows (products, courses, lessons); Table (members, member detail ×2); ListItemButton rows (my-products, tenant picker); bordered ListItems (dashboard recent); custom CourseCard grid (my-courses) | 28, 35, 14, 27, 11 |
| 8 | **Empty states** | icon + title + body EmptyState (member); bare one-line Typography (panel lists); Paper + CardTitle + body (my-products, product stub) | 12 vs 41–44 vs 14 |
| 9 | **Loading states** | h2-sized text in ad-hoc containers (member), plain body1 (panel), width differs from loaded page → layout jump | all pending branches |
| 10 | **Create flows** | always an always-open form Paper *above* the list; never a dialog/drawer; forms keep prime screen real estate forever | 28, 30, 32, 31, 36 |
| 11 | **Card vs Paper semantics** | `Paper elevation={1}` = sections, rows, empty states, tool forms alike; `variant="outlined"` = P1 cards + nested blocks; no rule discernible | throughout |
| 12 | **Section labels** | Eyebrow/overline used as: page subtitle, card title, form-section title, block-type tag, table group | 11, 26, 38, 33 |
| 13 | **Global chrome** | floating fixed theme+language pickers overlap headers on every non-panel screen (incl. auth & checkout); panel inlines them in AppBar but hides both on mobile | 11-mobile, 27-mobile |
| 14 | **Alert severity** | informational note ("Historia zmian") rendered in red/error styling; success feedback = captions, errors = Alerts, no snackbar/toast pattern | 31, 39 |
| 15 | **Header utility set (member)** | `/my`: products+home+bell+avatar; `/account`: courses+home, **no bell/avatar**; `/my/products` link labeled "Moje produkty" but points at `/my` (product stub page) | 11, 26, 15 |
| 16 | **Technical language leaks** | "slug", `storageKey`, `streamVideoId`, `streamLibraryId`, `streamCollectionId`, block types as labels | 10, 33 |
| 17 | **Mobile tables** | columns clipped, no overflow scroller, actions unreachable | 35-mobile, 36-mobile |
| 18 | **Touch targets** | member header nav = plain text links (~24px); reorder arrows, row text-actions similar | 11-mobile, 31-mobile |

---

## Top issues (ranked)

1. **Panel list pages are create-form-first** (Products, Courses, Lessons, Course detail) — management, the 95% case, starts below the fold. One `ListSection` + header-action pattern fixes four screens.
2. **Member removal has no confirmation** while every other destructive action confirms — one misclick deletes a member from the row.
3. **Mobile tables clip** (Members, Member detail) — action column unreachable at 390px, no scroll affordance.
4. **The paywall screen (lesson locked) is the least designed screen** — full-width bare banner, no product/price info, no page chrome; conversions happen here.
5. **No panel page-header component** — five different title treatments; some pages have no title at all.
6. **Width chaos + status-branch width bug** — 7 content widths; loading/error branches render at a different width than loaded pages (missing `!important`), causing jumps.
7. **Button system inconsistency** — lowercase text-button primaries, mixed casing, publish as text button; hierarchy unreadable.
8. **Empty tenant gives zero onboarding** — dashboard of zeros, bare-sentence empty lists, while a good EmptyState component already exists in the member app.
9. **Expired access is silent** — expired members see generic "Brak kursów" with no explanation or renew path.
10. **Floating dev chrome (theme/language switchers) overlaps real UI** on every non-panel screen and collides with the member header on mobile; hidden entirely on mobile panel.

Honorable mentions: auth card stacks 3 sign-in methods without hierarchy; raw stream IDs in the lesson editor; red-styled info alert in course versions; email-as-title on member detail; breadcrumbs on exactly one screen.

---

## Recommended reusable component set (from the evidence)

1. `AuthCard` (P1) — wordmark, eyebrow, body slot, single primary CTA, fine-print slot. Covers 10 screens.
2. `MemberPage` (P2/P2a) — standardized `LedgerHeader` (title, eyebrow, nav utilities, optional breadcrumbs) + fixed width scale (narrow 44rem / wide 72rem) + optional sticky rail slot. Covers 10+ screens.
3. `PanelPage` (P3) — page header (title, description, primary action) inside the existing shell. Covers 18 screens.
4. `ListSection` — search + filter chips + rows/table + pagination + built-in EmptyState; row idiom unified (one `EntityRow`, one responsive table wrapper).
5. `EmptyState` — promote the member-app version (icon, title, body, CTA) everywhere.
6. `StatusView` — loading/error at the same width as loaded content, inside the page skeleton.
7. `ConfirmDialog` — single confirm pattern for all destructive actions.
8. `SettingsSection` — card with h2 + description + fields + save + snackbar feedback (Account, Settings, Integrations).
