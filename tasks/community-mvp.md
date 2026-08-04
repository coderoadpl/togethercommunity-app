# Community MVP — lesson discussions with notifications

> Status: accepted by the owner (2026-07-15). Driver: buyers of paid content
> must be able to ask questions under a lesson and get answers from each other
> and from the author (szczegóły biznesowe w prywatnych materiałach
> właściciela). This is the Faza-2 vertical slice.

## Scope (owner requirements, verbatim intent)

1. **Discussion under a lesson** — posts attached to a lesson context.
2. **Nested replies** — unlimited nesting; UI indents to 5 levels then continue-thread subview (Reddit model).
3. **Posts** — first-class entities with author, body, edit/soft-delete.
4. **Post search** — full-text, filtered by the member's lesson entitlements.
5. **Thread subscriptions** — reply triggers notifications to subscribers.
6. **Notification channel** — port-based so web push can be added later;
   today: **in-app (real-time)** + **e-mail**; in-app unread badge updates live.

## Design decisions

- **Context-generic posts**: `posts { id, tenantId, contextKind ('lesson' —
  'space' arrives with full Faza 2), contextId, parentPostId?, rootPostId?,
  authorUserId, authorDisplay, body (sanitized), createdAt, editedAt?,
  deletedAt? }`. Soft delete keeps thread shape ("Wpis usunięty").
- **Visibility = lesson entitlement**: you see/search/write a lesson's
  discussion iff the lesson is fully-accessible to you (staff always).
  Free-preview lessons therefore have OPEN discussions for preview users —
  deliberate (community teaser inside the paid-content funnel).
- **Subscriptions**: `thread_subscriptions { tenantId, userId, rootPostId,
  mutedAt? }`; auto-subscribe author + everyone who replies; explicit
  follow/mute toggle per thread. Reply fan-out notifies subscribers minus the
  reply author.
- **Notifications**: `notifications { id, tenantId, recipientUserId, kind
  ('thread-reply'), payload jsonb, readAt?, createdAt }` +
  **`NotificationChannelPort.deliver(notification)`** implementations:
  `in-app` (insert row + emit on the realtime bus), `email` (EmailPort, PL/EN
  template), future `web-push` (same port, new adapter — no redesign).
- **Real-time = SSE**, not websockets: one-way stream fits notifications,
  native on the Node/self-host target, and the foundation's no-websockets
  non-goal stays intact. Endpoint `GET /api/notifications/stream`
  (authenticated, tenant-scoped). On serverless (Vercel function duration
  limits) the client transparently falls back to TanStack polling — the bus
  is an implementation detail behind the port.
- **Search**: Postgres full-text (tsvector GIN on posts.body, `simple` config
  + unaccent-style normalization), endpoint returns hits grouped by lesson,
  entitlement-filtered server-side.
- **Moderation minimum (FR-42 subset)**: authors edit/delete own posts; staff
  delete any post.

## Out of scope (full Faza 2 later)

Spaces, standalone community feed, reactions, mentions, e-mail digests,
notification preferences UI, real push, moderation queue/bans, member
profiles. Model shapes above are chosen so none of these require breaking
changes (contextKind, kind, port).

## Spaces shipped (2026-07-20)

The spaces sprint delivered the first chunk of the "full Faza 2" list on top
of the contextKind design — no schema breaks, `contextKind: 'space'` slotted
in as planned. PL term: **strefa** (tenant stays „przestrzeń"; decision
recorded in `terminology-glossary.md`).

Scope shipped:

- **Spaces** (`spaces` table, migrations 0021–0022): slug + name +
  description, `visibility: 'members' | 'product'` (product-gated via active
  grants), ordering, soft **archive/restore** (archived = invisible to
  members, posts and followers kept).
- **Space feed**: root posts with cursor pagination (composite
  `createdAt|id` cursor), reply threads reusing the lesson discussion
  machinery, `replyCount` per thread.
- **Reactions**: fixed emoji set (👍 ❤️ 🎉 💡 😂) on any accessible post,
  toggle add/remove, per-emoji counts with `viewerReacted`.
- **Follows + notifications**: follow/unfollow a space;
  `kind: 'space-post'` fan-out to followers (entitlement-checked at delivery
  time) through the same NotificationChannelPort — in-app SSE badge and
  e-mail both work with zero port changes, validating the port design.
- **Member UI**: Społeczność tab (desktop nav + mobile bottom tab bar),
  spaces list with visibility chips, feed with composer and reactions,
  thread subview. **Panel UI**: spaces CRUD (create/edit form,
  archive/restore with filters); hard delete is CLI/API-only.
- **CLI**: `space create/update/delete/archive/restore/stats/list/feed/
  post/reply/follow/unfollow`.
- **Verification**: smoke drives the full lifecycle (create → visibility per
  entitlement → post → reply → react → notification rows → archive hides);
  visual harness covers community, space-feed and panel-spaces screens in
  all three themes; adversarial browser QA + cross-tenant curl probes in
  `scripts/qa-spaces.ts` (403/404/401 on cross-tenant feed reads).

Accepted trade-offs (reviewed, deliberate):

- A non-entitled member probing a gated feed by id gets 403 (existence
  signal) — consistent with lesson discussions; the UI shows a neutral
  "not found or no access" screen either way.
- Hard-deleting a space leaves its posts as unreachable rows (no FK from
  posts.contextId); archive is the product flow, delete is an operator tool.
- Notification payload reuses the `lessonName` field for the space name —
  documented in the schema, keeps old persisted rows parseable.

Still deferred to later Faza-2 iterations: **mentions**, **e-mail digests**,
**moderation queue/bans**, notification preferences UI, real web push,
member profiles beyond the lite author chips.
