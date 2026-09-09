# Architecture agent prompt (agentproofarch) — SSR/SEO and member identity

> Created 2026-07-03. For the agent working in coderoadpl/agentproofarch.
> Covers open questions 16 and 17 in tasks/prd-together.md.

```text
Product context (Together), built on agentproofarch:
a multi-tenant platform for online creators, combining digital product sales
(courses, ebooks, memberships), course delivery, community, and email marketing.
Hosted on Vercel, with free self-hosting through Docker Compose. Public product
sales pages are the creators' primary traffic channel. There are two user
populations: creators and their teams (matching the current organization model),
and students/members, the end users of each tenant.
Product PRD: coderoadpl/togethercommunity-app, tasks/prd-together.md (read it if
accessible; the key context is also provided below).

Resolve two architectural topics and record them in the foundation PRD
(tasks/prd-agentproofarch-foundation.md):

TOPIC 1 — Public SEO pages versus "No SSR, no Next.js" (FR-16, §6).
The product requires public, SEO-critical pages per tenant: product/sales pages,
landing pages, and public community pages. Requirements: complete OG/Twitter
metadata in HTML, indexing by all bots (not only Google), and a fast first paint.
A purely static SPA cannot meet these requirements. Selective SSR is acceptable
and fits Vercel, but should not overturn the architecture.
Design and document a public-page rendering layer that:
- preserves layer rules (framework-free core, lint-enforced boundaries),
- deploys the same commit to both targets (Vercel Functions and a self-hosted
  Node container), with sensible per-tenant caching and invalidation on edits,
- keeps the authenticated creator panel and member views as an SPA.
Consider at least: (a) Hono SSR for public routes (for example hono/jsx), sharing
view models with core; (b) metadata injection into index.html plus prerendering
and caching of key pages; (c) a hybrid of a and b. If Next.js is the right
tradeoff, explicitly explain why reversing that decision is worthwhile.
Add user stories and update FR-16/Non-Goals.

TOPIC 2 — Member identity model (§3.4).
Currently, one email corresponds to one global account with organization
memberships. This fits creators and teams. Should students (tenant end users)
be global users with per-tenant member profiles, or separate per-tenant entities
outside Better Auth organizations?
My intuition is that the global model is acceptable. Validate it and design the
recommended option against these hard product requirements:
- The creator owns the customer relationship: member profiles, tags, and GDPR
  marketing consent are stored per tenant, not on the global account.
- Full per-tenant member export is available as CSV/JSON, including emails.
- One email can belong to multiple tenants; members must not see a list of
  other tenants through their account, for privacy reasons.
- A creator can remove a member from THEIR tenant: remove the membership and
  tenant-scoped data, rather than the global account.
- Stripe purchase webhooks can create passwordless member accounts that use
  magic-link sign-in.
- Cookies cannot span unrelated custom domains. Describe sign-in per custom
  domain versus APP_BASE_DOMAIN subdomains and the implications for members.
Update §3.4 (identity model), and add a decision record with the rationale and
GDPR consequences, including who controls member data.

For both topics, first propose the decision briefly for approval, then update
the PRD and any user stories. Do not implement before the decision is approved.
```
