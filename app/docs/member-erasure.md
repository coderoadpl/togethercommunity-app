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
outcome for every subscription, the server writes a structured
`[member-removal]` error, and staff sees a warning naming subscriptions that
still require cancellation in Stripe. Re-running member removal retries every
Stripe row regardless of its local status.

`MemberErasurePort.pseudonymize` then runs. The implementation in
`adapters/db/repositories.ts` performs one transaction that:

- records the erasure in `erasedMemberImports`;
- end-dates product grants and marks member subscriptions canceled locally;
- replaces post author labels with `DELETED_MEMBER_DISPLAY`;
- replaces the member `userId` and e-mail with tombstone values;
- clears the display name, tags, marketing-consent projection, external
  customer identifiers, and legacy identifier; and
- records `deletedAt`.

The staff member-detail surface preserves learning, grant, and e-mail history.
It hides granting and renewal controls for a tombstoned member, while keeping
Revoke as a reducing corrective action. This is deliberately a UI-only guard:
the server mutations are unchanged, and a tombstoned identity cannot
authenticate because its user identifier has been severed.

## Consent-evidence retention policy is backlog work

Consent evidence rows currently retain their original `userId` and plaintext
e-mail after member erasure. This implementation behavior is pinned in
`adapters/db/repositories.test.ts`. It supports the controller's obligation
under GDPR Article 7(1) to demonstrate that consent was given, read with
Article 17(3)(b), which permits processing necessary for compliance with a
legal obligation.

Defining and approving a retention period remains part of backlog item B1. It
must follow the limitation period for claims applicable to the underlying
obligation and align with the accounting retention that already governs order
records. Until that work is complete, this section records implementation
behavior and legal context rather than a committed retention policy.

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

## Out of scope and known gaps

Self-service data-subject export and deletion remain backlog item B1.
Provider-side customer deletion and durable cancellation retry scheduling are
not part of this flow. The operational retry and reconciliation procedure is in
the [go-live checklist](go-live-checklist.md#15-provider-side-subscription-cancel-on-member-removal).
