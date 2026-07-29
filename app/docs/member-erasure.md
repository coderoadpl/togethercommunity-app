# Member erasure

Member removal is a policy-aware pseudonymization flow. It is not a blind
database cascade and does not promise that every record associated with a
member is physically deleted.

## What removal does

`removeMember` in `core/server/usecases/members.ts` authorizes
`member:remove`, builds opaque tombstone identifiers with `memberTombstone`
from `core/domain/tenant.ts`, and lists the member's subscriptions. Stripe
subscriptions with provider identifiers are canceled immediately before
pseudonymization. Simulated subscriptions and rows without provider identifiers
are skipped.

Provider cancellation failure does not block erasure. The response reports the
outcome for every subscription, the server writes a `[member-removal]` runtime
error, and staff sees a transient warning naming subscriptions whose
cancellation returned `failed`. Re-running member removal retries every Stripe
row regardless of its local status.

If cancellation fails and a late `invoice.paid` arrives, the erased member is
charged again, the local subscription flips from `canceled` back to `active`, a
product grant is restored for the tombstoned member, and a new paid order is
created after erasure with the retained company name, address, postal code,
city, and NIP copied from the previous order. The member row and severed auth
identity remain tombstoned, so nobody can log in with that restored grant and
the paid-without-grant reconciliation report remains empty. Provider
reconciliation must therefore finish before the next billing cycle.

`MemberErasurePort.pseudonymize` then runs. The implementation in
`adapters/db/repositories.ts` performs one transaction that:

- records the erasure in `erasedMemberImports`;
- end-dates product grants and marks member subscriptions canceled locally;
- replaces post author labels with `DELETED_MEMBER_DISPLAY`;
- replaces the member `userId` and e-mail with tombstone values;
- clears the display name, tags, marketing-consent projection, external
  customer identifiers, legacy identifier, and ban state (`bannedAt`,
  `bannedReason`, and `bannedByUserId`); and
- records `deletedAt`.

Marking member subscriptions canceled locally remains true only until a late
`invoice.paid` flips a surviving provider subscription back to `active`.

The transaction does not rewrite free text retained for moderation and audit:
`member_events.reason` and `post_reports.note` keep their original values.
Pseudonymization changes the member projection and reporter display, but it
does not minimize these event and report fields.

The staff member-detail surface preserves learning, grant, and e-mail history.
It hides granting and renewal controls for a tombstoned member, while keeping
Revoke as a reducing corrective action. This is deliberately a UI-only guard:
the server mutations are unchanged, and a tombstoned identity cannot
authenticate because its user identifier has been severed.

## Consent-evidence retention policy

Consent evidence rows currently retain their original `userId` and plaintext
e-mail after member erasure. This implementation behavior is pinned in
`adapters/db/repositories.test.ts`. It supports the controller's obligation
under GDPR Article 7(1) to demonstrate that consent was given, read with
Article 17(3)(b), which permits processing necessary for compliance with a
legal obligation.

Retention period (owner decision 2026-07-29): consent evidence is retained
for **six years from consent withdrawal or member erasure, counted to the end
of the calendar year** in which that six-year period elapses. This mirrors the
general limitation period for property claims under art. 118 of the Polish
Civil Code, so the proof of consent exists exactly as long as a claim about
the underlying communication could be raised. A purge mechanism enforcing
this horizon is follow-up work; until it ships, this section is the committed
policy and the purge is tracked in the backlog.

The marketing suppression path degrades the address to an HMAC, as pinned in
`adapters/db/repositories.test.ts`; retained plaintext is confined to the
consent-evidence rows. The long-term backlog direction is to key consent
evidence to a non-email subject reference.

## Authored content keeps member-typed personal data

Erasure changes a post's `authorDisplay` to the deleted-member label but does
not alter the post body. Free text may contain the author's or a third party's
personal data, and mechanically deciding what to redact is not reliable.

Staff can use `deletePost` in `core/server/usecases/community.ts`, which calls
`posts.softDelete`. Readers then receive `DELETED_POST_PLACEHOLDER` from
`core/domain/community.ts`, and repository search excludes rows whose
`deletedAt` is set. This is display redaction, not database erasure: the body
column still contains the original text. There is no product surface for true
Article 17 erasure of a post body. It requires an owner-executed database
intervention.

Requests are handled case by case:

- A request naming a specific post requires staff deletion followed by an
  owner-executed body scrub.
- A blanket account-deletion request uses the tombstone flow. Post bodies
  remain under the freedom-of-expression and legitimate-interest balance.
- Third-party personal data inside another member's post follows the
  `community:moderate` moderation path, not member erasure.

## Bans are not erasure

A ban (`members.banned_at`) is reversible moderation state. The person keeps
their account, sign-in, grants, orders, authored posts, and full read access.
Only community writes are refused with the `banned` error code. Every
transition is recorded in `member_events`, and staff can lift the ban.

Erasure (`memberTombstone`) is irreversible pseudonymization for a
data-subject request. It severs the user id, tombstones the e-mail, ends
grants, cancels subscriptions, lifts the tenant-visible ban, and relabels
authored content. A tombstoned identity cannot authenticate.

Never implement a ban in terms of erasure or ban a member as a step of
erasure. The UI hides ban controls for members whose `deletedAt` is set, and
`setMemberBanned` returns `not_found` for those members.

## Out of scope and known gaps

Report rows retain `post_reports.reporter_user_id` after erasure, matching the
existing retention of `posts.author_user_id`. The pseudonymization transaction
relabels `reporter_display` to `DELETED_MEMBER_DISPLAY`. A full redesign around
non-identifying subject references remains backlog item B1.

Self-service data-subject export and deletion remain backlog item B1.
Provider-side customer deletion and durable cancellation retry scheduling are
not part of this flow. The operational retry and reconciliation procedure is in
the [go-live checklist](go-live-checklist.md#15-provider-side-subscription-cancel-on-member-removal).
