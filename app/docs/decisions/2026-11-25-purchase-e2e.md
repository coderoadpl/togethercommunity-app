# Purchase end-to-end on deployed hosts (2026-11-25)

**Status: Proposed, awaiting the owner's confirmation.** Nothing in this record
is in force until the owner confirms it; until then the pull requests that rely
on it stay drafts.

## Decision 1: provider webhooks on the protected staging host

The owner would confirm (his wording is kept in the private notes):

> Yes: staging receives the provider's webhooks through forwarding from CI. The
> deployment-protection bypass value does not reach the provider.

Grants:

- The staging purchase run stores a signing secret of its own as the
  `tenant-acme` test-slot webhook secret through the owner's tenant secret API,
  reads its own events from the provider's Events API with a staging sandbox
  key, and posts them signed to the staging webhook route with the existing
  staging bypass header (`app/docs/observability.md`, Purchase end-to-end on a
  deployed host).

Does not grant:

- Any change to how the application registers webhook endpoints, any bypass
  value in a URL registered with the provider, or the bypass value in any job
  other than the staging smoke and the staging purchase run.

Revoke: remove the staging purchase workflow or its repository secrets
`STRIPE_TEST_RESTRICTED_KEY_STAGING` and `STRIPE_TEST_PUBLISHABLE_KEY_STAGING`.

## Decision 2: a machine credential limited to two routes

The proposed production runner uses an exclusive `purchase-smoke` shop
management credential for the fixture workspace. It grants exactly:

- `POST /api/m2m/shop/purchase-smoke/checkouts`: start one of four fixed test
  checkouts (`digital-course`, `parcel-courier`, `parcel-locker`,
  `bundle-locker`) in the fixture workspace.
- `GET /api/m2m/shop/purchase-smoke/checkouts/:reference/result`: read the result
  and applied-event receipts of a checkout the same credential created.

It grants no other route, no staff session, and no access to settings or
secrets. The caller cannot choose the buyer identity, product, amount,
workspace or payment mode. Live mode is not available.

A verified owner issues the key in their own session with an absolute expiry no
more than 30 days after issue. An expired key no longer authenticates. The owner
can revoke it in their session; a revoked key no longer authenticates. The
fixture reseed preserves the key, its original expiry and its revocation state.
The reseed never mints, extends or reactivates a key.

The separate runner Stripe credentials come from the production fixture's own
test sandbox. Its provider-side refund check proves inbound refund
reconciliation (a provider-side refund reaches the order), NOT the staff refund
flow. See [Purchase end-to-end on a deployed host](../observability.md#purchase-end-to-end-on-a-deployed-host)
for the sandbox permissions and receipt requirements.
