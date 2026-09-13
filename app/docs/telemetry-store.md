# Customer-owned telemetry storage

MongoDB Atlas is the preferred customer-owned statistics store. Each connection
names one dedicated database, with separate credentials scoped to that database.
The official `mongodb` driver stays in `adapters/telemetry/mongodb`; core owns
normalization, storage ports, configuration use cases and drain policy. Email
bodies remain in Postgres. The telemetry allowlist excludes raw provider payloads,
IP addresses, geolocation, user agents, email addresses and message bodies.

## Current implementation

Version 1 events preserve application event identifiers, tenant, campaign, contact,
member and send references, SES identifiers, occurrence and ingestion times,
sanitized feedback, link destination, tracking policy version and purchase order
references. Purchase timing does not establish campaign attribution. Uniqueness
means distinct sends within each campaign, not distinct contacts or a sum of daily
unique counts. Replaying a batch does not increment event counts. Per-send flags
are monotonic summaries; exact totals are aggregated from events.

The events collection has campaign/type/send, contact/time/id and type/time/id
indexes, always prefixed by tenant. Contact and feedback pages use bounded keyset
pagination. A connection probe verifies connectivity, write/read/delete and exact
index definitions. Encrypted tenant secrets hold the connection string; responses
never return it or a credential suffix. The dedicated telemetry configuration flow
requires `tenant:settings:write`, probes before activation and removes credentials
on disconnect; reading the panel payload requires `tenant:secret:read` because it
exposes outbound addressing and buffer internals. A disconnected store retains its
independently owned copies.

Tenant-supplied hosts are validated before the driver connects: scheme, dedicated
database, scoped credentials, an allowlist of connection options, and a rejection
of loopback and private address ranges, resolved through DNS (including discovery
records) exactly as tenant-supplied storage endpoints are handled.

`PLATFORM_EGRESS_IP` is an optional operator declaration of a stable outbound
address. Without that declaration, `PLATFORM_EGRESS_ECHO_URL` can name an HTTPS
endpoint returning a plain IP address. Three samples can detect changing egress;
matching samples alone leave stability unknown across instances and deployments.
Results are cached for five minutes. No echo endpoint is contacted by default.
The panel explains an Atlas access-list entry for declared static egress, or
allow-all networking with mandatory TLS and unique database-scoped credentials,
or a fixed-address relay for dynamic egress. Unknown egress requires operator
confirmation. Operator networking decisions remain external configuration.

## Transactional buffer and outage policy

Migration `0128_telemetry_outbox` adds connection, accounting and outbox tables.
Operational email/member event writes append normalized telemetry in the same
Postgres transaction. Disconnected tenants produce no telemetry outbox rows.
Remote writes run only in scheduled draining, independently of mail delivery.
A remote failure never schedules another email send.

Admission accounting is serialized per tenant by its own accounting row and
charges UTF-8 JSON size multiplied by four plus 2 KiB per event for JSONB,
tuple/index overhead and page slack. One tenant's admission never blocks another
tenant's dispatch. Reserving the tenant charge before inserting the outbox row
keeps per-tenant sequence order equal to commit order, so acknowledgement never
deletes a row a drain has not read. Pending reservations have a 64 MiB tenant cap
and 1 GiB shared cap. Above the 48 MiB and 768 MiB admission thresholds the
remaining quarter is reserved: bounce, complaint, unsubscribe and suppression
events are still admitted up to the hard cap, while ordinary engagement and
activity events go to the gap ledger. The synchronization payload exposes the
threshold state and the panel renders it; enforcing a sending pause and its banner
is planned for slice 2. This slice does not pause sending. Never describe its
threshold indicator as an enforced pause.

At the hard cap, only additional analytical detail is rejected. Operational
suppression, unsubscribe and dispatch processing continue. Each tenant's gap
ledger coalesces losses into one conservative time interval and a saturating
count in its fixed-size accounting row, below the 64 KiB ledger allowance. A
successful probe does not clear gaps. Pending records have no time-based expiry.
Acknowledgement deletes rows promptly and advances the tenant checkpoint.
Retries use jittered exponential backoff between five seconds and fifteen
minutes, preserving sequence order. One scheduled pass keeps draining a tenant
through batches of at most 500 events, reusing a single bounded connection, until
the buffer is empty, a batch fails or the tick deadline is near. Disconnecting
releases every pending row and its byte reservation, and records the released span
in the gap ledger, so an abandoned buffer cannot hold shared capacity.
Physical table/index growth and vacuum reuse must be measured in a sustained
pilot before sizing a production workload from the reservation model.

The intended outage policy is to buffer for up to 24 hours, or until an admission
threshold, then latch sending paused with a visible banner. That latch and banner
are explicitly planned for slice 2. Recovery will require a successful probe and
checkpoint, pending bytes below half-cap and oldest pending age below one hour.
Disconnecting or buffer expiry must not masquerade as successful recovery.

## Report availability and rollout

`TELEMETRY_FREE_PLAN_HIDES_STATS` defaults to `false`. When enabled, disconnected
tenants receive campaign identity, schedule and state without counts, rates,
charts or engagement details, and per-send detail drops opened and clicked rows
including their link metadata, over the API as well as the panel. Delivery status,
failures and the send export stay available: they are operational delivery records
rather than engagement analytics. The panel renders a localized unavailable state.
Connected tenants still read campaign reports from Postgres in this slice.
Existing Postgres engagement is retained indefinitely while those reports depend
on it, independently of telemetry connectivity. No history purge is authorized
by the outbox cap or a successful destination probe.

Slice 2 owns report read switching, coverage and watermark presentation,
backfill and parity reconciliation, the pause-sends latch and outage banner.
Operator-hosted analytics and archive-based reporting are outside this slice.

## Consent and transparency surfaces

Storage authorization is separate from tracking consent. Before activation or
history transfer, the intended consent surface explains selected fields and
purpose, destination account/database/region, independent tracking controls,
notice and lawful-basis acknowledgement, provider contracts and transfers,
retention, backups and costs, the connection test and explicit history scope.
Activation should record the accepted notice version. Storage configuration alone
must never enable tracking or reinterpret earlier recipient permissions.

The recipient notice outlines engagement, member activity and purchase references,
purpose, provider category, transfers, retention and rights contact. It separates
withdrawal from erasure and from separately retained consent evidence. The data
processing schedule covers fields, region, credentials, finite buffering,
retention, erasure/export and termination. Customer-contracted storage remains a
customer-directed destination; operator-contracted relays need separate disclosure.
These surfaces are an implementation outline, not a new consent policy.

## Erasure contract

`deleteSubject(tenantId, contactId)` deletes and verifies events and identifying
send summaries in the accessible database. Tenant scope is mandatory. The target
for eligible active-copy erasure is 30 days, subject to applicable rights deadlines
and evidence exceptions. A complete erasure workflow must immediately exclude
subjects from reports, queued replication and any later history transfer; record
completion or blocked/unverified state; and reapply deletion records after restore.
It must resolve member-to-contact references before removing local mappings.
Member and contact erasure deletes that subject's queued outbox rows inside the
erasure transaction and releases their byte reservation, so a later drain cannot
ship an erased subject. Deleting already-replicated documents through the adapter
port stays a coordinated workflow, not an automatic consequence of erasure.

The tenant controls MongoDB backups and their expiry. Disconnect stops subsequent
writes but does not claim deletion of existing copies. Finish authorized remote
cleanup before credential removal where possible, without postponing local erasure
indefinitely. Revoked access requires a scoped secure deletion manifest and tenant
completion/attestation. Unreachable stores and backups remain blocked/unverified;
a successful local account deletion is not evidence of remote deletion. Suppression
and consent evidence retain separately justified purposes and expiry. The adapter
port supplies verified active-copy deletion; coordinated erasure orchestration and
backup attestation must be completed before report cutover.

## Validation and dependencies

`mongodb` 7.5.0 is Apache-2.0. `mongodb-memory-server` 11.1.0 is MIT and is used
only for local integration tests with a pinned MongoDB build. Its install script is
disabled; the test harness starts a disposable local server from a cached binary.
Transitive licenses are part of the repository inventory generated by
`pnpm run licenses:generate`. No provider CLI or deployed environment is required
for these tests.
