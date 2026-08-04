# Phase 0-1 gap list — execution queue

> **Source:** reality audit of `tasks/prd-together.md` against the code on branch `run-planning` (2026-08-03). 41 of 78 acceptance criteria verified shipped; the 37 unticked ones are packaged below.
> **Purpose:** ordered, implementable queue. One work package = one PR-sized unit with a machine-checkable done-when.
> **Sizes:** S ≤ 1 day, M ≤ 3 days, L > 3 days (split on entry).
> **OWNER-INPUT-NEEDED:** cannot start or cannot be accepted without a decision or a credential only the owner can supply. Raise these first — they have the longest lead time.

## Queue

| # | Package | Size | US | Depends on | Flag |
|---|---|---|---|---|---|
| 1 | Panel role policy decision | S | US-003 | — | OWNER-INPUT-NEEDED |
| 2 | External provider accounts provisioning | M | US-011..014, US-031 | — | OWNER-INPUT-NEEDED |
| 3 | Tenant lifecycle fields + default single-tenant mode | M | US-001 | — | |
| 4 | Framework-level tenant scoping proof | M | US-001 | 3 | |
| 5 | Production compose + self-host guide + real clone-to-panel timing | M | US-004 | 3 | |
| 6 | Product type + missing product metadata | M | US-020 | — | |
| 7 | Free preview lessons | S | US-021 | — | |
| 8 | Storage/email port contracts + uniform `test()` | M | US-010 | — | |
| 9 | S3-compatible storage wizard with live CRUD probe | L | US-011 | 2, 8 | |
| 10 | Presigned upload + generic private attachments | M | US-021, US-022 | 9 | |
| 11 | Digital download delivery | M | US-023 | 6, 10 | |
| 12 | Stripe wizard: automatic webhook + test/live badge | M | US-013 | 2, 8 | |
| 13 | Subscription cancellation → grant expiry at period end | M | US-031 | — | |
| 14 | Resend adapter + email wizard completion | M | US-014 | 2, 8 | |
| 15 | YouTube/Vimeo provider validation + privacy copy | S | US-012 | — | |
| 16 | Drag-and-drop module/lesson ordering | S | US-021 | — | |
| 17 | Extensible member domain-event model | M | US-034 | — | |
| 18 | Member 360 card: purchases, subscriptions, order→member link | M | US-034 | 17 | |
| 19 | Branding: tenant name + social links | S | US-033 | 3 | |
| 20 | Live-provider acceptance runs | M | US-011..014, US-031 | 2, 9, 12, 14 | OWNER-INPUT-NEEDED |
| 21 | Embed widgets `/embed/*` | M | US-030 | — | post-MVP |

## Ordering rationale

1. **Owner-gated items go first (1, 2)** even though they are not the largest — they block acceptance of packages 9-14 and 20, and the owner's turnaround is outside our control. Everything else can proceed while they are pending.
2. **Schema before UI (3, 6, 7, 17).** Tenant, product, lesson and member-event shapes are all incomplete. Every later package writes UI and API on top of them; changing them after that multiplies migration and rework cost.
3. **Self-host (5) early, not last.** `docker compose up` and "< 15 min from clone" are headline promises in §5 and the only credible acceptance path for the dogfooding gate. Today there is no app Dockerfile at all, so the claim is untestable.
4. **Storage chain is strictly sequential (8 → 9 → 10 → 11).** The port contract must settle before the wizard, the wizard before uploads, uploads before secured downloads. Attempting 11 first produces a download route with nothing to download.
5. **Correctness bug (13) is scheduled above cosmetic gaps** — it silently over-grants access to cancelled members and is the one item in the list that costs the creator money.
6. **Member 360 (17, 18) before phase 2.** The event model is the documented extension point for community and marketing events (FR-36, FR-55). Building it after phase 2 means retrofitting it into a live timeline.
7. **Embeds (21) last** — the PRD itself marks them post-MVP (US-030), and the shareable checkout URL already covers the zero-infrastructure creator.

---

## Packages

### 1. Panel role policy decision — S — OWNER-INPUT-NEEDED

US-003 requires panel access for `owner` only; the capability matrix grants most panel capabilities to admin staff and reserves only sensitive writes (`tenant:settings:write`, `tenant:secret:write`, `api-key:write`, `integration:test`) for the owner (`app/core/domain/authorization.ts`).

**Decision needed:** restrict the panel to `owner` and defer staff roles to the paid tier (§4 Z-4), or accept staff-in-panel as core and rewrite the criterion.

**Done when:** US-003 criterion matches the capability matrix, and a regression test asserts the chosen policy.

### 2. External provider accounts provisioning — M — OWNER-INPUT-NEEDED

Live-probe acceptance for US-011..014 and the full Stripe browser flow (US-031) cannot be produced from fixtures.

**Needed from owner:** S3-compatible bucket + scoped keys (one of AWS/R2/B2/MinIO), Bunny library + API key, Stripe test-mode account keys, SMTP credentials and an SES-verified sending domain.

**Done when:** credentials are stored as tenant secrets in a dedicated acceptance tenant and readable by the verification scripts.

### 3. Tenant lifecycle fields + default single-tenant mode — M

`tenantSchema` carries `id/slug/name/contentVersion` only — no `subdomain`, `status`, `plan` (`app/core/domain/tenant.ts`). Self-host resolves a tenant via the `X-Tenant` header fallback (`app/core/server/usecases/resolve-tenant.ts`), which is not "works without subdomain configuration".

**Scope:** add `status` (active/suspended) and `plan` to the tenant model and schema with a migration; treat the subdomain as derived from `slug` + `APP_BASE_DOMAIN` or store it explicitly, whichever the domain resolver needs; add a single-tenant mode that resolves the sole tenant when no domain, subdomain or header matches.

**Done when:** a fresh install with no `APP_BASE_DOMAIN` serves the panel on `localhost`; suspended tenants are refused at resolve time with a test.

### 4. Framework-level tenant scoping proof — M

Repositories take `tenantId` and authorization is centralized, but nothing structurally prevents a new repository method from omitting the filter. US-001 requires enforcement below the handler layer.

**Scope:** either a lint/dependency-cruiser rule that rejects repository methods without a `tenantId` parameter, or a query-layer wrapper that injects the predicate; extend `app/config-regression/authorization.test.ts` with a coverage assertion over all tenant-scoped repositories.

**Done when:** `npm run check` fails on a deliberately unscoped repository method.

### 5. Production compose + self-host guide + real clone-to-panel timing — M

Only `app/docker-compose.dev.yml` exists (Postgres + Mailpit); there is no app image and no production compose. `app/scripts/quickstart-probe.ts` times migrate/seed/server/CLI, not clone-to-browser-panel.

**Scope:** app `Dockerfile`; `docker-compose.yml` with app + Postgres (+ Caddy on-demand TLS per §10) starting from `.env` only; self-host README under one page; extend the probe to measure clone → first-run wizard → panel rendered.

**Done when:** a clean clone reaches an owner-authenticated panel via `docker compose up` in under 15 minutes, measured by the probe and recorded.

### 6. Product type + missing product metadata — M

`productSchema` has no product-type field, no `slug` and no cover; `description` is plain text (`app/core/domain/product.ts`). US-020 requires `course` / `digital_download` / `membership`, slug, rich-text description and cover.

**Scope:** add `type`, `slug` (unique per tenant), `coverUrl`, rich-text description; migrate existing rows to `course`; surface type in the products panel and in the public offer JSON; keep price kind (`one_time`/`recurring`, `app/core/domain/commerce.ts`) consistent with `membership`.

**Done when:** all three types are creatable in the panel and appear correctly in the public offer payload.

### 7. Free preview lessons — S

The lesson schema has no preview flag (`app/core/domain/course.ts`), so FR-22 is unimplemented.

**Scope:** `isPreview` on the lesson; entitlement checks in `app/core/server/usecases/lesson-media.ts` bypass the grant requirement for preview lessons only; preview lessons exposed in the public offer.

**Done when:** an anonymous request to a preview lesson succeeds and to a non-preview lesson in the same course returns 403, both under test.

### 8. Storage/email port contracts + uniform `test()` — M

`EmailPort` exposes `send` only; the storage side exposes a signed-GET signer (`FileUrlSigner`) with no upload/delete/healthcheck; only Stripe has a diagnostic (`app/core/server/usecases/payment-integrations.ts`). US-010 requires healthcheck on every provider and a panel-consumed `test()` per adapter.

**Scope:** define `StorageProvider` (presigned PUT, signed GET, delete, healthcheck) and extend `EmailPort` with healthcheck; one shared diagnostic result type carrying a user-facing message and a machine code; wire every adapter into a single panel-facing `test()` use case.

**Done when:** the integrations panel runs the same diagnostic contract for storage, email and payment.

### 9. S3-compatible storage wizard with live CRUD probe — L

No provider/endpoint/region/bucket wizard, no upload-read-delete probe, no per-provider key instructions, no friendly credential errors (US-011, all four criteria missing).

**Scope:** wizard steps provider → connection fields → live probe (put, get, delete a scratch object) → save as encrypted tenant secret; SDK error mapping to actionable messages (wrong region, bad key, missing bucket, CORS); per-provider instructions for AWS S3, Cloudflare R2, Backblaze B2 and MinIO; browser verification added to the screenshot scripts.

**Split on entry:** (a) wizard + persistence, (b) live probe + error mapping, (c) provider instructions + browser verification.

**Done when:** a real bucket from package 2 completes the probe from the panel and the failure paths render mapped messages.

### 10. Presigned upload + generic private attachments — M

Signed GET exists for imported PDF/media only; there is no upload path and no generic attachment model, so FR-14 and the US-022 attachment criterion are unmet.

**Scope:** presigned-PUT upload direct from browser to the creator's bucket; attachment records on lessons; expiring signed GET behind the existing entitlement check.

**Done when:** an attachment uploaded in the lesson editor downloads for an entitled member and 403s for everyone else.

### 11. Digital download delivery — M

No digital-download asset model, no download route, no download buttons on the member purchases page (`app/apps/web/src/features/member/MyProductsPage.tsx`).

**Scope:** assets attached to `digital_download` products; download route issuing expiring signed URLs after a server-side grant check; download buttons on "my products"; browser verification.

**Done when:** a purchased download is retrievable and an unentitled member receives 403, both covered by test and browser run.

### 12. Stripe wizard: automatic webhook + test/live badge — M

Credentials and a manually copied webhook URL exist (`app/apps/web/src/features/home/integrations/IntegrationsPanel.tsx`); webhook registration is not automatic and no Stripe mode is stored or displayed.

**Scope:** register the webhook endpoint via the Stripe API on save and store the signing secret; detect and persist test/live mode from the key; badge it in the panel; document the restricted-key permission set.

**Done when:** saving keys produces a working webhook without manual steps, and the panel shows the mode.

### 13. Subscription cancellation → grant expiry at period end — M

`customer.subscription.deleted` is processed but deliberately leaves the grant expiry untouched (`app/core/server/usecases/stripe-webhook.test.ts` asserts "without cutting the grant"), so cancelled members keep access indefinitely — FR-33 unmet.

**Scope:** track `current_period_end` on subscription events; set grant expiry to it on cancellation; renewal extends it; revoke immediately on cancellations without a paid period.

**Done when:** cancel-at-period-end, immediate cancel and renewal each produce the correct grant expiry under test, and the existing assertion is inverted.

### 14. Resend adapter + email wizard completion — M

SMTP test UI and SES onboarding exist; Resend is absent (FR-16). Hosted fallback is shipped (`app/core/server/usecases/layered-transactional-email.ts`).

**Scope:** Resend adapter behind `EmailPort`; wizard parity across SMTP/SES/Resend with the package-8 diagnostic; test-email delivery to the creator's address; browser verification.

**Done when:** all three transports pass the same test-email flow from the panel.

### 15. YouTube/Vimeo provider validation + privacy copy — S

Lessons accept any absolute embed URL (`app/core/domain/course.ts`) with an iframe preview; provider-specific validation is absent, and the privacy warning covers Bunny only (`app/apps/web/src/i18n/pl.ts`).

**Scope:** recognize and normalize YouTube and Vimeo URLs (watch/short/embed forms) with an inline preview; per-provider privacy note stating unlisted ≠ protected, plus the YouTube terms-of-service note required by Z-1.

**Done when:** malformed provider URLs are rejected with a specific message and each supported provider renders its privacy note.

### 16. Drag-and-drop module/lesson ordering — S

Ordering and move actions exist (`app/core/domain/course.ts`, `app/apps/web/src/features/home/courses/CourseDetail.tsx`) but only as buttons.

**Scope:** drag-and-drop over the existing move use cases, keyboard-accessible, with optimistic reorder and rollback on error.

**Done when:** reordering by drag persists and the keyboard path remains functional.

### 17. Extensible member domain-event model — M

`member_events` accepts `banned` / `unbanned` only (`app/adapters/db/app-schema.ts`); email history lives in a separate tab. FR-36 requires one model extensible to community, email and later sources without rework.

**Scope:** open the event type to a registry with a typed payload per type; emit purchase, grant, revoke, subscription-change, lesson-completion and email-sent events; backfill from existing orders, grants and email history; one merged timeline query.

**Done when:** adding a new event type requires a registry entry and no schema migration, asserted by a test.

### 18. Member 360 card: purchases, subscriptions, order→member link — M

The member card shows grants and progress but no purchases and no Stripe subscription status; order rows render the member as plain text (`app/apps/web/src/features/home/sales/SalesPanel.tsx`).

**Scope:** purchases and active subscriptions with Stripe status on the card; the package-17 timeline embedded; order rows link to the member card in one click.

**Done when:** every US-034 criterion is demonstrable in one browser pass.

### 19. Branding: tenant name + social links — S

Logo, accent colour and OG description are editable (`app/apps/web/src/features/home/settings/SettingsPanel.tsx`); tenant name and social profile links are not.

**Scope:** editable tenant name (slug stays immutable) and a social links list rendered on public, member and transactional-email surfaces.

**Done when:** name and social links round-trip through settings and appear on all three surfaces.

### 20. Live-provider acceptance runs — M — OWNER-INPUT-NEEDED

Browser verification currently runs against the fake payment provider and fixtures; no real Stripe, storage, Bunny or SMTP/SES run exists (US-013, US-014, US-031 verification criteria).

**Scope:** an acceptance suite against the package-2 credentials — Stripe test-mode purchase end to end, storage CRUD probe, Bunny signed playback, test email delivery — with artefacts recorded.

**Done when:** each verification criterion is backed by a dated run against real providers.

### 21. Embed widgets `/embed/*` — M — post-MVP

No embed loader, iframe endpoint or postMessage resize; the public route manifest bounds the public surface without them (`app/apps/server/src/public-route-manifest.ts`).

**Scope:** script loader, iframe endpoint per product, postMessage auto-resize, documented snippet.

**Done when:** a static page on a foreign origin embeds a product widget that resizes to content and reaches checkout.
