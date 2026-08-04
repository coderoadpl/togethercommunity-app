# MVP = feature parity with the legacy CodeRoad platform

> Status: accepted by the owner (2026-07-13). This document is the contract for
> the parity sprint. Legacy recon reports (field-level, file:line citations)
> are the owner's private audit artifacts (kept outside the
> repo deliberately — they contain infrastructure identifiers).

## Goal and sequence (owner decision)

1. **Feature parity** with `kurs.coderoad.pl` (student app) and its separate
   management surface — same capabilities, not the same tech or table shapes.
2. **Synthetic seed data** modeled on the legacy structure (fake lessons) so
   the platform is demoable and testable without production data.
3. **Manual owner testing** on the seed.
4. **Full import last** — CodeRoad tenant (2 courses) + Akademia Samouka tenant
   (1 course), including users, entitlements and progress. The import doubles
   as the platform's flagship test: "can a creator migrate from another
   provider while media stays external" (Z-1).

No fresh Mongo dump needed until step 4 (structure unchanged; code is the
source of truth for shapes).

## Owner decisions

- **Users/passwords**: invisible migration — import Payload PBKDF2 `salt`+`hash`
  and verify them through a custom hasher in the auth adapter. Nobody notices
  anything except the visual update of the platform.
- **E-mail**: Amazon SES is already live — integrate directly (SES SMTP or SDK)
  as an implementation of the `EmailProvider` port. Provider stays swappable.
- **i18n**: nothing gets removed — full PL/EN across the student app AND the
  panel, translated well. Future (not this sprint): translations editable from
  the admin panel.
- **Media**: stay exactly where they are (Bunny Stream library + S3 bucket +
  backup store). The platform only stores pointers — BYO by design.
- **Content versioning**: the platform should ultimately support it (legacy
  keeps Payload versions). Deferred to a later step, after the rest is
  confirmed; import will carry only current documents until then.

## Legacy capability map → Together model

| Legacy (stack details in the owner's private materials) | Together (foundation) |
|---|---|
| `Courses` | `courses` (tenant-scoped) |
| `CourseModules` with nested `chapters[].contents[]` | `course_modules` with the same nested shape (jsonb) — **shape kept on purpose**: `UserProgress.lastViewedChapter` points at array-item ids, and import accuracy beats normalization |
| `CourseLessons` with typed `contents[]` (`video\|embed\|pdf\|link\|html`) | `course_lessons` with the same typed blocks (jsonb, zod-validated closed union) |
| `VideoFiles` (pointers: storage key + stream video id) | lesson video block stores the pointer fields verbatim |
| `Accesses` (3-tier items: course / modules / lessons) | `products` gain `accessItems` — a discriminated union on `level` (`course` / `modules` / `lessons`); a product IS the sellable entitlement. **Legacy → union transform** (per item, applied by migration `0008` and the importer): `courseLevelAccess === true` → `{ level: 'course', courseId }` (any legacy `moduleIds`/`lessonIds` on a course-level item are dropped); else nonempty `moduleIds` → `{ level: 'modules', courseId, moduleIds }`; else nonempty `lessonIds` → `{ level: 'lessons', courseId, lessonIds }`; an item that grants nothing is dropped. Together adds `excludedModuleIds?` on course-level items (course access minus listed modules; an exclusion is overridden by any module-level grant on the same module). Resolution and 3-state decoration silently ignore dangling course/module/lesson ids; `listProductAccessIssues` reports them per product. |
| `Enrollments` (`user`×`access`, `startsAt`/`expiresAt`, renew/cancel, read-time expiry) | `product_grants` gain `startsAt`/`expiresAt` (+ renew semantics); expiry evaluated at read time, no cron |
| `UserProgress` (per user×course: `completedLessons`, `lastViewed{Lesson,Module,Chapter}`) | `member_course_progress` per member×course, same fields |
| `Users` (PBKDF2, roles admin/student) | global auth accounts + `members` per tenant (ADR-0002); PBKDF2 verify in the auth adapter for imported accounts |
| `M2MApiUsers` + `POST /api/m2m/enroll` | tenant-scoped API keys + `POST /api/m2m/enroll` (create-or-find member, grant/renew, welcome e-mail with set-password/magic link) |
| Payload admin panel | Together panel: course tree management, products/entitlements, members/enrollments (+ CLI for everything) |
| SMTP e-mails (reset/welcome, PL/EN) | `EmailPort` + SES adapter; same two e-mail kinds first |

All imported entities carry a `legacyId` column (Mongo ObjectId hex) so the
final import is idempotent and relations (including array-item ids inside
jsonb) survive verbatim.

## Student-app parity checklist (from client recon)

- Course catalog = courses the member can (partially) access.
- Course page: **full syllabus always visible** as teaser; 3-state access per
  node (`not/partially/fully-accessible`) with lock icons; locked nodes
  disabled.
- Lesson player: ordered typed blocks — stream-embed video (iframe), PDF inline
  + open-in-tab, generic embed, sanitized HTML block, link buttons.
- Manual progress: "Mark as completed", "Complete & continue", checkmarks in
  the tree; server-computed "next lesson"; `update-last-viewed` telemetry.
- Sidebar lesson search (debounced, highlight, auto-expand).
- Breadcrumbs; PL/EN language switcher; profile with password reset and
  billing-portal link; forgot/reset password e-mails.
- Free-preview entitlement (a lesson-level product granting one lesson per
  module) with a dedicated demo account.

Explicitly NOT in parity scope (absent in legacy): checkout/pricing UI,
certificates, quizzes, comments, social login, resume-position, offline,
marketing pages. (Together's existing checkout + public offer stay as a bonus.)

## Delivery plan (workflows, gates as always)

- **W1 backend core**: content schema + entitlement upgrade (3-tier +
  time-boxed grants) + progress + access-resolution use-cases (course
  structure with 3-state access) + contract routes + CLI + tests.
- **W2 M2M + e-mail + auth**: tenant API keys, `/api/m2m/enroll`, `EmailPort`
  + SES adapter (reset + welcome, PL/EN templates), PBKDF2 verify support for
  imported accounts.
- **W3 student web**: player + tree + locks + search + progress + breadcrumbs.
- **W4 panel**: course tree editor, product entitlements editor, members ×
  enrollments management.
- **W5 i18n**: PL/EN across student app and panel.
- **W6 synthetic seed**: 2 tenants (coderoad: 2 courses, akademia-samouka: 1),
  realistic module/chapter/lesson trees with mixed block types (embeds and
  public sample assets so everything actually renders), free-preview account,
  demo enrollments with varied expiry.
- **W7 verification**: fresh-DB E2E extension + adversarial review + fix loop.

Import tooling (exporter + `together import --dry-run` + old-vs-new diff
report) is designed in this sprint but executed at step 4.

## Deviations

- **`ensureUser` passwordless provisioning (2026-07-14)**: the auth adapter's
  `ensureUser` (used by simulated purchase and M2M enroll to create-or-find a
  buyer/enrolled account) no longer hand-rolls a drizzle `INSERT` into Better
  Auth's `user` table. Investigation of the installed release (`better-auth`
  1.6.23, the current npm stable; `@better-auth/passkey` 1.6.23) confirmed an
  official server-side passwordless path: the core `internalAdapter.createUser`
  (reached via `auth.$context`, both typed and runtime-present), which the admin
  plugin's `POST /admin/create-user` also wraps. We adopted the core adapter
  directly rather than the `admin()` plugin, because the plugin would add unused
  RBAC/ban/impersonation endpoints plus `role`/`banned`/`banReason`/`banExpires`
  columns for no PoC benefit. No dependency upgrade was needed (the API exists in
  the pinned tree) and no auth-schema migration was required. The legacy PBKDF2
  verify hook (`verifyPasswordWithLegacyFallback`) is untouched: credential
  accounts still carry imported hashes; passwordless accounts sign in via magic
  link or passkey. Verified by `npm run check` + `npm run smoke` +
  `npm run e2e:auth`.
