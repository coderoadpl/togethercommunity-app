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

- Meta conversions: `MetaCapiRepository.decide` records the consent projection,
  evidence and outbox enqueue/delete atomically under the tenant-scoped order
  lock. `MetaCapiRepository.processNext` holds that order lock across the Meta
  HTTP call (bounded by the gateway’s 5 s timeout) and the receipt/retry write.
  Withdrawal and member erasure take the same order lock, so they cannot
  interleave with a send. This is not a lease or an exactly-once HTTP guarantee:
  a crash after Meta accepts can retry the same event ID. A savepoint isolates
  poisoned job processing; rollback preserves the outer lock and permits the
  bounded failure/backoff write. Failure of that write propagates to the
  tenant dispatch boundary, without stalling other tenants or email dispatch.

- Content history: `ProductRepository.updateAccessItems`,
  `CourseRepository.update`, `CourseArchiveRepository.setArchived`,
  `CourseModuleRepository.update`, and
  `CourseLessonRepository.update` write the previous version with the mutation.
- Product-draft deletion: `ProductDraftRepository.deleteDraft` holds the
  tenant-scoped product row lock with `FOR UPDATE` while checking eligibility
  and deleting download assets, prices, and the product with its embedded access
  items in one transaction. Coupon checkout sessions and subscriptions prevent
  deletion. The existing tenant/product foreign key cascades deletion to the
  draft's price history in the same transaction, as detailed in
  [Product drafts](products.md); stored-object cleanup follows commit.
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
- Physical collection: `OrderVerificationRepository.issueLine` serializes on the
  order row and writes the physical line counter and append-only issue event in
  one commit.
- Fulfilment: `OrderFulfilmentRepository.ship` serializes on the order row and
  writes the `shipped` status, the shipment projection, the append-only
  `order_fulfilment_events` row and the buyer e-mail in the outbox in one
  commit.
- InPost shipments: `ShipxShipmentRepository.acquire` takes the claim on the
  one `order_shipments` row per order with a single `INSERT … ON CONFLICT DO
  NOTHING` or a single conditional `UPDATE` that sets a random
  `operation_token` and `operation_started_at` (free, or older than the
  90-second lease), so two concurrent clicks cannot both create or pay a ShipX
  shipment. `update`, `release` and `finishOperation` are conditional on the
  request's `operation_token` and report `lost_lock` without changing anything
  when another request holds the row, so a finished request never clears the
  next one's claim. Every `order_shipments` write pairs with its append-only
  `order_shipment_events` rows (the step, the staff user and the request's
  `operation_token`) in one transaction: `acquire`, `update`, `finishOperation`,
  `release`, `refreshUnclaimed`, `markLabelFetched` and `discardUnconfirmed`
  each write the projection change and its events together, and `update` and
  `refreshUnclaimed` skip the write entirely when ShipX reports nothing new.
  `acquire`, `update` and `refreshUnclaimed` lock the existing row with
  `FOR UPDATE` before changing it, so a lease takeover, a status change and the
  first purchase time are recorded exactly once. A failed event insert rolls
  the projection change back. The shipment is then marked as shipped through
  `OrderFulfilmentRepository.ship` above.
- Stock: `StockRepository.reserve`, `StockRepository.release`,
  `StockRepository.commit`, `StockRepository.enableTracking`,
  `StockRepository.adjust`, and `StockRepository.setThreshold` each write the
  `product_stock` projection, the reservation rows, and the append-only
  `stock_events` rows of one operation in one transaction (a savepoint when the
  payment transaction calls `commit`). `StockRepository.releaseExpired` releases
  each expired reservation in its own transaction. See
  [Stock reservations](#stock-reservations).
- Invoicing and KSeF: `InvoiceRepository.create`,
  `InvoiceRepository.claimRetry`, `InvoiceRepository.update`,
  `InvoiceRepository.createFrozenKsef`, `InvoiceRepository.checkpointKsef`,
  `InvoiceRepository.withKsefInvoiceLock`, `KsefNumberRepository.allocate`, and
  `KsefSubmissionJobRepository.claimDue` keep projections, events, immutable
  artifacts, sequence allocation, and jobs consistent. `withKsefInvoiceLock` is an interactive transaction that
  serializes on the tenant-scoped order row with `FOR UPDATE`, so number
  allocation, held-row update, frozen artifact, lifecycle event, and dispatcher
  job commit together and sends stay idempotent.
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

## Stock reservations

`StockRepository.reserve` takes the row lock through its conditional update
`reserved = reserved + 1 WHERE on_hand - reserved >= 1` on each tracked product,
in product-id order, so concurrent checkouts for the last piece serialize on the
`product_stock` row and exactly one succeeds; a sold-out product rolls back the
reservations already taken in the same call. Release and commit lock the
reservation row first (`UPDATE ... WHERE status = 'active'` or
`SELECT ... FOR UPDATE`) and the `product_stock` row second, so the expiry sweep
and a late payment webhook never deadlock and end in exactly one terminal state:
whichever runs second sees the other's status. Commit locks every
`product_stock` row it touches, reserved or not, in one pass in product-id order
before any update, the same order `reserve` uses. A committed reservation makes
a retried commit a no-op; a released one is committed late. A commit for a
tracked product without a reservation row inserts a committed row under the
unique `(tenant_id, checkout_snapshot_id, product_id)` index with `ON CONFLICT
DO NOTHING`, so concurrent retries decrement `on_hand` once. A commit without a
checkout snapshot checks, under the `product_stock` row lock, for an earlier
`committed` or `committed_late` event carrying the same `orderId` and does
nothing when it finds one, so webhook retries of such an order decrement once;
the partial index `stock_events_tenant_product_order_commit_idx` on
`(tenant_id, product_id, reference->>'orderId')` for those two event types keeps
that lookup off the product's full event history.
The simulated purchase records its order (taking the sales-link lock) before it
reserves and commits stock, the same lock order as the payment webhook. `on_hand` and
`reserved` carry `CHECK (>= 0)`; the commit clamps `on_hand` at zero and records
the shortfall as an `oversold` event. Stock events are never updated or deleted
except through the product foreign-key cascade when a draft product is deleted.

## Sales links and order lines

Sales links use a current projection with an ordered JSON product list and
append-only revision events. Save and delete serialize per workspace with a
transaction-scoped advisory lock; revision checks reject stale edits. Product
rows are share-locked during activation to validate workspace ownership and
publication. Deletion marks the projection deleted and preserves its events.
Paid-order creation takes the same workspace lock before insertion; deletion
refuses a link referenced by a paid, partially refunded or refunded order.
An already-started checkout may still finish after deactivation or deletion,
using its immutable checkout snapshot.

Order lines are stored as ordered JSON in the order row, so the ledger and its
lines are inserted atomically. The payment transaction includes enrollment and
coupon redemption as before. Legacy insert callers receive a single-product
snapshot through an additive database trigger; new checkout callers supply the
frozen snapshot. The verification token is randomly generated by the database
and protected by a unique index. Existing orders receive a one-line backfill
and an independent token.

Physical collection locks the tenant-scoped order row with `FOR UPDATE` before
checking its payment status, physical line and unissued counter. An already
issued line returns a conflict without changing the projection or event history.
The same transaction increments
the line's `issuedCount`, preserves its first issue timestamp and staff user,
and appends an immutable `order_issue_events` row containing the staff user,
timestamp and resulting count. Concurrent issue requests serialize on that
order row: exactly one request can change the count from zero to one, and the
others return a conflict. The quantity-one cap keeps events consistent with the
projection and prevents duplicate collection. Reading or scanning a verification token does not write an event.

Marking an order as shipped follows the same pattern. The repository locks the
tenant-scoped order row with `FOR UPDATE`, re-checks the payment status and the
`to_pack` fulfilment status, then sets `fulfilment_status = 'shipped'` and
`orders.shipment`, appends an `order_fulfilment_events` row and inserts the
`order-shipped` outbox row with its queued e-mail event. If the outbox insert
fails, the transaction rolls back and the order stays `to_pack`. A unique index
on the tenant, order and event type backs the row lock. The e-mail is
dispatched only after commit, so a refused shipment never sends a message.
