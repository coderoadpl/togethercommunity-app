# Data atomicity

Together currently requires `DB_DRIVER=node-postgres` in every environment. This
is a boot-time invariant, not a deployment recommendation. The repository uses
interactive Drizzle transactions in runtime adapters, including invoice,
coupon, KSeF, purchase, enrollment, and e-mail outbox paths. The stateless Neon
HTTP driver cannot provide the same interactive transaction guarantee.

The Vercel function therefore connects with `node-postgres`. Before
`neon-http` can be enabled, every operation below must be rewritten as a single
SQL statement or a driver-supported atomic batch, then the environment
regression test and this inventory must change in the same review.

## MUST-ATOMIC operations

Each named operation is one port method. Its writes must commit together or not
at all.

<!-- MUST-ATOMIC:begin -->

- Content history: `ProductRepository.updateAccessItems`,
  `CourseRepository.update`, `CourseModuleRepository.update`, and
  `CourseLessonRepository.update` write the previous version with the mutation.
- Privacy and identity: `MemberErasurePort.pseudonymize` erases all member
  identifiers as one unit; `MemberErasureRequestRepository.create` and
  `MemberErasureRequestRepository.resolve` keep request projections and events
  together.
- Enrollment and tenant creation: `PurchaseRepository.createMemberGrant`,
  `EnrollmentTransactionPort.run`, and
  `TenantRepository.createTenantWithOwnerGrant` prevent partial grants,
  members, outbox messages, or ownerless tenants.
- Payments and webhooks: `PaymentTransactionPort.run` keeps every payment
  projection write, automatic invoice job enqueue, and webhook finalization in
  one commit. `SubscriptionAdoptionTransaction.run` keeps the imported price,
  subscription projection, product grant, and append-only member event writes in
  one commit.
- Invoicing and KSeF: `InvoiceRepository.create`,
  `InvoiceRepository.claimRetry`, `InvoiceRepository.update`,
  `InvoiceRepository.createFrozenKsef`, `InvoiceRepository.checkpointKsef`,
  `KsefNumberRepository.allocate`, and
  `KsefSubmissionJobRepository.claimDue` keep projections, events, immutable
  artifacts, sequence allocation, and jobs consistent.
- Coupons: `CouponManagementRepository.create`,
  `CouponManagementRepository.archive`, and
  `CouponRedemptionRepository.createOrderAndClaim` keep coupon projections,
  events, orders, and redemption limits consistent.
- Moderation: `PostReportRepository.open`, `PostReportRepository.resolve`,
  `PostReportRepository.resolveAllForPost`, and `MemberRepository.setBanned`
  keep moderation projections and events consistent.
- Marketing: `ConsentDefinitionRepository.create`,
  `TenantDocumentRepository.create`, `TenantDocumentRepository.saveDraft`,
  `TenantDocumentRepository.publishDraft`,
  `CampaignSendRepository.claimRecipient`, `CampaignSendRepository.update`,
  `SuppressionRepository.record`, and `UnsubscribeTokenRepository.consume`
  keep projections and audit events consistent.
- Transactional e-mail: `EmailOutboxRepository.enqueue`,
  `EmailOutboxRepository.claimBatch`, `EmailOutboxRepository.markSent`,
  `EmailOutboxRepository.markFailed`, and
  `EmailOutboxRepository.markDelivery` keep delivery state, attempts,
  reservations, and events consistent.
- Scheduler telemetry: `SchedulerRunRepository.finalize` writes the terminal
  run and per-tenant results together.
- Surveys: `SurveyRepository.save` writes the current survey and its append-only
  lifecycle event together. `SurveyRepository.submit` validates the locked
  survey and upserts a member's current response in one transaction.
- Download copies: `DownloadCopyRepository.create` locks the member row with
  `FOR UPDATE`, checks that the member is not erased, and inserts the registry
  row in one transaction to serialize issuance with member erasure.
- Telemetry outbox: `EmailEventRepository.append` and
  `MemberEventRepository.append` write the event, the per-tenant telemetry
  accounting row and the outbox row in one commit, so the outbox sequence
  follows commit order and an event is never stored without its accounting.

<!-- MUST-ATOMIC:end -->

The legacy importer also uses interactive transactions for each import unit and
for each repair batch. It is a maintenance boundary rather than a core port, but
it is subject to the same `node-postgres` constraint.

Automatic invoice requests use a dedicated `auto_invoice_jobs` table. Extending
`ksef_submission_jobs` would require nullable invoice references and a second
job lifecycle before an invoice or its frozen KSeF artifact exists. The separate
queue preserves the existing KSeF invariants with fewer schema and dispatcher
changes. Its webhook event uniqueness constraint prevents duplicate enqueue,
and its order foreign key keeps each job attached to the transactionally created
order. Workers claim rows with `FOR UPDATE SKIP LOCKED`; abandoned running rows
return to the queue after their lease expires. Invoice issuance remains
idempotent by order, so a worker crash after issuance but before job completion
is safe to retry.

## Data conventions

Lifecycle records use a current projection plus append-only events. Projection
and event writes belong to the same atomic operation. Scheduler runs are
finalized once. New aggregate identifiers use UUIDs, and new timestamps use
Postgres timezone-aware timestamps unless an existing contract requires a
legacy representation.

Database constraints own row-local and referential invariants. Application code
owns invariants that depend on external systems or a decision spanning
independent aggregates. New list surfaces require explicit stable ordering and
pagination. Concurrency-sensitive aggregates must state whether they use a
unique constraint, conditional write, row lock, or serializable transaction.
Redirect hit counts use one tenant-and-id-scoped SQL `UPDATE` that increments
`hit_count` and sets `last_hit_at`, so concurrent hits remain atomic without an
interactive transaction.

Capturing a lesson edition locks the tenant-scoped `course_lessons` row with
`FOR UPDATE`, shared with content imports, before reading current content and
the latest version and deciding whether to reuse or insert a snapshot in the
same transaction. Marking a version conditionally updates only an unnumbered
row or one with the edition number observed by the caller. Concurrent captures
of different numbers preserve both editions in distinct version rows; a stale
mark or duplicate number returns the existing `conflict` error.

Survey submissions take a `FOR UPDATE` lock on the member row, when present,
before a `FOR SHARE` lock on the survey row. The survey lock allows concurrent
submissions while excluding edits, deactivation and deletion. Member erasure
locks the same member row and removes their survey responses in its transaction,
so a concurrent submit cannot recreate an erased member's response. The locked
survey is checked for activation, revision and form token before insertion.
A unique `(tenant_id, survey_id, member_id)` index and `ON CONFLICT DO UPDATE`
replace the current member response safely under concurrent submissions. A null
member ID leaves anonymous responses independent. Counts, distributions, NPS
and averages are derived from current responses rather than mutable counters.
Survey updates use optimistic revisions and write append-only lifecycle events;
the scale type cannot change after responses exist. Foreign-key cascades remove
responses and survey events when their survey or workspace is deleted.

Survey CSV exports read the complete tenant-scoped response set and member names
in one SQL statement. PostgreSQL supplies one statement snapshot, so concurrent
submissions cannot shift page boundaries and duplicate or omit exported rows.
