# PRD: Together — a Fair Source platform for creators

> **Status:** Design assumptions, version 2 (2026-07-02, after founder feedback).
> **Name:** Together (decided). Domain options remain open; candidates are in private materials.
> **Purpose:** A basis for executable tasks, not an implementation specification.
> **Unconfirmed decisions** are marked ⚠️ and collected under Open questions.
> **Previous iteration (June 2025):** The owner's private archive contains its project description, PRD, and tech stack. This document supersedes it while retaining ideas such as public/paid/hidden access and API membership management.
> **Reality audit (2026-08-03):** Acceptance checkboxes reflect verified code. Checked means shipped with evidence; unchecked means partial or missing. Remaining phase-0/1 work is in `tasks/phase1-gaps.md`.

---

## 1. Introduction and vision

A Circle.so-style platform bringing four pillars of an online creator's work together:

1. **Sales** of digital products: courses, ebooks, memberships.
2. **Marketing:** email, landing pages, automations, coupons.
3. **Delivery:** course playback, file downloads, access control.
4. **Community:** spaces, discussions, memberships.

**Problem:** Creators selling digital products currently combine four to six paid tools (Circle/Kajabi/Teachable, MailerLite, Stripe, and a landing-page builder), spend USD 50–300/month, and surrender control of content and customer lists to closed platforms. Open-source alternatives such as Moodle, LearnHouse, and Discourse cover individual pillars and are not designed around sales.

**Our answer:** Fair Source / source-available distribution: free self-hosting with all core features and an inexpensive hosted version (USD 1–5/month). We host only the app, database, and authentication. **Large content, including videos and files, remains the user's property** on external services such as S3, YouTube, Vimeo, and Bunny.

**Product values, in order: reliability, versatility, price.**

**Positioning:** Price attracts users; BYO makes it possible. Data-ownership ideology alone addresses too small an audience. We offer a price that lets creators keep the platform when sales decline. BYO storage makes that price viable because we cannot host video at this cost. The user arrives for the price, discovers that a YouTube link embeds a video, and usually needs nothing more.

**Connecting the pillars: one member overview.** A creator sees all subscriptions, purchases, email communication, course progress, community activity, and, where available, website visits on one member card. This is not a CRM with funnels, pipelines, or lead scoring. The creator needs to understand one person's history without switching between five tools. A future external chat integration can bring the remaining communication into the same view.

---

## 2. Guiding principles

These principles resolve future design disputes. Every feature must follow them.

### Z-1: Users own their content (BYO storage)

- The platform never stores large videos or downloadable files. It stores metadata, course structure, text content, end-user data, sales data, and configuration.
- Videos and files live with user-connected providers: S3-compatible services (AWS S3, Cloudflare R2, Backblaze B2, MinIO), unlisted YouTube, Vimeo, or Bunny Stream/Storage.
- The default path for nontechnical creators is a YouTube link, requiring no setup or payment. UI and documentation must explain that lesson hosting must comply with YouTube's terms; creators are responsible for their content.
- Hosted infrastructure costs are limited to database and compute, making USD 1–5/month feasible. BYO is a condition of the price.
- No lock-in: full JSON/CSV export at any time; leaving the platform does not mean losing content.
- Future, outside MVP: a paid convenience uploader backed by Bunny Stream. The external provider owns the hosting relationship and costs are passed through transparently. This still follows Z-1.

### Z-2: BYO payments and email

- Creators supply their Stripe keys. Money goes directly to their Stripe accounts; the platform does not intermediate funds or take a core-plan sales commission.
- Creators supply their email provider: SMTP, Amazon SES, Resend, or Postmark.

### Z-3: Connecting integrations must be effortless

- Configure storage, Stripe, and email through the panel: step-by-step wizard, live key validation, end-to-end tests such as upload/read, and clear errors.
- Hosted users are nontechnical. Provide illustrated instructions showing where to obtain each provider's keys.

### Z-4: Fair Source and a fair split

- Self-hosting is free and includes all four core pillars. Install with `docker compose up`.
- Hosted users get the same core features and pay for hosting, backups, updates, authentication, and avoiding operations work.
- Hosted custom domains and white-labeling are paid branding conveniences. Self-hosted custom domains and removable badges are accepted; self-hosters promote the project through GitHub while hosted users pay for convenience.
- Future higher plans may add business features such as teams and permissions, advanced automations, and priority support. Never move existing core features behind a paywall.

### Z-5: Creator-first

- The primary persona is a creator without technical support. Evaluate every flow by whether a YouTuber can complete it independently within an hour.

---

## 3. Target audiences

| Persona | Description | Version | Key need |
|---|---|---|---|
| **Creator priced out of the market** (primary) | Educator unable to afford USD 89–500/month for Circle/Kajabi, or who cancels when sales fall | Hosted | A price sustainable indefinitely; video through YouTube links |
| **Nontechnical creator** | YouTuber/Instagramer with 1k–100k followers selling a course or ebook | Hosted | Start selling in one day without operations work |
| **Technical creator** | Developer and creator, like the platform's author | Self-host | Full control without vendor lock-in |
| **Member** | Buys, learns, and discusses | — | Simple purchases, comfortable playback, one account with each creator |
| **Creator's team** (future) | Assistant, moderator, editor | Paid plan | Roles and permissions |

Technical and data-ownership audiences are welcome but secondary, too small to drive growth alone.

**First real tenant:** Migrate the author's own course from the previous platform to validate delivery, payments, and migration. Details remain in the owner's private materials.

---

## 4. Business and distribution model

Free self-hosting with the full Fair Source core, plus inexpensive hosting on a subdomain with a “Powered by Together” badge. Paid branding extras include custom domains and white-labeling; a future Pro plan adds business features. Detailed pricing and policies live in the owner's private operational materials.

- **FSL-1.1-ALv2:** Source is available under Fair Source terms and becomes open source under Apache-2.0 two years after each release. Before then, self-hosting is permitted and competing hosting is prohibited.
- Public GitHub monorepo; hosted distribution uses the same code plus a closed billing/provisioning module.

### Constraints

- One person plus AI agents; no hiring.
- Use proven technology, few infrastructure components, managed services or user-supplied providers, and automated testing/CI from day one. There is no separate QA team. Phase scope must be realistic for a solo developer assisted by AI.
- Phase discipline is essential, as illustrated by the Zenbership research: do not start phase N+1 before phase N works.

---

## 5. Goals

- A nontechnical creator goes from registration to a published, purchasable product in less than one day, ultimately less than two hours.
- A technical creator self-hosts in less than 15 minutes using Docker Compose and the startup wizard.
- Full core-feature parity between hosted and self-hosted versions, from one codebase.
- Migrate the author's course as the first tenant and test every pillar there before public launch (§6).
- Keep 100% of large content outside our infrastructure.

---

## 6. Scope and phases

⚠️ Assumption pending confirmation: **MVP = Delivery + Sales**, followed by Community, then Marketing. This is the shortest path to a product creators can earn money with and meets the first tenant's migration needs.

### Phase 0 — Foundation

Multi-tenancy, authentication, creator panel, integration adapters for storage/email/Stripe, Docker Compose self-hosting, and design system.

### Phase 1 — MVP: Delivery + Sales

Courses/files/memberships, course builder, BYO video playback, Stripe checkout, grants, product surface, and basic branding.

### Phase 2 — Community

Spaces, posts, comments, reactions, product-linked memberships, notifications, and moderation.

### Phase 3 — Marketing

Email broadcasts and sequences, tags/segments, landing pages, coupons, and simple purchase → tag → sequence automations.

### Phase 4 — Platform monetization and Pro

Hosted billing, self-service tenant provisioning, custom domains and white-labeling, teams, advanced automations, and creator-product affiliates.

Phases 2–4 require separate detailed PRDs before implementation; this document gives their direction.

### Commercial launch gate: first-tenant use

Launch hosted sales, platform marketing, and external creator onboarding only after marketing, sales, and delivery have been tested on the first live tenant with real members. Build in phases, but do not commercialize immediately after phase 1. The core scope is manageable enough to deliver a more mature product first. The author's tenant allows end-to-end validation without risking other creators' reputations.

---

## 7. User stories

Phases 0 and 1 are specified as implementable stories; phases 2–4 remain epics.

### Epic A: Multi-tenancy and authentication (Phase 0)

#### US-001: Multi-tenant application skeleton

**Description:** As an operator, I want one instance to serve multiple creators with complete data isolation.

**Acceptance criteria:**
- [ ] `Tenant` model: name, slug, subdomain, status, plan.
- [ ] Every tenant data collection has `tenantId`; framework-level access control enforces filtering rather than individual handlers.
- [x] Subdomain routing: `{slug}.platform.dev` selects the tenant; unknown subdomains return 404.
- [ ] Self-hosted single-tenant mode works without subdomain configuration.
- [x] Automated test: tenant A's user cannot read tenant B's records.
- [x] Typecheck and lint pass.

#### US-002: Tenant accounts and roles

**Description:** As a creator, I want an administrative account and member accounts for my audience, separating management from learning.

**Acceptance criteria:**
- [x] Roles: `owner` and `member`, extensible to staff and moderator roles.
- [x] Email/password and magic-link registration/sign-in.
- [x] Email password reset.
- [x] Per-tenant `members` records with one global sign-in account; one email can independently belong to two creators (agentproofarch ADR-0002).
- [x] Typecheck and lint pass.

#### US-003: Creator panel skeleton

**Description:** As a creator, I want Products, Sales, Members, Integrations, and Settings navigation in one panel.

**Acceptance criteria:**
- [x] Panel layout with navigation and coming-soon states for empty sections.
- [ ] Access restricted to `owner`.
- [x] Responsive, including phone use.
- [x] Typecheck and lint pass.
- [x] Browser verification (dev-browser skill).

#### US-004: One-command self-hosting

**Description:** As a technical creator, I want to launch with `docker compose up` without spending time on operations.

**Acceptance criteria:**
- [ ] Repository `docker-compose.yml` with app and Postgres; only `.env` needs editing.
- [x] Browser first-run wizard creates the owner and tenant.
- [ ] Self-host README instructions shorter than one page.
- [ ] Measured clone-to-panel time below 15 minutes.

### Epic B: BYO integrations (Phase 0)

#### US-010: Integration adapter framework

**Description:** As a developer, I want shared storage, email, and payment interfaces so adding providers is inexpensive.

**Acceptance criteria:**
- [ ] `StorageProvider`: presigned upload, signed GET, delete, healthcheck; `EmailProvider`: send, healthcheck; `PaymentProvider`: checkout session, webhook verification.
- [x] Integration secrets encrypted at rest.
- [ ] Each adapter exposes a panel-consumed `test()` returning success or a diagnostic.
- [x] Typecheck and lint pass.

#### US-011: S3-compatible storage wizard

**Description:** As a creator, I want to connect my AWS S3, Cloudflare R2, Backblaze B2, or MinIO bucket through the panel.

**Acceptance criteria:**
- [ ] Provider choice → endpoint/region/bucket/keys → live upload/read/delete test → save.
- [ ] Invalid details produce actionable errors, not raw SDK errors.
- [ ] Provider-specific key instructions via link or tooltip.
- [ ] Browser verification (dev-browser skill).

#### US-012: YouTube, Vimeo, and Bunny Stream video

**Description:** As a creator, I want lessons to play videos from my own provider account.

**Acceptance criteria:**
- [ ] YouTube unlisted and Vimeo URLs with validation and preview.
- [x] Bunny Stream API key/library wizard, library listing, and signed embeds.
- [ ] Document each provider's privacy limits, explicitly including unlisted YouTube's weak protection.
- [ ] Browser verification (dev-browser skill).

#### US-013: Stripe connection

**Description:** As a creator, I want to connect my Stripe account in the panel so money goes directly to me.

**Acceptance criteria:**
- [ ] Restricted-key wizard with permission instructions and automatic webhook registration.
- [x] Live test creates and cancels a checkout session in test mode.
- [ ] Clearly identified test/live modes in the panel.
- [ ] Browser verification (dev-browser skill).

#### US-014: Transactional email connection

**Description:** As a creator, I want SMTP, SES, or Resend delivery from my domain for magic links and purchase confirmations.

**Acceptance criteria:**
- [ ] Wizard like US-011, testing by sending to the creator's address.
- [x] Limited shared hosted fallback so DNS setup does not block onboarding.
- [ ] Browser verification (dev-browser skill).

### Epic C: Products and delivery (Phase 1)

#### US-020: Product creation

**Description:** As a creator, I want a course, file bundle, or membership with a price and description to sell.

**Acceptance criteria:**
- [ ] Product types: `course`, `digital_download`, recurring `membership`.
- [ ] Name, slug, rich-text description, cover, one-time/recurring price, currency, draft/published status.
- [x] Panel product list filtered by status.
- [x] Browser verification (dev-browser skill).

#### US-021: Course builder

**Description:** As a creator, I want modules and lessons containing video, text, and attachments to represent my curriculum.

**Acceptance criteria:**
- [ ] Drag-and-drop module and lesson ordering.
- [ ] Lesson title, connected-provider video (US-012), rich text, and creator-S3 attachments (US-011).
- [ ] Free-preview lesson flag allowing access without purchase.
- [x] Browser verification (dev-browser skill).

#### US-022: Member course playback

**Description:** As a member, I want comfortable playback, lesson navigation, and completion tracking.

**Acceptance criteria:**
- [x] Contents and progress bar with per-account lesson completion.
- [x] Consistent player/embed for every supported provider.
- [ ] Attachments downloaded through private, expiring signed creator-S3 URLs.
- [x] Server-verified product entitlement required for access.
- [x] Browser verification (dev-browser skill).

#### US-023: Digital download delivery

**Description:** As a member, I want to download purchased ebooks or file bundles.

**Acceptance criteria:**
- [ ] My products page lists purchases with download buttons.
- [ ] Signed, expiring URLs; missing entitlement returns 403.
- [ ] Browser verification (dev-browser skill).

### Epic D: Sales (Phase 1)

#### US-030: Public sales surface: headless API, embeds, checkout links

**Description:** As a creator, I want to display offers on my Astro/Next/Webflow/HTML site through a public API and widgets and link directly to checkout, without a platform-hosted sales page ([agentproofarch ADR-0001](https://github.com/coderoadpl/agentproofarch/blob/main/docs/decisions/0001-public-surface-embeds-over-pages.md)).

**Acceptance criteria:**
- [x] Read-only public JSON offer API: published products/prices, unauthenticated GET, open CORS, tenant content-version caching; drafts hidden.
- [x] Shareable tenant-domain checkout URL with the complete purchase flow, like Stripe Payment Links, usable without creator infrastructure.
- [ ] `/embed/*` widgets with script loader, iframe, and postMessage resizing, post-MVP.
- [x] Creator-owned sites handle SEO/OG; the platform does not host marketing pages or SEO machinery.
- [x] Cross-origin curl verification of CORS/cache and browser checkout verification (dev-browser skill).

#### US-031: Stripe checkout

**Description:** As a buyer, I want card/BLIK payments through Stripe Checkout and immediate access.

**Acceptance criteria:**
- [x] CTA creates a session on the creator's Stripe account for one-time or subscription prices.
- [x] `checkout.session.completed` finds/creates the member, grants access, and sends a welcome magic link.
- [x] Idempotent webhooks; retries do not duplicate grants.
- [ ] Stripe subscription cancellation revokes membership access at the paid period's end.
- [x] Automated webhook-flow tests.
- [ ] Full browser verification in test mode (dev-browser skill).

#### US-032: Sales and members panel

**Description:** As a creator, I want order/member lists and manual grants/revocations for refunds and complimentary access.

**Acceptance criteria:**
- [x] Orders list who/what/when/amount/status; members list their grants.
- [x] Manually grant or revoke product access.
- [x] CSV export of members and orders.
- [x] Browser verification (dev-browser skill).

#### US-034: Member 360 overview

**Description:** As a creator, I want purchases, subscriptions, grants, and learning history on one member card.

**Acceptance criteria:**
- [ ] Account details, purchases, active subscriptions with Stripe status, grants, course progress, and last activity.
- [ ] Domain-event timeline extensible without redesign: community activity in phase 2, sent email in phase 3, later website visits and external chat.
- [ ] One-click access from members and orders lists.
- [x] Typecheck and lint pass.
- [x] Browser verification (dev-browser skill).

#### US-033: Tenant branding

**Description:** As a creator, I want the platform to use my logo, colors, and name.

**Acceptance criteria:**
- [ ] Logo, primary color, name, description, social links.
- [x] Branding on public/member surfaces and transactional emails.
- [x] Browser verification (dev-browser skill).

### Phase 2–4 epics: separate PRDs before implementation

- **US-E20 Community:** Public/member/product-gated spaces, rich-text posts, threaded comments, reactions, mentions, in-app and digest notifications, deletion/bans, and member profiles. Community events feed US-034.
- **US-E30 Marketing:** Tags/segments, broadcasts, drip sequences, signup forms/lead magnets, block-based landing pages, Stripe-synchronized coupons, and trigger/action automations. Every transactional or marketing email feeds US-034.
- **US-E40 Hosted platform:** Self-service signup/provisioning, platform Stripe billing, plan limits, CNAME custom domains with automatic TLS, backups, tenant export, and operator panel.

---

## 8. Functional requirements

### Core and multi-tenancy

- **FR-1:** Multiple tenants per instance with data-access-layer isolation; every query filters by `tenantId`.
- **FR-2:** Single-tenant self-hosting without multi-tenancy configuration.
- **FR-3:** Shared authentication with per-tenant ownership of the member relationship ([agentproofarch ADR-0002](https://github.com/coderoadpl/agentproofarch/blob/main/docs/decisions/0002-member-identity-and-idp.md)). Global accounts hold only sign-in, including passwordless magic links. Profiles, tags, GDPR consents, email snapshots, and grants live in per-tenant `members` records. One email may independently belong to multiple creators; no API lets a member enumerate their tenants.
- **FR-4:** Full tenant export of members, orders, course structure, and posts in JSON/CSV.

### BYO integrations

- **FR-10:** Encrypt integration secrets at rest.
- **FR-11:** Configure every integration entirely in a panel wizard with validation and live tests; no config-file editing required.
- **FR-12:** Support arbitrary S3-compatible endpoints, including AWS S3, Cloudflare R2, Backblaze B2, and MinIO.
- **FR-13:** Support unlisted YouTube, Vimeo, and signed Bunny Stream embeds; new providers must not require lesson-model changes.
- **FR-14:** Upload directly to creator storage using presigned URLs, bypassing our server.
- **FR-15:** Serve member files through signed, expiring URLs after server-side authorization.
- **FR-16:** Support SMTP, Amazon SES, and Resend email delivery.

### Products and delivery

- **FR-20:** Support courses, digital downloads, and recurring memberships.
- **FR-21:** Courses contain modules and lessons; each lesson may combine video, rich text, and attachments.
- **FR-22:** Free-preview lessons are accessible without purchase.
- **FR-23:** Persist completed lessons and display member progress.
- **FR-24:** Authorize product content on every server request, beyond hiding UI controls.

### Sales

- **FR-30:** Payments use the creator's Stripe account and keys; the platform does not process funds.
- **FR-31:** A purchase creates a missing member account, grants access, and emails a sign-in link.
- **FR-32:** Stripe webhooks are idempotent and tested.
- **FR-33:** Expired/canceled subscriptions revoke membership access at the end of the paid period.
- **FR-34:** Creators can manually grant and revoke access for any member.
- **FR-35:** No platform-hosted public product pages (agentproofarch ADR-0001). Provide unauthenticated, read-only offer JSON with open CORS and content-version caching, shareable tenant-domain checkout URLs, and post-MVP `/embed/*` widgets. Creator-owned sites handle sales-page SEO.
- **FR-36:** A member 360 card combines purchases, subscriptions, grants, progress, and domain-event history. Extend its event model without redesign for community activity (phase 2), email (phase 3), and later website visits and external chat. No CRM funnels, pipelines, or lead scoring.

### Community (Phase 2 direction)

- **FR-40:** Public, all-member, and product-gated spaces.
- **FR-41:** Posts, threaded comments, reactions, in-app and email notifications.
- **FR-42:** Content deletion and member bans.

### Marketing (Phase 3 direction)

- **FR-50:** Manual and purchase-triggered member tags/segments.
- **FR-51:** Broadcasts/sequences through the creator's provider with GDPR-compliant unsubscribe handling.
- **FR-52:** Stripe-synchronized coupons.
- **FR-53:** Panel-built landing pages and signup forms using predefined blocks.
- **FR-54:** Declarative purchase/signup/tag triggers with tag/email/grant actions.
- **FR-55:** Every transactional and marketing email becomes a member-timeline event (FR-36).

### Hosted version (Phase 4 direction)

- **FR-60:** Self-service signup and provisioning without operator involvement.
- **FR-61:** Platform billing through our Stripe account, separate from creators' accounts.
- **FR-62:** Paid custom-domain CNAME and automatic TLS; the base plan has a subdomain and “Powered by Together” badge (§4).
- **FR-63:** Automatic database backups and self-service tenant export/deletion for GDPR.

---

## 9. Non-goals

**Permanently excluded by Z-1/Z-2:**

- Our own video hosting/transcoding; only a future convenience uploader on Bunny infrastructure is allowed (§4).
- Merchant-of-record payment intermediation; money always goes through the creator's Stripe.
- A cross-creator course marketplace/catalog; each tenant is independent.
- WordPress plugins, integrations, or editions. This is a different product category.

**Outside phases 0–3, potentially later:**

- Live streaming, video chats, live events.
- Real-time direct/channel chat; community starts asynchronously with posts/comments.
- Mobile apps; responsive web must suffice.
- Gamification, points, badges, leaderboards.
- Completion certificates, quizzes, exams.
- Invoicing/VAT, initially handled through Stripe Tax or external invoicing; revisit for Poland.
- Affiliates.
- UI languages beyond English and Polish.
- External automation platforms such as Zapier.
- CRM funnels, pipelines, and lead scoring. Member 360 is an overview of an individual buyer.
- An internally built chat system. The intended post-phase-3 direction is an external Chatwoot/Crisp-style integration feeding the member timeline.

---

## 10. Technical assumptions

**Normative architecture: [coderoadpl/agentproofarch](https://github.com/coderoadpl/agentproofarch)**, the founder's actively developed, agent-first, strictly layered TypeScript foundation for multi-tenant SaaS. As of 2026-07-03 it had a walking skeleton with authentication, organizations/tenants, domain resolution, custom domains, a resource spanning every layer, CLI, and SPA. Its `docs/` architecture descriptions and ADRs are authoritative. This section records Together's decisions and implications without duplicating that specification.

**Inherited decisions, superseding earlier assumptions including the 2026-07-02 Next.js recommendation:**

- **Vite + React SPA, no SSR or Next.js, with Hono HTTP.** One codebase for Node and Vercel Functions with small entrypoints, TanStack Router/Query, and shared typed `core/client` for web and CLI.
- **Drizzle ORM** with `node-postgres | neon-http` driver factory, resolving the earlier Prisma/Drizzle question.
- **Better Auth for identity only, without its organizations plugin.** ADR-0002 assigns tenants, tenant admins, and members to foundation tables. Provider sign-in, magic links, social login, passkeys, and 2FA stay behind `AuthPort`/`AuthClientPort`.
- **MUI**, replacing the earlier Tailwind/shadcn proposal.
- **Postgres:** Neon on Vercel and `postgres:16` for self-hosting.
- **Machine-enforced layers:** `core/domain → contract / server (use cases and ports) / client` → `adapters` → `apps`, with adapter instantiation only at the composition root. Boundaries, dependency-cruiser, and knip enforce the graph; `any` and assertions other than `as const` fail lint. `Result<T, AppError>` provides a closed error taxonomy and shared HTTP envelope. Architecture violations make `pnpm run check` fail.
- **CLI as the agent verification loop.** Every capability is terminal-accessible with `--json`, one stdout document, and deterministic taxonomy-based exit codes. This supports the solo-plus-AI constraint without browser dependence.
- **One commit for Vercel and Docker; only environment differs.** Vercel uses static SPA, Hono function, and Neon. Docker uses app, Postgres, and Caddy on-demand TLS for self-hosted custom domains. Vendor dependencies remain at the architecture's allowed adapter/entrypoint boundaries.
- **Per-request tenant resolution:** custom `tenant_domains` → `APP_BASE_DOMAIN` subdomain → CLI `X-Tenant` header. Always verify membership; tenant use cases receive `ctx.identity`, repositories require `tenantId`.
- **One `package.json`, no workspaces**, with the full `pnpm run check` gate for types, lint, boundaries, graph, dead code, and tests.
- Hosted Vercel was confirmed in the 2026-07-02 verification, including Pro custom domains, automatic SSL, wildcard support, and Domains API.

**Together-specific work:**

- BYO storage/email/payment ports from US-010 follow the existing `DomainPort` precedent with Vercel/Caddy/no-op implementations. Each has at least two real implementations, satisfying the no-speculative-ports rule.
- Encrypted integration secrets, member-360 domain events, and first-tenant migration from the previous platform. Migration details remain private. Tenant isolation and Stripe webhooks are critical test paths.
- Public product repository `coderoadpl/togethercommunity-app`, FSL-1.1-ALv2 (LICENSE.md). Track ongoing changes to `coderoadpl/agentproofarch`.

**Architecture questions resolved by ADRs, 2026-07-11:**

1. **Public sales surface:** [ADR-0001](https://github.com/coderoadpl/agentproofarch/blob/main/docs/decisions/0001-public-surface-embeds-over-pages.md) assigns marketing/product pages and SEO to creators' sites. Together supplies open-CORS cached JSON, shareable tenant checkout links, and post-MVP embeds. FR-35/US-030 reflect this.
2. **Member identity:** [ADR-0002](https://github.com/coderoadpl/agentproofarch/blob/main/docs/decisions/0002-member-identity-and-idp.md) assigns authentication to global accounts and relationship ownership to per-tenant tables with email snapshots. No provider organizations. Payment webhooks call idempotent `ensureMember` and deliver tenant-domain magic links. FR-3 reflects this.

---

## 11. Success measures

| Measure | Target |
|---|---|
| Registration to purchasable product, nontechnical hosted creator | Under 2 hours |
| Clone to working self-hosted panel | Under 15 minutes |
| Large files on our infrastructure | Zero |
| Tenant-isolation and webhook test coverage | All critical paths |
| Commercial launch gate | Marketing, sales, and delivery tested end-to-end on the first tenant with real members |
| Post-launch validation | At least one external creator sells a product |

---

## 12. Open questions

**Unconfirmed assumptions (⚠️):**

1. **MVP = Delivery + Sales**, rather than community-first like Circle. Community-first would swap phases 1 and 2.
2. Full marketing scope (email, landing pages, automations, coupons), deferred to phase 3.
3. ~~Stack~~ **Resolved 2026-07-03:** [agentproofarch](https://github.com/coderoadpl/agentproofarch), Vite/React, Hono, Drizzle, Better Auth, MUI, Postgres, lint-enforced layers, CLI verification, one-commit Vercel/Docker deployment (§10). Supersedes Payload and Next.js proposals.
4. **Hosted multi-tenancy:** Shared instances. Per-customer instances are too costly at USD 1–5/month.

**Decisions before the relevant phases:**

5. ~~License~~ **Resolved:** FSL-1.1-ALv2; each release transitions to Apache-2.0 after two years.
6. ~~Product name~~ **Together**, decided. Domain remains open; candidate list is private.
7. **Hosted pricing structure resolved 2026-07-03:** inexpensive subdomain/badge base plus paid custom-domain and white-label extras. Amounts/policies remain private. A limited free hosted plan as an acquisition path remains open.
8. **Default language resolved 2026-09-09:** English for the product and codebase; Polish only in translation dictionaries and the explicitly allowed schema, migration, CLA, and invoicing/VAT exceptions. Local payment and invoicing priorities remain product decisions.
9. Does phase-1 membership include paid community access, requiring some phase-2 work, or only content?
10. Accept unlisted YouTube's weak protection in exchange for zero cost with clear disclosure, or recommend Bunny by default?
11. Build from scratch or evaluate existing OSS as a foundation/reference? **Partially answered 2026-07-02:** no project covers all four pillars; recommend our own application layer with LearnHouse/CourseLit as architectural references, subject to the repository's licensing and clean-room rules. WordPress is excluded. Build email on BYO providers. Detailed research remains private.
12. Monitor competitors periodically without reactive changes; the list and assessments remain in private research materials.
13. Should BYO Stripe gain Stripe Tax and Polish invoicing integrations earlier, given the merchant-of-record trend in Paddle and Stripe Managed Payments?
14. Add hosted pause/hibernation at USD 0–1/month, retaining content but disabling sales? Proposed in research round 2 to address cancellations when sales fall; that research found no equivalent competitor offering.
15. Bring basic broadcasts and two or three fixed welcome/new-content automations into phases 1–2? Round-2 research identified missing email as a major Skool complaint and cause of a second subscription. Defer or omit a general automation builder.
16. ~~Public SEO versus no SSR~~ **Resolved 2026-07-11:** [ADR-0001](https://github.com/coderoadpl/agentproofarch/blob/main/docs/decisions/0001-public-surface-embeds-over-pages.md): public JSON API, checkout links, post-MVP embeds, without hosted marketing-page SSR. FR-35/US-030 updated (§10).
17. ~~Member identity~~ **Resolved 2026-07-11:** [ADR-0002](https://github.com/coderoadpl/agentproofarch/blob/main/docs/decisions/0002-member-identity-and-idp.md): global auth-only accounts, optionally passwordless; per-tenant email snapshots, consents, exports, no tenant enumeration, webhook `ensureMember`, and tenant-domain magic links. FR-3 updated.

---

## Related context

- **[Normative agentproofarch architecture](https://github.com/coderoadpl/agentproofarch):** multi-tenant SaaS layers, ports, CLI, and Vercel/Docker deployment (§10).
- OSS, SaaS, and Polish-market competitor research: owner's private materials.
- **June 2025 Together iteration:** private project description, PRD, and tech stack, including public/paid/hidden access, API membership management, and denormalized progress. The Vite/React/tRPC/Express/Prisma stack followed a direction later matured by agentproofarch.
- First tenant's previous platform: stack and production details remain in the owner's private materials.
