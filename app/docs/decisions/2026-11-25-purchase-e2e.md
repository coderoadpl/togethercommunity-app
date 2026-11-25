# Purchase end-to-end on deployed hosts (2026-11-25)

**Status: proposed, awaiting the owner's confirmation.** Nothing in this record
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

## Decision 2: a purchase smoke on production with a fixture administrator

The owner would confirm (his wording is kept in the private notes):

> Yes: the purchase test runs on production as a separate admin account in
> `acme`. The deployment sets its password and the test key; CI holds no owner
> password.

Grants:

- An optional account `kontakt+smoke-purchase@togethercommunity.app` with the
  **admin** role in the synthetic `tenant-acme` only, created by the operator
  reseed when the deployment sets `SMOKE_PURCHASE_PASSWORD`, and reset to the
  same password on every reseed.
- The reseed configuring the `tenant-acme` **test** payment slot from the
  deployment's `SMOKE_PURCHASE_STRIPE_TEST_KEY` (an `rk_test_` key of a sandbox
  of its own) and seeding the purchase fixtures.
- A new CI job after every successful production deployment smoke that holds
  `SMOKE_PURCHASE_PASSWORD` (as `PURCHASE_E2E_STAFF_PASSWORD_PRODUCTION`), a read
  key and the publishable key of that sandbox, makes four test-mode purchases and
  two staff refunds in `tenant-acme`, and pages through
  `.github/actions/alert-gate` after it is first green.

What a holder of `SMOKE_PURCHASE_PASSWORD` can do on production, at worst, until
the password is rotated: in `tenant-acme` only, create test-mode checkouts and
refund `tenant-acme` orders (only test-mode ones exist), edit its products and
courses, read its synthetic members, and read masked secrets. The next deploy's
reseed undoes those changes.

Does not grant:

- Writing any payment secret (live or test), workspace settings, API keys or
  shop management keys; any access to another workspace; any live-mode provider
  call; the owner password of `tenant-acme` in CI.

Revoke: unset `SMOKE_PURCHASE_PASSWORD` and `SMOKE_PURCHASE_STRIPE_TEST_KEY` in
the production deployment and remove the production purchase workflow and its
repository secrets; the next reseed then creates no account and configures no
test slot. To end access already given out, rotate `SMOKE_PURCHASE_PASSWORD`
in the deployment and in CI and end the account's open sessions.
