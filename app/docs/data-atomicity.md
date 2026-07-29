# Data atomicity

Together currently requires `DB_DRIVER=node-postgres` in every environment. This
is a boot-time invariant, not a deployment recommendation. The repository uses
interactive Drizzle transactions in eight runtime adapters, including invoice,
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
  identifiers as one unit.
- Enrollment and tenant creation: `PurchaseRepository.createMemberGrant`,
  `EnrollmentTransactionPort.run`, and
  `TenantRepository.createTenantWithOwnerGrant` prevent partial grants,
  members, outbox messages, or ownerless tenants.
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
  and `PostReportRepository.resolveAllForPost` keep report projections and
  events consistent.
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

<!-- MUST-ATOMIC:end -->

The legacy importer also uses interactive transactions for each import unit and
for each repair batch. It is a maintenance boundary rather than a core port, but
it is subject to the same `node-postgres` constraint.

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
